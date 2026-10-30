import { expect, Locator, Page, test } from "@playwright/test";
import { screenshot, seedUserState } from "./screenshot";

const SPACE_SLUG = "allgemein";
const SPACE_NAME = "Allgemein";
const TRAVEL_PAGE_TITLE = "Reisekosten Richtlinie 2022";
const SECOND_PAGE_TITLE = "Reisekosten Abrechnung";
const EXAMPLE_TASK =
  "Finde veraltete Seiten zu Reisekosten und schlage Updates vor";
const RUN_TASK = "Finde veraltete Seiten zu Reisekosten";
const FIRST_REASON = "Kilometerpauschale ist veraltet";
const SECOND_REASON = "Abrechnungsfrist wurde verkürzt";
const FINAL_MESSAGE =
  "Ich habe zwei Seiten geprüft und für beide eine Änderung vorgeschlagen.";
const FIRST_PROPOSAL_ID = "proposal-1";
const SECOND_PROPOSAL_ID = "proposal-2";
const HOLD_OPEN_MS = 600_000;
const TALL_VIEWPORT_HEIGHT_PX = 1100;

interface IListedPage {
  id: string;
  slugId: string;
  title: string;
}

type ProposalStatus = "open" | "applied" | "discarded" | "stale";

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

async function mockAssistantStatus(page: Page, status: "available") {
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

async function runWith(page: Page, events: object[]) {
  await page.route("**/api/ai/agent/run", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: eventStream(events),
    }),
  );
}

async function runHeldOpenAfter(page: Page, events: object[]) {
  await page.addInitScript(
    ({ body, holdMs }) => {
      const pageFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.endsWith("/api/ai/agent/run")) return pageFetch(input, init);
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(body));
            setTimeout(() => controller.close(), holdMs);
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      };
    },
    { body: eventStream(events), holdMs: HOLD_OPEN_MS },
  );
}

function proposalSummary(
  id: string,
  pageTitle: string,
  reason: string,
  added: number,
  removed: number,
) {
  return {
    type: "proposal",
    proposal: { id, pageId: `page-${id}`, pageTitle, reason, added, removed },
  };
}

const TWO_PROPOSALS_RUN = [
  { type: "run", runId: "run-1" },
  {
    type: "step",
    steps: 1,
    label: { kind: "search", query: "Reisekosten", count: 2 },
  },
  { type: "step", steps: 2, label: { kind: "read", title: TRAVEL_PAGE_TITLE } },
  {
    type: "step",
    steps: 3,
    label: { kind: "read", title: SECOND_PAGE_TITLE },
  },
  {
    type: "step",
    steps: 4,
    label: { kind: "propose", title: TRAVEL_PAGE_TITLE },
  },
  proposalSummary(FIRST_PROPOSAL_ID, TRAVEL_PAGE_TITLE, FIRST_REASON, 1, 1),
  {
    type: "step",
    steps: 5,
    label: { kind: "propose", title: SECOND_PAGE_TITLE },
  },
  proposalSummary(SECOND_PROPOSAL_ID, SECOND_PAGE_TITLE, SECOND_REASON, 3, 3),
  {
    type: "end",
    outcome: "finished",
    pagesRead: 5,
    message: FINAL_MESSAGE,
  },
];

const ONE_PROPOSAL_TIME_LIMIT_RUN = [
  { type: "run", runId: "run-2" },
  {
    type: "step",
    steps: 1,
    label: { kind: "search", query: "Reisekosten", count: 2 },
  },
  { type: "step", steps: 2, label: { kind: "read", title: TRAVEL_PAGE_TITLE } },
  {
    type: "step",
    steps: 3,
    label: { kind: "propose", title: TRAVEL_PAGE_TITLE },
  },
  proposalSummary(FIRST_PROPOSAL_ID, TRAVEL_PAGE_TITLE, FIRST_REASON, 1, 1),
  { type: "end", outcome: "time_limit", pagesRead: 1, message: null },
];

function proposalView(status: ProposalStatus, canEdit: boolean) {
  return {
    id: FIRST_PROPOSAL_ID,
    runId: "run-1",
    pageId: "page-proposal-1",
    pageTitle: TRAVEL_PAGE_TITLE,
    reason: FIRST_REASON,
    status,
    canEdit,
    added: 1,
    removed: 1,
    changes: [
      {
        heading: "Kilometerpauschale",
        ops: [
          { op: "keep", text: "Die Pauschale beträgt" },
          { op: "remove", text: "0,30" },
          { op: "add", text: "0,38" },
          { op: "keep", text: "€ pro Kilometer." },
        ],
      },
    ],
  };
}

