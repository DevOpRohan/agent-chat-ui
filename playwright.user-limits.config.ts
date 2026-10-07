import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch:
    /(user-cost-limit|conversation-navigator|attachment-limits|pdf-pages)\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3210",
  },
});
