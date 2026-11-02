import { defineConfig, devices } from "@playwright/test";

const demoUrl = process.env.DEMO_URL || "http://127.0.0.1:3104";

export default defineConfig({
  testDir: "apps/client/e2e",
  testMatch: "*.demo.ts",
  globalSetup: "./apps/client/e2e/log-in-seed-users.ts",
  workers: 1,
  reporter: "list",
  timeout: 300_000,
  expect: { timeout: 120_000 },
  use: { baseURL: demoUrl },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