async function mockProposal(
  page: Page,
  status: ProposalStatus,
  canEdit: boolean,
) {
  await page.route("**/api/ai/agent/proposal", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: proposalView(status, canEdit),
        success: true,
        status: 200,
      }),
    }),
  );
  for (const action of ["apply", "discard"]) {
    await page.route(`**/api/ai/agent/proposal/${action}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {}, success: true, status: 200 }),
      }),
    );
  }
}

async function openPanel(page: Page, pages: IListedPage[]) {
  const width = page.viewportSize()?.width ?? 1280;
  await page.setViewportSize({ width, height: TALL_VIEWPORT_HEIGHT_PX });
  const other = pages.find(
    (candidate) => candidate.title === TRAVEL_PAGE_TITLE,
  );
  expect(other).toBeDefined();
  await page.goto(`/s/${SPACE_SLUG}/p/${other?.slugId}`);
  await page.getByRole("button", { name: "Assistent" }).click();
}

async function openTaskTab(page: Page) {
  await page.getByRole("tab", { name: "Aufgabe" }).click();
  await expect(page.getByPlaceholder("Aufgabe beschreiben …")).toBeVisible();
}

async function startRunWithExample(page: Page) {
  await page.getByText(EXAMPLE_TASK).click();
  await page.getByRole("button", { name: "Starten" }).click();
}

async function startRunWithTask(page: Page) {
  await page.getByPlaceholder("Aufgabe beschreiben …").fill(RUN_TASK);
  await page.getByRole("button", { name: "Starten" }).click();
}

async function expectInsideViewport(page: Page, element: Locator) {
  const box = await element.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("element or viewport not available");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
}

test.describe("GF gives the assistant a task", () => {
  test.use({ storageState: seedUserState("GF") });

  test.beforeEach(async ({ page }) => {
    await setLocale(page, "de-DE");
    await mockAssistantStatus(page, "available");
  });

  test.afterEach(async ({ page }) => {
    await setLocale(page, "en-US");
  });

  test("AGENT-AC1: the panel shows the tabs Fragen and Aufgabe with Fragen selected", async ({
    page,
  }, testInfo) => {
    await openPanel(page, await allgemeinPages(page));

    await expect(page.getByRole("tab", { name: "Fragen" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Aufgabe" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(page.getByText("Frag das Wiki")).toBeVisible();
    await screenshot(page, testInfo, "AGENT-AC1", "tabs");
  });

  test("AGENT-AC2: G1 shows the space, the hint, the examples and the input", async ({
    page,
  }, testInfo) => {
    await openPanel(page, await allgemeinPages(page));

    await openTaskTab(page);

    await expect(page.getByRole("combobox", { name: "Bereich" })).toHaveValue(
      SPACE_NAME,
    );
    await expect(
      page.getByText(
        "Der Assistent kann Seiten suchen, lesen und Änderungen vorschlagen. Nichts wird ohne deine Bestätigung geändert.",
      ),
    ).toBeVisible();
    await expect(page.getByText("Beispiele")).toBeVisible();
    await expect(page.getByText(EXAMPLE_TASK)).toBeVisible();
    await expect(
      page.getByText("Prüfe, ob sich Seiten zum Urlaubsantrag widersprechen"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Starten" })).toBeVisible();
    await screenshot(page, testInfo, "AGENT-AC2", "g1");
  });

  test("AGENT-AC16: G2 shows the task, two ended steps and Abbrechen while the run goes on", async ({
    page,
  }, testInfo) => {
    await runHeldOpenAfter(page, [
      { type: "run", runId: "run-1" },
      {
        type: "step",
        steps: 1,
        label: { kind: "search", query: "Reisekosten", count: 2 },
      },
      {
        type: "step",
        steps: 2,
        label: { kind: "read", title: TRAVEL_PAGE_TITLE },
      },
    ]);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);

    await startRunWithTask(page);

    await expect(page.getByText(`${RUN_TASK} · ${SPACE_NAME}`)).toBeVisible();
    await expect(
      page.getByText("Gesucht: „Reisekosten“: 2 Seiten"),
    ).toBeVisible();
    await expect(
      page.getByText(`Gelesen: „${TRAVEL_PAGE_TITLE}“`),
    ).toBeVisible();
    await expect(page.getByText("Schritt 2 von höchstens 20")).toBeVisible();
    await expect(page.getByText(/^\d+:\d{2} min$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Abbrechen" })).toBeVisible();
    await screenshot(page, testInfo, "AGENT-AC16", "g2");
  });

  test("AGENT-AC48: G3 shows the summary, two cards, the final message and Neue Aufgabe", async ({
    page,
  }, testInfo) => {
    await runWith(page, TWO_PROPOSALS_RUN);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);

    await startRunWithExample(page);

    await expect(
      page.getByText("2 Vorschläge · 5 Seiten gelesen"),
    ).toBeVisible();
    await expect(page.getByText(FIRST_REASON)).toBeVisible();
    await expect(page.getByText(SECOND_REASON)).toBeVisible();
    await expect(page.getByText("+1 −1")).toBeVisible();
    await expect(page.getByText("+3 −3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ansehen" })).toHaveCount(2);
    await expect(page.getByText(FINAL_MESSAGE)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Neue Aufgabe" }),
    ).toBeVisible();
    await screenshot(page, testInfo, "AGENT-AC48", "g3");
  });

  test("AGENT-AC59: a run stopped after 10 minutes shows the orange limit hint and its card", async ({
    page,
  }, testInfo) => {
    await runWith(page, ONE_PROPOSAL_TIME_LIMIT_RUN);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);

    await startRunWithExample(page);

    await expect(page.getByText("1 Vorschlag · 1 Seite gelesen")).toBeVisible();
    await expect(
      page.getByText(
        "Nach 10 Minuten gestoppt. Nicht alle Seiten wurden geprüft.",
      ),
    ).toBeVisible();
    await expect(page.getByText(FINAL_MESSAGE)).toHaveCount(0);
    await screenshot(page, testInfo, "AGENT-AC59", "limit-hint");
  });

  test("AGENT-AC71: G4 shows the reason, the diff and the buttons Verwerfen and Übernehmen", async ({
    page,
  }, testInfo) => {
    await runWith(page, TWO_PROPOSALS_RUN);
    await mockProposal(page, "open", true);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);
    await startRunWithExample(page);

    await page.getByRole("button", { name: "Ansehen" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(`Vorschlag: ${TRAVEL_PAGE_TITLE}`),
    ).toBeVisible();
    await expect(dialog.getByText(`Begründung: ${FIRST_REASON}`)).toBeVisible();
    await expect(
      dialog.getByText("Kilometerpauschale", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("del")).toHaveText("0,30");
    await expect(dialog.locator("ins")).toHaveText("0,38");
    await expect(dialog.getByText("€ pro Kilometer.")).toBeVisible();
    await expect(
      dialog.getByText("Wird als deine Änderung gespeichert."),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Verwerfen" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Übernehmen" }),
    ).toBeEnabled();
    await expectInsideViewport(page, dialog);
    await screenshot(page, testInfo, "AGENT-AC71", "g4", dialog);
  });

  test("AGENT-AC89: G5 shows the stale text with Schließen and Neuen Vorschlag erstellen", async ({
    page,
  }, testInfo) => {
    await runWith(page, TWO_PROPOSALS_RUN);
    await mockProposal(page, "stale", true);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);
    await startRunWithExample(page);

    await page.getByRole("button", { name: "Ansehen" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText(
        "Die Seite wurde nach diesem Vorschlag geändert. Der Vorschlag kann nicht mehr übernommen werden.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Neuen Vorschlag erstellen" }),
    ).toBeVisible();
    await expectInsideViewport(page, dialog);
    await screenshot(page, testInfo, "AGENT-AC89", "g5", dialog);

    await dialog
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Veraltet", { exact: true })).toBeVisible();
  });
});

test.describe("WS may only read the page of a proposal", () => {
  test.use({ storageState: seedUserState("WS") });

  test.beforeEach(async ({ page }) => {
    await setLocale(page, "de-DE");
    await mockAssistantStatus(page, "available");
  });

  test.afterEach(async ({ page }) => {
    await setLocale(page, "en-US");
  });

  test("AGENT-AC97: G6 shows the diff, the read-only hint and Übernehmen disabled", async ({
    page,
  }, testInfo) => {
    await runWith(page, TWO_PROPOSALS_RUN);
    await mockProposal(page, "open", false);
    await openPanel(page, await allgemeinPages(page));
    await openTaskTab(page);
    await startRunWithExample(page);

    await page.getByRole("button", { name: "Ansehen" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("del")).toHaveText("0,30");
    await expect(dialog.locator("ins")).toHaveText("0,38");
    await expect(
      dialog.getByText(
        "Du hast nur Leserechte für diese Seite und kannst den Vorschlag nicht übernehmen.",
      ),
    ).toBeVisible();
    await expect(
      dialog.getByText("Wird als deine Änderung gespeichert."),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Verwerfen" }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Übernehmen" }),
    ).toBeDisabled();
    await expectInsideViewport(page, dialog);
    await screenshot(page, testInfo, "AGENT-AC97", "g6", dialog);
  });
});
