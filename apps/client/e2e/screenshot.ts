import * as path from "node:path";
import { Page, TestInfo } from "@playwright/test";
import { SeedUserKey } from "../../server/src/integrations/seed/seed-definition";

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
) {
  const dir = process.env.KIT_SCREENSHOT_DIR || testInfo.outputDir;
  const suffix = process.env.KIT_SCREENSHOT_SUFFIX ?? "";
  await page.screenshot({
    path: path.join(
      dir,
      `${criterion}-${step}-${testInfo.project.name}${suffix}.png`,
    ),
    fullPage: true,
  });
}
