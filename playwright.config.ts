import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.KIT_APP_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "apps/client/e2e",
  testMatch: "*.screenshots.ts",
  globalSetup: "./apps/client/e2e/log-in-seed-users.ts",
  workers: 1,
  reporter: "list",
  use: { baseURL: appUrl },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm start",
    url: appUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
