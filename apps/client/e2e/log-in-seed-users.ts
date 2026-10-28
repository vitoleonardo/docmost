import { chromium, expect, FullConfig, Page } from "@playwright/test";
import {
  SEED_DEMO_PASSWORD,
  SeedUser,
  SEED_USERS,
} from "../../server/src/integrations/seed/seed-definition";
import { seedUserState } from "./screenshot";

const LOGIN_THROTTLE_WINDOW_MS = 61_000;

async function submitLogin(page: Page, user: SeedUser) {
  await page.goto("/login");
  await page.getByPlaceholder("email@example.com").fill(user.email);
  await page.locator('input[type="password"]').fill(SEED_DEMO_PASSWORD);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/auth/login"),
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  return response.status();
}

export default async function logInSeedUsers(config: FullConfig) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  try {
    for (const user of SEED_USERS) {
      const page = await browser.newPage({ baseURL });
      if ((await submitLogin(page, user)) === 429) {
        await page.waitForTimeout(LOGIN_THROTTLE_WINDOW_MS);
        await submitLogin(page, user);
      }
      await expect(page).not.toHaveURL(/\/login/);
      await page.context().storageState({ path: seedUserState(user.key) });
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
}
