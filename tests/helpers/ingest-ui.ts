/**
 * Ingester mode e2e: the `test` fixture (a fresh fake backend per test), the agreed selector
 * contract, and the creator-facing copy the spec expects (taken from topic-ingester's
 * src/lib/topic-file.ts, status-copy.ts and progress.ts, which the app ports unchanged).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  expect,
  test as base,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { IngestBackend } from "./ingest-backend";
import { attachReactErrorMonitor } from "./react-error-monitor";

// ---------------------------------------------------------------- fixture

export const test = base.extend<{ backend: IngestBackend }>({
  backend: [
    async ({ page, baseURL }, provide, testInfo) => {
      const backend = new IngestBackend({
        appUrl: baseURL ?? "http://localhost:3210",
      });
      await backend.install(page);
      const monitor = attachReactErrorMonitor(page);
      await provide(backend);
      monitor.dispose();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("fake-langgraph.json", {
          body: JSON.stringify(backend.snapshot(), null, 2),
          contentType: "application/json",
        });
      }
      // Ingester never talks to OpenAI, from any test.
      expect(backend.openAiRequests(), "requests to OpenAI").toEqual([]);
      monitor.assertClean();
    },
    { auto: true },
  ],
});

export { expect };

// ---------------------------------------------------------------- copy

/** topic-file.ts FILE_MESSAGES. */
export const FILE_MESSAGES = {
  notJson:
    "This platform takes the .json file. Ask your assistant for the .json it made from your .md.",
  tooLarge:
    "This file is bigger than 10 MB, which is more than the platform accepts. Check that it's your topic's .json file, or ask your assistant to make it again.",
  notTopic:
    "This file doesn't look like a topic. Please pick the .json your assistant made for your topic with the TopicCrafter skill.",
} as const;

/** progress.ts STEP_LABELS. */
export const STEP_LABELS = {
  read: "Reading your topic",
  check: "Checking every question",
  fix: "Fixing small formatting issues",
  recheck: "Re-checking",
  finish: "Preparing your preview",
} as const;

export const ACTIONS = {
  ingest: "Ingest topic",
  openPreview: "Open preview",
  downloadReport: "Download report for your assistant",
  downloadMd: "Download the .md",
  downloadJson: "Download the .json",
  runAgain: "Run again",
  uploadDifferent: "Upload a different file",
  uploadNew: "Upload the new .json",
} as const;

const ATTENTION_TITLE = "A few things need your attention.";
const NOT_FINISHED_TITLE = "We couldn't finish checking.";

/** status-copy.ts titles, plus the stalled banner and the UI-only statuses. */
export const STATUS_TITLES = {
  valid: "Your topic is ready.",
  fixed: "We fixed a few small formatting issues. Your topic is ready.",
  needs_author_fixes: ATTENTION_TITLE,
  updater_failed: ATTENTION_TITLE,
  validation_incomplete: NOT_FINISHED_TITLE,
  invalid_input: "We couldn't read this file.",
  failed_to_start: "We couldn't start the ingestion.",
  // A run that crashed reads like validation_incomplete: not the topic's fault, run it again.
  run_error: NOT_FINISHED_TITLE,
  stalled: "This is taking longer than expected.",
} as const;

export type ResultStatus = keyof typeof STATUS_TITLES;

/** The one primary action each result offers. */
export const PRIMARY_ACTION: Record<ResultStatus, string> = {
  valid: ACTIONS.openPreview,
  fixed: ACTIONS.openPreview,
  needs_author_fixes: ACTIONS.downloadReport,
  updater_failed: ACTIONS.downloadReport,
  validation_incomplete: ACTIONS.runAgain,
  invalid_input: ACTIONS.uploadDifferent,
  failed_to_start: ACTIONS.runAgain,
  run_error: ACTIONS.runAgain,
  // Still busy, so Run again waits (disabled); uploading a different file leads.
  stalled: ACTIONS.uploadDifferent,
};

export const COPY = {
  validationIncompleteBody:
    "Our checking service was busy. Your topic isn't the problem. Please try again; there's no need to change anything.",
  stalledBody:
    "We haven't had a result from our checking service yet. Your topic isn't the problem. You can wait a little longer, or upload it again.",
  updaterFailedNote:
    "Our automatic fix step didn't work this time, so these are still open.",
  reportInstructions:
    "Give this report and your topic's .md file to your assistant (TopicCrafter), ask it to fix only these issues, then upload the new .json here.",
  /** plainInvalidInputMessage(INVALID_INPUT_MESSAGE). */
  invalidInputBody:
    "The file is not valid JSON (line 3, column 3: Expecting ',' delimiter).",
  hintIssue: "The hint needs to end as a statement, with a full stop.",
  dailyLimitTitle: "Daily limit reached",
  dailyLimitBody:
    "You’ve reached your daily limit. It resets at midnight IST. To get more credits, please contact your reporting manager.",
} as const;

// ---------------------------------------------------------------- selectors

export const COMPOSER_PLACEHOLDER = "Type your message...";

