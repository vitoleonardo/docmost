import * as path from "node:path";
import { Browser, BrowserContext, expect, Page, test } from "@playwright/test";
import {
  SEED_USERS,
  SeedUserKey,
} from "../../server/src/integrations/seed/seed-definition";
import { seedUserState } from "./screenshot";

const VIDEO_SIZE = { width: 1440, height: 900 };
const VIDEO_DIR = process.env.DEMO_VIDEO_DIR || "test-results/demo-videos";
const READING_PAUSE_MS = 4_000;
const SHORT_PAUSE_MS = 1_500;

const SALARY_QUESTION =
  "Welche Gehaltsbänder gelten für die Abteilungsleitung?";
const WELCOME_PAGE_TITLE = "Willkommen bei Ostmooimooi";
const SALARY_PAGE_TITLE = "Gehaltsbänder Führungsebene";
const NO_SOURCE_START =
  "Dazu habe ich in den Seiten, auf die du Zugriff hast, keine passende Quelle gefunden.";

const ROLE_LABELS: Record<SeedUserKey, string> = {
  GF: "Geschäftsführer",
  PL: "Projektleiterin",
  VT: "Vertrieb",
  WS: "Werkstudent",
};

interface IListedPage {
  slugId: string;
  title: string;
}

interface IRecording {
  context: BrowserContext;
  page: Page;
}

function signedInLabel(user: SeedUserKey): string {
  const name = SEED_USERS.find((candidate) => candidate.key === user)?.name;
  return `${name} · ${ROLE_LABELS[user]}`;
}

function showSignedInUser(label: string) {
  window.addEventListener("DOMContentLoaded", () => {
    const badge = document.createElement("div");
    badge.textContent = label;
    badge.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:8px 14px;border-radius:8px;background:#1c7ed6;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none";
    document.body.appendChild(badge);
  });
}

async function startRecording(
  browser: Browser,
  user: SeedUserKey,
): Promise<IRecording> {
  const context = await browser.newContext({
    storageState: seedUserState(user),
    viewport: VIDEO_SIZE,
    recordVideo: { dir: VIDEO_DIR, size: VIDEO_SIZE },
  });
  await context.addInitScript(showSignedInUser, signedInLabel(user));
  const page = await context.newPage();
  const locale = await page.request.post("/api/users/update", {
    data: { locale: "de-DE" },
  });
  expect(locale.ok()).toBe(true);
  return { context, page };
}

async function stopRecording({ context, page }: IRecording, name: string) {
  await page.waitForTimeout(SHORT_PAUSE_MS);
  const video = page.video();
  await context.close();
  expect(video, "the context records a video").not.toBeNull();
  await video?.saveAs(path.join(VIDEO_DIR, `${name}.webm`));
  await video?.delete();
}

async function pageInSpace(
  page: Page,
  spaceSlug: string,
  title: string,
): Promise<string> {
  const spaces = await page.request.post("/api/spaces", { data: {} });
  expect(spaces.ok()).toBe(true);
  const { items } = (await spaces.json()).data as {
    items: { id: string; slug: string }[];
  };
  const space = items.find((candidate) => candidate.slug === spaceSlug);
  expect(space, `space ${spaceSlug}`).toBeDefined();
  const recent = await page.request.post("/api/pages/recent", {
    data: { spaceId: space?.id },
  });
  expect(recent.ok()).toBe(true);
  const pages = (await recent.json()).data.items as IListedPage[];
  const found = pages.find((candidate) => candidate.title === title);
  expect(found, `page ${title}`).toBeDefined();
  return `/s/${spaceSlug}/p/${found?.slugId}`;
}

async function openAssistant(page: Page, pagePath: string) {
  await page.goto(pagePath);
  await page.waitForTimeout(SHORT_PAUSE_MS);
  await page.getByRole("button", { name: "Assistent" }).click();
  await expect(page.getByText("Frag das Wiki")).toBeVisible();
  await page.waitForTimeout(SHORT_PAUSE_MS);
}

