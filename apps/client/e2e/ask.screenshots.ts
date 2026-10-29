import { expect, Page, test } from "@playwright/test";
import { screenshot, seedUserState } from "./screenshot";

const SPACE_SLUG = "allgemein";
const SOURCE_PAGE_TITLE = "Bürozeiten und Erreichbarkeit";
const SOURCE_HEADING = "Notfälle auf Baustellen";
const SECOND_HEADING = "Kernarbeitszeit";
const ANSWER_TEXT =
  "Bei Unfällen auf Baustellen gilt zuerst der Notruf [1]. Die Kernarbeitszeit liegt zwischen 9:00 Uhr und 15:00 Uhr [2].";
const FIRST_ANSWER_PART = "Bei Unfällen auf Baustellen gilt zuerst der Notruf";
const NO_SOURCE_TEXT =
  "Dazu habe ich in den Seiten, auf die du Zugriff hast, keine passende Quelle gefunden. Formuliere die Frage anders oder wende dich an die zuständige Abteilung.";
const EXAMPLE_QUESTION = "Wann ist die Kernarbeitszeit?";
const STREAMING_PAUSE_MS = 3_000;

interface IProseMirrorNode {
  type?: string;
  attrs?: { id?: string };
  content?: IProseMirrorNode[];
  text?: string;
}

interface IListedPage {
  id: string;
  slugId: string;
  title: string;
}

interface ISeedPage {
  id: string;
  slugId: string;
  headingId: string;
  secondHeadingId: string;
}

function textOf(node: IProseMirrorNode): string {
  return (node.text ?? "") + (node.content ?? []).map(textOf).join("");
}

function findHeadingId(
  node: IProseMirrorNode,
  heading: string,
): string | undefined {
  if (node.type === "heading" && textOf(node) === heading)
    return node.attrs?.id;
  for (const child of node.content ?? []) {
    const found = findHeadingId(child, heading);
    if (found) return found;
  }
  return undefined;
}

async function postData<T>(page: Page, path: string, data: object): Promise<T> {
  const response = await page.request.post(path, { data });
  expect(response.ok(), `${path} answered ${response.status()}`).toBe(true);
  return (await response.json()).data as T;
}

async function setLocale(page: Page, locale: string) {
  const response = await page.request.post("/api/users/update", {
    data: { locale },
  });
  expect(response.ok()).toBe(true);
}

async function allgemeinPages(page: Page): Promise<IListedPage[]> {
  const { items: spaces } = await postData<{
    items: { id: string; slug: string }[];
  }>(page, "/api/spaces", {});
  const space = spaces.find((candidate) => candidate.slug === SPACE_SLUG);
  expect(space).toBeDefined();
  const { items } = await postData<{ items: IListedPage[] }>(
    page,
    "/api/pages/recent",
    { spaceId: space?.id },
  );
  return items;
}

async function sourcePage(
  page: Page,
  pages: IListedPage[],
): Promise<ISeedPage> {
  const listed = pages.find(
    (candidate) => candidate.title === SOURCE_PAGE_TITLE,
  );
  expect(listed).toBeDefined();
  const { content } = await postData<{ content: IProseMirrorNode }>(
    page,
    "/api/pages/info",
    { pageId: listed?.id },
  );
  const headingId = findHeadingId(content, SOURCE_HEADING);
  const secondHeadingId = findHeadingId(content, SECOND_HEADING);
  expect(headingId).toBeDefined();
  expect(secondHeadingId).toBeDefined();
  return {
    id: listed?.id ?? "",
    slugId: listed?.slugId ?? "",
    headingId: headingId ?? "",
    secondHeadingId: secondHeadingId ?? "",
  };
}

async function mockAssistantStatus(
  page: Page,
  status: "available" | "unavailable",
) {
  await page.route("**/api/ai/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { status }, success: true, status: 200 }),
    }),
  );
}

function eventStream(events: object[]) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function answerWith(page: Page, events: object[]) {
  await page.route("**/api/ai/ask", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: eventStream(events),
    });
  });
}

async function streamWithPause(
  page: Page,
  first: object[],
  rest: object[],
  pauseMs: number,
) {
  await page.addInitScript(
    ({ firstBody, restBody, pause }) => {
      const pageFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.endsWith("/api/ai/ask")) return pageFetch(input, init);
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(firstBody));
            setTimeout(() => {
              controller.enqueue(encoder.encode(restBody));
              controller.close();
            }, pause);
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      };
    },
    {
      firstBody: eventStream(first),
      restBody: eventStream(rest),
      pause: pauseMs,
    },
  );
}

function citedSources(source: ISeedPage) {
  const pageUrl = `/s/${SPACE_SLUG}/p/${source.slugId}`;
  return {
    type: "sources",
    sources: [
      {
        number: 1,
        pageId: source.id,
        title: SOURCE_PAGE_TITLE,
        spaceName: "Allgemein",
        headingPath: [SOURCE_HEADING],
        fileName: null,
        pdfPage: null,
        url: `${pageUrl}#${source.headingId}`,
      },
      {
        number: 2,
        pageId: source.id,
        title: SOURCE_PAGE_TITLE,
        spaceName: "Allgemein",
        headingPath: [SECOND_HEADING],
        fileName: null,
        pdfPage: null,
        url: `${pageUrl}#${source.secondHeadingId}`,
      },
    ],
  };
}

