import {
  Browser,
  expect,
  Locator,
  Page,
  test,
  TestInfo,
} from "@playwright/test";
import { screenshot, seedUserState } from "./screenshot";

const SPACE_SLUG = "projekte";
const CONTRACT_PAGE_TITLE = "Liefervertrag Pumpen Fiktivwerk";
const CONTRACT_FILE = "liefervertrag-pumpen-fiktivwerk.pdf";
const REVIEWER_NAME = "Jörg Ostmoor";
const CONTRACT_VALUE = "1.200.000,00 EUR netto";
const PAGE_LOAD_TIMEOUT_MS = 30_000;
const MIN_READABLE_VALUE_WIDTH_PX = 140;

const EXTRACTED_FIELDS = [
  {
    key: "parties",
    value: "Ostmooimooi Anlagenbau GmbH und Fiktivwerk Pumpen GmbH",
    quote:
      "Dieser Liefervertrag wird geschlossen zwischen Ostmooimooi Anlagenbau GmbH und Fiktivwerk Pumpen GmbH, Pumpenallee 3, 00000 Beispielhafen.",
    pdfPage: 1,
  },
  {
    key: "term",
    value: "Der Liefervertrag gilt bis zum 31.12.2027",
    quote: "Der Liefervertrag gilt bis zum 31.12.2027.",
    pdfPage: 1,
  },
  {
    key: "noticePeriod",
    value: "Kündigungsfrist von 30 Tagen zum Monatsende",
    quote:
      "Jede Partei kann den Vertrag mit einer Kündigungsfrist von 30 Tagen zum Monatsende schriftlich kündigen.",
    pdfPage: 1,
  },
  {
    key: "value",
    value: CONTRACT_VALUE,
    quote: `Der Gesamtauftragswert beträgt ${CONTRACT_VALUE}.`,
    pdfPage: 1,
  },
  {
    key: "renewal",
    value: "einmaligen Verlängerung um 12 Monate",
    quote:
      "Die Käuferin hat bis zum 30.09.2027 das Recht zur einmaligen Verlängerung um 12 Monate durch schriftliche Erklärung.",
    pdfPage: 1,
  },
];

const ALL_FOUND_RESULT = { outcome: "extracted", fields: EXTRACTED_FIELDS };

const RENEWAL_NOT_FOUND_RESULT = {
  outcome: "extracted",
  fields: EXTRACTED_FIELDS.map((field) =>
    field.key === "renewal"
      ? { key: field.key, value: null, quote: null, pdfPage: null }
      : field,
  ),
};

const NO_TEXT_LAYER_RESULT = {
  outcome: "refused",
  reason: "no_text_layer",
  pageCount: 1,
  fileSize: 52_000,
  characterCount: 0,
};

const NO_TEXT_LAYER_TEXT =
  "Diese PDF enthält keinen Text (vermutlich eingescannt). Texterkennung ist in dieser Version nicht enthalten.";

interface IListedPage {
  id: string;
  slugId: string;
  title: string;
}