export function ui(page: Page) {
  const modeSwitch = page.getByRole("radiogroup", { name: "Mode" });
  const upload = page.getByTestId("ingest-upload");
  return {
    modeSwitch,
    modeSwitchById: page.getByTestId("mode-switch"),
    crafter: modeSwitch.getByRole("radio", { name: "Crafter", exact: true }),
    ingester: modeSwitch.getByRole("radio", { name: "Ingester", exact: true }),
    composer: page.getByPlaceholder(COMPOSER_PLACEHOLDER),
    pane: page.getByTestId("ingest-pane"),
    upload,
    dropZone: page.getByTestId("ingest-drop-zone"),
    fileInput: page.getByTestId("ingest-file-input"),
    fileSummary: page.getByTestId("ingest-file-summary"),
    fileProblem: upload.getByRole("alert"),
    ingestButton: page.getByRole("button", {
      name: ACTIONS.ingest,
      exact: true,
    }),
    enabledIngestButton: page.getByRole("button", {
      name: ACTIONS.ingest,
      exact: true,
      disabled: false,
    }),
    progress: page.getByTestId("ingest-progress"),
    steps: page.getByTestId("ingest-progress").locator("li[data-step-state]"),
    result: page.getByTestId("ingest-result"),
    budget: page.getByTestId("daily-budget"),
    historyToggle: page.getByTestId("chat-history-toggle"),
  };
}

/** A progress step by its label. */
export function step(page: Page, label: string): Locator {
  return ui(page).steps.filter({ hasText: label });
}

/** An action that may be a button or a link (exact name). */
export function action(scope: Page | Locator, name: string): Locator {
  return scope
    .getByRole("button", { name, exact: true })
    .or(scope.getByRole("link", { name, exact: true }));
}

/** Desktop (>= 1024 px) shows history in a side pane; phones in a sheet (dialog). */
export function historyPanel(page: Page): Locator {
  const width = page.viewportSize()?.width ?? 1440;
  return width >= 1024
    ? page.getByTestId("pane-history")
    : page.getByRole("dialog");
}

export function historyHeading(page: Page): Locator {
  return historyPanel(page).getByRole("heading", {
    name: "History",
    exact: true,
  });
}

export function historyRows(page: Page): Locator {
  return historyPanel(page).locator("button[data-thread-id]");
}

export function historyRow(page: Page, threadId: string): Locator {
  return historyPanel(page).locator(`button[data-thread-id="${threadId}"]`);
}

/** The New button of the history panel. */
export function historyNewButton(page: Page): Locator {
  return historyPanel(page).getByRole("button", { name: /^New$/ });
}

// ---------------------------------------------------------------- navigation

export type AppParams = Partial<
  Record<"mode" | "threadId" | "ingestId" | "chatHistoryOpen", string>
>;

export function appPath(params: AppParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return query ? `/?${query}` : "/";
}

/**
 * Waits until React has hydrated the element (it carries React's props), so clicks and file
 * inputs reach their handlers. Server-rendered HTML is visible before that, and an event
 * fired too early is lost.
 */
export async function waitForHydration(locator: Locator) {
  await expect(locator.first()).toBeAttached({ timeout: 90_000 });
  await expect
    .poll(
      () =>
        locator
          .first()
          .evaluate((el) =>
            Object.keys(el).some((key) => key.startsWith("__reactProps$")),
          ),
      { timeout: 60_000, message: "React hydration" },
    )
    .toBe(true);
}

/** Opens the app; waits for the hydrated mode switch (generous: the dev server may still compile). */
export async function openApp(page: Page, params: AppParams = {}) {
  await page.goto(appPath(params), { waitUntil: "domcontentloaded" });
  const { modeSwitch } = ui(page);
  await expect(modeSwitch).toBeVisible({ timeout: 90_000 });
  await waitForHydration(modeSwitch.getByRole("radio").first());
}

export function urlParam(page: Page, key: string): string | null {
  return new URL(page.url()).searchParams.get(key);
}

export async function expectUrlParam(
  page: Page,
  key: string,
  value: string | null,
) {
  await expect
    .poll(() => urlParam(page, key), { message: `URL ?${key}` })
    .toBe(value);
}

/** Ingester's upload view: pick a file (once the input is hydrated). */
export async function chooseFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const { fileInput } = ui(page);
  await waitForHydration(fileInput);
  await fileInput.setInputFiles(file);
}

// ---------------------------------------------------------------- theme and screenshots

export type Theme = "light" | "dark";

/** next-themes (attribute="class", defaultTheme="system"): both the stored choice and the OS. */
export async function applyTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("theme", value);
    } catch {
      // Storage can be unavailable; the media emulation still applies.
    }
  }, theme);
}

/** Screenshots go to INGEST_E2E_SCREENSHOT_DIR when set, else to the test's output folder. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.INGEST_E2E_SCREENSHOT_DIR ?? testInfo.outputPath();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

/** True when nothing inside the element sticks out sideways (no horizontal scroll). */
export async function fitsWidth(locator: Locator, viewportWidth: number) {
  const box = await locator.boundingBox();
  const inner = await locator.evaluate(
    (el) => el.scrollWidth <= el.clientWidth + 1,
  );
  return (
    !!box && box.x >= -1 && box.x + box.width <= viewportWidth + 1 && inner
  );
}