function citedAnswer(source: ISeedPage) {
  return [{ type: "delta", text: ANSWER_TEXT }, citedSources(source)];
}

async function openPanelOnAnotherPage(page: Page, pages: IListedPage[]) {
  const other = pages.find(
    (candidate) => candidate.title !== SOURCE_PAGE_TITLE,
  );
  expect(other).toBeDefined();
  await page.goto(`/s/${SPACE_SLUG}/p/${other?.slugId}`);
  await page.getByRole("button", { name: "Assistent" }).click();
}

test.describe("WS asks the wiki", () => {
  test.use({ storageState: seedUserState("WS") });

  test.beforeEach(async ({ page }) => {
    await setLocale(page, "de-DE");
    await mockAssistantStatus(page, "available");
  });

  test.afterEach(async ({ page }) => {
    await setLocale(page, "en-US");
  });

  test("ASK-AC1: A1 shows the heading, the hint, the examples and the input", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    await openPanelOnAnotherPage(page, pages);

    await expect(page.getByText("Frag das Wiki")).toBeVisible();
    await expect(
      page.getByText(
        "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen.",
      ),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Frage stellen …")).toBeVisible();
    await expect(page.getByText(EXAMPLE_QUESTION)).toBeVisible();
    await screenshot(page, testInfo, "ASK-AC1", "a1");
  });

  test("ASK-AC77: A2 shows the stop button while the answer is generated", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    const source = await sourcePage(page, pages);
    await streamWithPause(
      page,
      [{ type: "delta", text: FIRST_ANSWER_PART }],
      [
        { type: "delta", text: ANSWER_TEXT.slice(FIRST_ANSWER_PART.length) },
        citedSources(source),
      ],
      STREAMING_PAUSE_MS,
    );
    await openPanelOnAnotherPage(page, pages);

    await page.getByText(EXAMPLE_QUESTION).click();

    await expect(page.getByText(FIRST_ANSWER_PART)).toBeVisible();
    await expect(page.getByRole("button", { name: "Stoppen" })).toBeVisible();
    await expect(page.getByText("Quellen", { exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, "ASK-AC77", "a2-streaming");
    await expect(page.getByText("Quellen", { exact: true })).toBeVisible();
  });

  test("ASK-AC15: A2 shows the answer with its two sources", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    const source = await sourcePage(page, pages);
    await answerWith(page, citedAnswer(source));
    await openPanelOnAnotherPage(page, pages);

    await page.getByText(EXAMPLE_QUESTION).click();

    await expect(page.getByText("Quellen", { exact: true })).toBeVisible();
    await expect(page.getByText(`Allgemein › ${SOURCE_HEADING}`)).toBeVisible();
    await expect(page.getByText(`Allgemein › ${SECOND_HEADING}`)).toBeVisible();
    await screenshot(page, testInfo, "ASK-AC15", "a2-sources");
  });

  test("ASK-AC36: A3 shows the no-source text without sources", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    await answerWith(page, [{ type: "no_source" }]);
    await openPanelOnAnotherPage(page, pages);

    await page.getByText(EXAMPLE_QUESTION).click();

    await expect(page.getByText(NO_SOURCE_TEXT)).toBeVisible();
    await expect(page.getByText("Quellen", { exact: true })).toHaveCount(0);
    await screenshot(page, testInfo, "ASK-AC36", "a3");
  });

  test("ASK-AC7: A4 shows the unavailable text with the input disabled", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    await mockAssistantStatus(page, "unavailable");
    await openPanelOnAnotherPage(page, pages);

    await expect(
      page.getByText(
        "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.",
      ),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Frage stellen …")).toBeDisabled();
    await screenshot(page, testInfo, "ASK-AC7", "a4");
  });

  test("ASK-AC21: clicking a source opens the page with the cited heading in view", async ({
    page,
  }, testInfo) => {
    const pages = await allgemeinPages(page);
    const width = page.viewportSize()?.width ?? 1280;
    await page.setViewportSize({ width, height: 360 });
    const source = await sourcePage(page, pages);
    await answerWith(page, citedAnswer(source));
    await openPanelOnAnotherPage(page, pages);
    await page.getByText(EXAMPLE_QUESTION).click();
    const heading = page.locator(
      `[id="${source.headingId}"], [data-id="${source.headingId}"]`,
    );
    await expect(heading).toHaveCount(0);

    await page.getByRole("link", { name: `1. ${SOURCE_PAGE_TITLE}` }).click();

    await expect(page).toHaveURL(new RegExp(`#${source.headingId}$`));
    await expect(heading).toContainText(SOURCE_HEADING);
    await expect(heading).toBeInViewport();
    const scrolledAncestors = await heading.evaluate((element) => {
      let offsets = 0;
      for (let node = element.parentElement; node; node = node.parentElement) {
        offsets += node.scrollTop;
      }
      return offsets;
    });
    expect(scrolledAncestors).toBeGreaterThan(0);
    await screenshot(page, testInfo, "ASK-AC21", "heading-in-view");
  });
});