function germanToday(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${now.getFullYear()}`;
}

async function expectValueReadable(dialog: Locator, label: string) {
  const dialogBox = await dialog.boundingBox();
  const inputBox = await dialog.getByLabel(label).boundingBox();
  if (!dialogBox || !inputBox) {
    throw new Error(`the dialog or the field ${label} is not rendered`);
  }
  expect(inputBox.width).toBeGreaterThanOrEqual(MIN_READABLE_VALUE_WIDTH_PX);
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(
    dialogBox.x + dialogBox.width,
  );
}

function phoneDialog(dialog: Locator, testInfo: TestInfo): Locator | undefined {
  return testInfo.project.name === "mobile" ? dialog : undefined;
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

async function contractPagePath(page: Page): Promise<string> {
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
  const listed = items.find(
    (candidate) => candidate.title === CONTRACT_PAGE_TITLE,
  );
  expect(listed).toBeDefined();
  return `/s/${SPACE_SLUG}/p/${listed?.slugId}`;
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

async function mockExtraction(page: Page, result: object) {
  await page.route("**/api/ai/extract", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: result, success: true, status: 200 }),
    }),
  );
}

async function openContractPage(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByText(CONTRACT_FILE)).toBeVisible({
    timeout: PAGE_LOAD_TIMEOUT_MS,
  });
}

async function revealExtractButton(page: Page) {
  await page.getByText(CONTRACT_FILE).click();
  const button = page.getByRole("button", { name: "Daten extrahieren" });
  await expect(button).toBeVisible();
  return button;
}

async function expectInsertedTable(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Vertragsdaten" }),
  ).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT_MS });
  await expect(
    page.getByText(
      `Aus ${CONTRACT_FILE}, geprüft von ${REVIEWER_NAME} am ${germanToday()}.`,
    ),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Vertragswert" });
  await expect(row).toContainText(CONTRACT_VALUE);
  await expect(row).not.toContainText("(manuell)");
}

async function secondEditor(browser: Browser, path: string) {
  const context = await browser.newContext({
    storageState: seedUserState("GF"),
  });
  const page = await context.newPage();
  await mockAssistantStatus(page, "available");
  await openContractPage(page, path);
  return { context, page };
}

test.describe("GF extracts contract data", () => {
  test.use({ storageState: seedUserState("GF") });

  test.beforeEach(async ({ page }) => {
    await setLocale(page, "de-DE");
    await mockAssistantStatus(page, "available");
  });

  test.afterEach(async ({ page }) => {
    await setLocale(page, "en-US");
  });

  test("EXTRACT-AC1: E1 offers Daten extrahieren on the PDF attachment", async ({
    page,
  }, testInfo) => {
    const path = await contractPagePath(page);
    await openContractPage(page, path);

    await revealExtractButton(page);

    await screenshot(page, testInfo, "EXTRACT-AC1", "e1");
  });

  test("EXTRACT-AC2: the selected embedded PDF shows Daten extrahieren without hover", async ({
    page,
  }, testInfo) => {
    const path = await contractPagePath(page);
    await openContractPage(page, path);
    await page.getByText(CONTRACT_FILE).click();
    await page.getByRole("button", { name: "Als PDF einbetten" }).click();

    const pageContent = page.getByLabel("Seiteninhalt", { exact: true });
    const embeddedPdf = pageContent.locator(".node-pdf");
    const button = embeddedPdf.getByRole("button", {
      name: "Daten extrahieren",
    });
    const menu = button.locator("xpath=..");
    try {
      await expect(embeddedPdf.locator("iframe")).toBeAttached();
      await page.mouse.move(0, 0);
      await pageContent.focus();
      await page.keyboard.press("ArrowUp");
      await expect(menu).toHaveCSS("opacity", "0");
      await page.keyboard.press("ArrowDown");

      await expect(
        embeddedPdf.locator(".ProseMirror-selectednode"),
      ).toHaveCount(1);
      await expect(button).toBeVisible();
      await expect(menu).toHaveCSS("opacity", "1");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(menu).toHaveCSS("opacity", "1");
      await screenshot(page, testInfo, "EXTRACT-AC2", "e1-embedded");
    } finally {
      await pageContent.focus();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(page.getByText(CONTRACT_FILE)).toBeVisible();
      const restored = await page.context().newPage();
      await openContractPage(restored, path);
      await expect(restored.locator(".node-pdf")).toHaveCount(0);
      await restored.close();
    }
  });

  test("EXTRACT-AC9: E2 shows all five rows with quotes and pages", async ({
    page,
  }, testInfo) => {
    await mockExtraction(page, ALL_FOUND_RESULT);
    const path = await contractPagePath(page);
    await openContractPage(page, path);

    await (await revealExtractButton(page)).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Schema: Vertrag")).toBeVisible();
    await expect(dialog.getByText("Seite 1")).toHaveCount(5);
    await expect(
      dialog.getByText(`„Der Gesamtauftragswert beträgt ${CONTRACT_VALUE}.“`),
    ).toBeVisible();
    await expect(dialog.getByLabel("Vertragswert")).toHaveValue(CONTRACT_VALUE);
    await expect(dialog.getByText("Nicht gefunden")).toHaveCount(0);
    await expect(dialog.getByText("ohne Quelle")).toHaveCount(0);
    await screenshot(
      page,
      testInfo,
      "EXTRACT-AC9",
      "e2",
      phoneDialog(dialog, testInfo),
    );
  });

  test("EXTRACT-AC14: E2 flags Verlängerung as not found", async ({
    page,
  }, testInfo) => {
    await mockExtraction(page, RENEWAL_NOT_FOUND_RESULT);
    const path = await contractPagePath(page);
    await openContractPage(page, path);

    await (await revealExtractButton(page)).click();

    const dialog = page.getByRole("dialog");
    const renewal = dialog.getByRole("row").filter({ hasText: "Verlängerung" });
    const input = renewal.getByLabel("Verlängerung");
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute(
      "placeholder",
      "Wert manuell eintragen",
    );
    await expect(renewal.getByText("Nicht gefunden")).toBeVisible();
    await expect(
      renewal.getByText("Keine Fundstelle im Dokument."),
    ).toBeVisible();
    await expect(dialog.getByText("1 Feld ohne Quelle")).toBeVisible();
    await screenshot(
      page,
      testInfo,
      "EXTRACT-AC14",
      "e2-not-found",
      phoneDialog(dialog, testInfo),
    );
  });

  test("EXTRACT-AC69: every Wert input stays readable beside long quotes", async ({
    page,
  }, testInfo) => {
    await mockExtraction(page, RENEWAL_NOT_FOUND_RESULT);
    const path = await contractPagePath(page);
    await openContractPage(page, path);

    await (await revealExtractButton(page)).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("1 Feld ohne Quelle")).toBeVisible();
    for (const label of [
      "Vertragsparteien",
      "Laufzeit",
      "Kündigungsfrist",
      "Vertragswert",
      "Verlängerung",
    ]) {
      await expectValueReadable(dialog, label);
    }
    await screenshot(page, testInfo, "EXTRACT-AC69", "e2-values", dialog);
  });

  test("EXTRACT-AC32: E3 explains that a scanned PDF has no text", async ({
    page,
  }, testInfo) => {
    await mockExtraction(page, NO_TEXT_LAYER_RESULT);
    const path = await contractPagePath(page);
    await openContractPage(page, path);

    await (await revealExtractButton(page)).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(NO_TEXT_LAYER_TEXT)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Schließen", exact: true }),
    ).toBeVisible();
    await screenshot(page, testInfo, "EXTRACT-AC32", "e3");

    await dialog
      .getByRole("button", { name: "Schließen", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  });

  test("EXTRACT-AC21, EXTRACT-AC27: E4 inserts the table and a second browser sees it without reload", async ({
    page,
    browser,
  }, testInfo) => {
    await mockExtraction(page, ALL_FOUND_RESULT);
    const path = await contractPagePath(page);
    await openContractPage(page, path);
    const second = await secondEditor(browser, path);

    try {
      await (await revealExtractButton(page)).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Als Tabelle einfügen" })
        .click();

      await expectInsertedTable(page);
      await expectInsertedTable(second.page);
      await page.getByRole("heading", { name: "Vertragsdaten" }).click();
      await page.mouse.move(0, 0);
      await expect(
        page.getByRole("button", { name: "Kopfzeile umschalten" }),
      ).toHaveCount(0);
      await screenshot(page, testInfo, "EXTRACT-AC21", "e4");
      await screenshot(second.page, testInfo, "EXTRACT-AC27", "e4-second");

      await page.getByRole("heading", { name: "Vertragsdaten" }).click();
      await page.keyboard.press("ControlOrMeta+z");
      await expect(
        page.getByRole("heading", { name: "Vertragsdaten" }),
      ).toHaveCount(0);
      await expect(
        second.page.getByRole("heading", { name: "Vertragsdaten" }),
      ).toHaveCount(0);
    } finally {
      await second.context.close();
    }
  });
});
