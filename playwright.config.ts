import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  "https://develop---agent-chat-ui-6duluzey3a-el.a.run.app";
const authFile = "playwright/.auth/user.json";

const authBearer = process.env.PLAYWRIGHT_AUTH_BEARER;

/**
 * Specs that bring their own fake LangGraph backend (page.route) and never sign in. They run in
 * their own project, without the IAP `setup` dependency or its storageState, and skip themselves
 * unless the base URL is a local dev server.
 */
const MOCKED_BACKEND_SPECS = /ingester-mode(-shell)?\.spec\.ts$/;

/** Vitest unit tests (`*.test.ts`, run by `pnpm test`), never Playwright's. */
const UNIT_TESTS = /[\\/]tests[\\/]unit[\\/]/;

export default defineConfig({
  testDir: "./tests",
  testIgnore: [UNIT_TESTS],
  timeout: 5 * 60 * 1000,
  expect: {
    timeout: 30 * 1000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: authBearer
      ? {
          Authorization: `Bearer ${authBearer}`,
        }
      : undefined,
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      testIgnore: [UNIT_TESTS],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      dependencies: ["setup"],
      testIgnore: [/.*\.setup\.ts/, UNIT_TESTS, MOCKED_BACKEND_SPECS],
    },
    {
      name: "mocked-backend",
      testMatch: MOCKED_BACKEND_SPECS,
      testIgnore: [UNIT_TESTS],
      timeout: 2 * 60 * 1000,
      expect: { timeout: 15 * 1000 },
      use: {
        ...devices["Desktop Chrome"],
        // Desktop width is set per test where it matters (the history panel needs >= 1024 px).
        viewport: { width: 1440, height: 900 },
        // These specs never sign in; the IAP bearer must not leak to the fake backend.
        extraHTTPHeaders: {},
      },
    },
  ],
});
