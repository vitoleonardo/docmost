import * as path from "node:path";
import { Locator, Page, TestInfo } from "@playwright/test";
import { SeedUserKey } from "../../server/src/integrations/seed/seed-definition";

const VIEWPORT_MARGIN_PX = 200;

export const seedUserState = (userKey: SeedUserKey) =>
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "playwright",
    ".auth",
    `${userKey}.json`,
  );

export async function screenshot(
  page: Page,
  testInfo: TestInfo,
  criterion: string,
  step: string,
  element?: Locator,
) {
  const dir = process.env.KIT_SCREENSHOT_DIR || testInfo.outputDir;
  const suffix = process.env.KIT_SCREENSHOT_SUFFIX ?? "";
  const file = path.join(
    dir,
    `${criterion}-${step}-${testInfo.project.name}${suffix}.png`,
  );
  if (element) {
    await screenshotWholeElement(page, element, file);
    return;
  }
  await page.screenshot({ path: file, fullPage: true });
}

async function screenshotWholeElement(
  page: Page,
  element: Locator,
  file: string,
) {
  const viewport = page.viewportSize();
  const contentHeight = await element.evaluate((node) => node.scrollHeight);
  if (!viewport || contentHeight <= viewport.height) {
    await element.screenshot({ path: file });
    return;
  }
  await page.setViewportSize({
    width: viewport.width,
    height: contentHeight + VIEWPORT_MARGIN_PX,
  });
  try {
    await element.screenshot({ path: file });
  } finally {
    await page.setViewportSize(viewport);
  }
}
