import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.AIVANTA_E2E_BASE_URL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
});