async function ask(page: Page, question: string) {
  await page.getByPlaceholder("Frage stellen …").pressSequentially(question, {
    delay: 25,
  });
  await page.getByPlaceholder("Frage stellen …").press("Enter");
}

test("ask: a cited answer that opens its source heading", async ({
  browser,
}) => {
  const recording = await startRecording(browser, "PL");
  const { page } = recording;
  const start = await pageInSpace(page, "allgemein", WELCOME_PAGE_TITLE);
  await openAssistant(page, start);

  await page.getByText("Wann ist die Kernarbeitszeit?").click();
  await expect(page.getByText("Quellen", { exact: true })).toBeVisible();
  await page.waitForTimeout(READING_PAUSE_MS);
  await page.getByRole("link", { name: /^1\. / }).first().click();
  await expect(page).toHaveURL(/#/);
  await page.waitForTimeout(READING_PAUSE_MS);

  await stopRecording(recording, "ask");
});

test("permissions: the same question, answered by role", async ({
  browser,
}) => {
  const student = await startRecording(browser, "WS");
  await openAssistant(
    student.page,
    await pageInSpace(student.page, "allgemein", WELCOME_PAGE_TITLE),
  );
  await ask(student.page, SALARY_QUESTION);
  await expect(student.page.getByText(NO_SOURCE_START)).toBeVisible();
  await student.page.waitForTimeout(READING_PAUSE_MS);
  await stopRecording(student, "permissions-student");

  const owner = await startRecording(browser, "GF");
  await openAssistant(
    owner.page,
    await pageInSpace(owner.page, "allgemein", WELCOME_PAGE_TITLE),
  );
  await ask(owner.page, SALARY_QUESTION);
  await expect(owner.page.getByText("Quellen", { exact: true })).toBeVisible();
  await expect(
    owner.page.getByRole("link", { name: new RegExp(SALARY_PAGE_TITLE) }),
  ).not.toHaveCount(0);
  await owner.page.waitForTimeout(READING_PAUSE_MS);
  await stopRecording(owner, "permissions-owner");
});

test("extraction: contract fields with quote and page", async ({ browser }) => {
  const recording = await startRecording(browser, "GF");
  const { page } = recording;
  const contractFile = "liefervertrag-pumpen-fiktivwerk.pdf";
  await page.goto(
    await pageInSpace(page, "projekte", "Liefervertrag Pumpen Fiktivwerk"),
  );
  await expect(page.getByText(contractFile)).toBeVisible();
  await page.waitForTimeout(SHORT_PAUSE_MS);

  await page.getByText(contractFile).click();
  await page.getByRole("button", { name: "Daten extrahieren" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Schema: Vertrag")).toBeVisible();
  await expect(dialog.getByLabel("Vertragswert")).not.toHaveValue("");
  await page.waitForTimeout(READING_PAUSE_MS * 2);

  await stopRecording(recording, "extraction");
});

test("agent: a proposal that is applied only after review", async ({
  browser,
}) => {
  const recording = await startRecording(browser, "GF");
  const { page } = recording;
  await openAssistant(
    page,
    await pageInSpace(page, "allgemein", "Reisekosten Richtlinie 2022"),
  );

  await page.getByRole("tab", { name: "Aufgabe" }).click();
  await page.waitForTimeout(SHORT_PAUSE_MS);
  await page
    .getByText("Finde veraltete Seiten zu Reisekosten und schlage Updates vor")
    .click();
  await page.getByRole("button", { name: "Starten" }).click();
  await expect(page.getByRole("button", { name: "Neue Aufgabe" })).toBeVisible({
    timeout: 240_000,
  });
  await page.waitForTimeout(READING_PAUSE_MS);

  await page.getByRole("button", { name: "Ansehen" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/^Vorschlag: /)).toBeVisible();
  await page.waitForTimeout(READING_PAUSE_MS);
  await dialog.getByRole("button", { name: "Übernehmen" }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(READING_PAUSE_MS);

  await stopRecording(recording, "agent");
});
