/**
 * The shell around the Crafter | Ingester switch, against the fake LangGraph backend
 * (tests/helpers/ingest-backend.ts): the chat stays mounted (hidden) while Ingester is on screen,
 * links that open Ingester through `ingestId` alone stay in Ingester, focus follows the switch,
 * file drops never reach the hidden chat, and a new chat is created with Crafter's graph_id.
 *
 * Run it against a local dev server whose LangGraph URL is the fake's origin:
 *
 *   env -u NEXT_PUBLIC_AUTH_MODE NEXT_PUBLIC_API_URL=http://127.0.0.1:2299 \
 *     NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent pnpm dev --port 3210
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3210 \
 *     npx playwright test tests/ingester-mode-shell.spec.ts --project=mocked-backend
 */
import type { JSHandle, Locator, Page } from "@playwright/test";

import {
  CRAFTER_GRAPH_ID,
  FAKE_API_URL,
  isLocalBaseUrl,
  type IngestBackend,
} from "./helpers/ingest-backend";
import {
  ACTIONS,
  action,
  expect,
  expectUrlParam,
  historyNewButton,
  historyRow,
  openApp,
  test,
  ui,
  urlParam,
  waitForHydration,
} from "./helpers/ingest-ui";

test.skip(
  ({ baseURL }) => !isLocalBaseUrl(baseURL),
  "Mocked-backend spec: run it against a local dev server (PLAYWRIGHT_BASE_URL=http://localhost:3210) " +
    "started with NEXT_PUBLIC_API_URL=http://127.0.0.1:2299.",
);
test.describe.configure({ mode: "parallel" });
test.use({ viewport: { width: 1440, height: 900 } });

/** Everything of the chat that must stay out of reach while another mode is on screen. */
const HIDDEN_CHAT_SELECTOR = [
  '[data-testid="pane-chat"]',
  '[data-testid="resize-handle-chat-artifact"]',
  '[data-testid="pane-artifact"]',
].join(", ");

function chatPane(page: Page) {
  return page.getByTestId("pane-chat");
}

function ingestPane(page: Page) {
  return page.getByTestId("pane-ingest");
}

function chatScroll(page: Page) {
  return page.getByTestId("chat-scroll-container");
}

/** True when the focused element sits inside the hidden chat. */
function focusIsInHiddenChat(page: Page) {
  return page.evaluate(
    (selector) => !!document.activeElement?.closest(selector),
    HIDDEN_CHAT_SELECTOR,
  );
}

/** Pixels between the chat's scroll position and its bottom. */
function distanceFromBottom(page: Page) {
  return chatScroll(page).evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
  );
}

async function switchToIngester(page: Page) {
  const $ = ui(page);
  await $.ingester.click();
  await expect($.ingester).toHaveAttribute("aria-checked", "true");
  await expect(ingestPane(page)).toBeVisible();
}

/**
 * Clicks Crafter (in Ingester's top bar). Checked through the switch's test id: back in Crafter,
 * the switch sits in the chat, which an expanded artifact covers (aria-hidden).
 */
async function switchToCrafter(page: Page) {
  await ui(page).crafter.click();
  await expect(
    page.getByTestId("mode-switch").locator('[data-mode="crafter"]'),
  ).toHaveAttribute("aria-checked", "true");
  await expect(ingestPane(page)).toHaveCount(0);
  await expect(chatPane(page)).not.toHaveAttribute("inert");
}

/** A one-pixel PNG as a DataTransfer, for synthetic drops. */
function pngTransfer(page: Page): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle(() => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "diagram.png", { type: "image/png" }));
    return transfer;
  });
}

async function dropOn(target: Locator, dataTransfer: JSHandle<DataTransfer>) {
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}

// ---------------------------------------------------------------- the chat stays mounted

test.describe("the chat stays mounted, hidden, while Ingester is on screen", () => {
  test("a draft and its composer survive Crafter -> Ingester -> Crafter; nothing hidden takes focus", async ({
    page,
  }) => {
    const $ = ui(page);
    const draft =
      "Make a fractions lesson for grade 5, with two worked examples.";
    await openApp(page);
    await waitForHydration($.composer);
    await $.composer.fill(draft);
    const composerBefore = await $.composer.elementHandle();
    expect(composerBefore).not.toBeNull();

    await switchToIngester(page);
    await expect($.upload).toBeVisible();
    await expect(chatPane(page)).toBeHidden();
    await expect(chatPane(page)).toHaveAttribute("inert", "");
    await expect($.composer).toBeHidden();
    // Still the same, connected element...
    expect(await composerBefore!.evaluate((el) => el.isConnected)).toBe(true);
    // ...that can't take focus, from script or from the keyboard.
    expect(
      await $.composer.evaluate((el) => {
        (el as HTMLElement).focus();
        return document.activeElement === el;
      }),
    ).toBe(false);
    await $.ingester.focus();
    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIsInHiddenChat(page), `Tab #${press + 1}`).toBe(false);
    }
    // One mode switch and one history toggle on the page: the hidden chat draws no top bar.
    await expect(page.getByTestId("mode-switch")).toHaveCount(1);
    await expect(page.getByTestId("chat-history-toggle")).toHaveCount(1);

    await switchToCrafter(page);
    await expect($.composer).toBeVisible();
    await expect($.composer).toHaveValue(draft);
    expect(
      await $.composer.evaluate((el, before) => el === before, composerBefore),
    ).toBe(true);
    await expect(page.getByTestId("mode-switch")).toHaveCount(1);
  });

  test("a started chat keeps its scroll position, at the bottom or part way up", async ({
    page,
    backend,
  }) => {
    const chat = backend.seedCrafterThread({
      title: "Fractions unit",
      messages: Array.from({ length: 24 }, (_, index) => ({
        type: index % 2 === 0 ? ("human" as const) : ("ai" as const),
        content: `Message ${index + 1}. ${"Fractions name equal parts of a whole. ".repeat(14)}`,
      })),
    });
    await openApp(page, { threadId: chat.thread_id });
    await expect(chatScroll(page).getByText(/^Message 24\./)).toBeVisible();
    // Twelve questions: the conversation navigator's trigger sits in the top bar too.
    // The thread opens at its bottom.
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);

    await switchToIngester(page);
    await switchToCrafter(page);
    await expect(chatScroll(page)).toBeVisible();
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2);
    await expect(
      page.getByRole("button", { name: "Scroll to bottom" }),
    ).toHaveCount(0);

    // Part way up: the reader's place is kept exactly.
    await chatScroll(page).evaluate((el) => {
      el.scrollTop = Math.floor(el.scrollHeight / 3);
    });
    await page.waitForTimeout(300);
    const scrolledTo = await chatScroll(page).evaluate((el) => el.scrollTop);
    expect(await distanceFromBottom(page)).toBeGreaterThan(100);

    await switchToIngester(page);
    await expect(chatScroll(page)).toBeHidden();
    await switchToCrafter(page);
    await expect(chatScroll(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(
      Math.abs(
        (await chatScroll(page).evaluate((el) => el.scrollTop)) - scrolledTo,
      ),
    ).toBeLessThanOrEqual(2);
  });

  test("the artifact panel keeps its width, and an expanded artifact stays expanded", async ({
    page,
  }) => {
    const $ = ui(page);
    const history = page.getByTestId("pane-history");
    const artifactPane = page.getByTestId("pane-artifact");
    const artifactText = artifactPane.getByText("Artifact panel", {
      exact: true,
    });
    const expandToggle = page.getByTestId("artifact-expand-toggle");
    const artifactWidth = async () =>
      Math.round((await artifactPane.boundingBox())?.width ?? 0);

    await openApp(page, { chatHistoryOpen: "true" });
    await expect(history).toBeVisible();
    // The panel's test control (the real trigger is an artifact in a message).
    const openControl = page.getByTestId("open-artifact-panel-test-control");
    await waitForHydration(openControl);
    await openControl.dispatchEvent("click");
    await expect(artifactText).toBeVisible();

    // Widen the panel from the keyboard, so its width is the user's, not the default.
    const initialWidth = await artifactWidth();
    await page.getByTestId("resize-handle-chat-artifact").focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(artifactWidth).toBeGreaterThan(initialWidth);
    const width = await artifactWidth();

    await switchToIngester(page);
    await expect(artifactPane).toBeHidden();
    await expect(history).toBeVisible();
    await switchToCrafter(page);
    await expect(artifactText).toBeVisible();
    await expect.poll(artifactWidth).toBe(width);

    // Expanded, the artifact covers the chat and its switch (history closes). A keyboard user
    // can still reach the covered switch; that is the way to change mode from here.
    await expect(expandToggle).toHaveAttribute(
      "aria-label",
      "Expand artifact panel",
    );
    await expandToggle.click();
    await expect(expandToggle).toHaveAttribute(
      "aria-label",
      "Restore pane layout",
    );
    await expect(history).toBeHidden();
    await page
      .getByTestId("mode-switch")
      .locator('[data-mode="crafter"]')
      .focus();
    await page.keyboard.press("ArrowRight");
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect(ingestPane(page)).toBeVisible();
    await expect(artifactPane).toBeHidden();

    await switchToCrafter(page);
    await expect(artifactText).toBeVisible();
    await expect(expandToggle).toHaveAttribute(
      "aria-label",
      "Restore pane layout",
    );
    // Restoring brings back the layout from before the expand.
    await expandToggle.click();
    await expect(history).toBeVisible();
    await expect.poll(artifactWidth).toBe(width);
  });

  test("file drops reach the chat only while Crafter is on screen", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await waitForHydration($.dropZone);
    const image = await pngTransfer(page);

    // Dropped anywhere in Ingester, an image never reaches the hidden chat draft.
    await dropOn($.dropZone, image);
    await dropOn($.upload, image);
    await dropOn(ingestPane(page), image);
    await page.waitForTimeout(1_000);
    expect(backend.calls.chatUploads).toEqual([]);

    // The page opened in Ingester, yet the chat's own drop handling works in Crafter.
    await switchToCrafter(page);
    await waitForHydration($.composer);
    await dropOn($.composer, image);
    await expect
      .poll(() => backend.calls.chatUploads.length)
      .toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- ingestId-only links

test.describe("a link with only ingestId stays in Ingester", () => {
  type Way = {
    name: string;
    params?: { chatHistoryOpen?: string };
    seed: (backend: IngestBackend) => string;
    clear: (page: Page) => Promise<void>;
  };

  const ways: Way[] = [
    {
      name: "Upload a different file",
      seed: (backend) =>
        backend.seedIngestThread({ state: "invalid_input" }).thread_id,
      clear: async (page) => {
        const $ = ui(page);
        await expect($.result).toHaveAttribute("data-status", "invalid_input");
        await action($.result, ACTIONS.uploadDifferent).click();
      },
    },
    {
      name: "History's New",
      params: { chatHistoryOpen: "true" },
      seed: (backend) => backend.seedIngestThread({ state: "valid" }).thread_id,
      clear: async (page) => {
        await expect(ui(page).result).toHaveAttribute("data-status", "valid");
        await historyNewButton(page).click();
      },
    },
    {
      name: "the logo",
      seed: (backend) => backend.seedIngestThread({ state: "valid" }).thread_id,
      clear: async (page) => {
        await expect(ui(page).result).toHaveAttribute("data-status", "valid");
        await ingestPane(page)
          .getByRole("button", { name: /Question Crafter/ })
          .click();
      },
    },
    {
      name: "Upload a topic (an ingest that isn't there)",
      seed: () => "00000000-0000-4000-8000-00000000e2e0",
      clear: async (page) => {
        await page
          .getByTestId("ingest-not-found")
          .getByRole("button", { name: "Upload a topic", exact: true })
          .click();
      },
    },
  ];

  for (const way of ways) {
    test(`${way.name} keeps Ingester and shows the upload`, async ({
      page,
      backend,
    }) => {
      const $ = ui(page);
      const ingestId = way.seed(backend);
      await openApp(page, { ingestId, ...way.params });
      await expect($.ingester).toHaveAttribute("aria-checked", "true");
      // The link's mode is written into the URL straight away (history replace).
      await expectUrlParam(page, "mode", "ingester");
      await expectUrlParam(page, "ingestId", ingestId);

      await way.clear(page);
      await expectUrlParam(page, "ingestId", null);
      await expect($.upload).toBeVisible();
      await expect($.ingester).toHaveAttribute("aria-checked", "true");
      await expectUrlParam(page, "mode", "ingester");
      await expect($.composer).toBeHidden();
    });
  }

  test("plain Crafter links never gain ?mode=", async ({ page, backend }) => {
    const $ = ui(page);
    const chat = backend.seedCrafterThread({ title: "Fractions lesson" });
    await openApp(page, { threadId: chat.thread_id });
    await expect($.crafter).toHaveAttribute("aria-checked", "true");
    await expect($.composer).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(urlParam(page, "mode")).toBeNull();
    expect(urlParam(page, "threadId")).toBe(chat.thread_id);
  });
});

// ---------------------------------------------------------------- focus

test.describe("focus follows the mode switch", () => {
  test("a page load leaves the focus alone", async ({ page }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await expect($.upload).toBeVisible();
    await expect($.ingester).not.toBeFocused();
    await expect($.crafter).not.toBeFocused();
  });

  test("clicking a mode keeps the focus on the checked option, new chat or started chat", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const chat = backend.seedCrafterThread({ title: "Fractions lesson" });

    // A new chat: the switch sits in the chat's empty-state header.
    await openApp(page);
    await $.ingester.click();
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect($.ingester).toBeFocused();
    await $.crafter.click();
    await expect($.crafter).toHaveAttribute("aria-checked", "true");
    await expect($.crafter).toBeFocused();

    // A started chat: the switch sits in the chat's top bar.
    await openApp(page, { threadId: chat.thread_id });
    await expect(
      page.getByText(/Here is a plan for Fractions lesson/),
    ).toBeVisible();
    await $.ingester.click();
    await expect($.ingester).toBeFocused();
    await $.crafter.click();
    await expect($.crafter).toBeFocused();
  });
});

// ---------------------------------------------------------------- Crafter's thread metadata

test("a new chat carries Crafter's graph_id, so it stays in History when its first run is refused", async ({
  page,
  backend,
}) => {
  const $ = ui(page);
  const apiOrigin = new URL(FAKE_API_URL).origin;
  // Refuse every run like the real backend at the daily limit (the fake would answer it).
  await page.route(
    (url) =>
      url.origin === apiOrigin &&
      /^\/threads\/[^/]+\/runs\/?$/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 429,
        headers: {
          "access-control-allow-origin":
            (await request.headerValue("origin")) ?? "*",
          "access-control-allow-credentials": "true",
          "access-control-expose-headers": "x-user-limit-code,content-type",
          "content-type": "application/json",
          "x-user-limit-code": "DAILY_COST_LIMIT_EXCEEDED",
        },
        body: JSON.stringify({ detail: "DAILY_COST_LIMIT_EXCEEDED" }),
      });
    },
  );

  const message = "Make a fractions lesson for grade 5.";
  await openApp(page);
  await waitForHydration($.composer);
  await $.composer.fill(message);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect.poll(() => backend.calls.threadCreates.length).toBe(1);
  const created = backend.calls.threadCreates[0]!;
  expect(created.body.metadata).toMatchObject({
    graph_id: CRAFTER_GRAPH_ID,
    thread_preview: message,
  });
  await expect(
    page.getByText("Daily limit reached", { exact: true }).first(),
  ).toBeVisible();

  // Crafter's history filters on graph_id: the thread is listed after a reload.
  await openApp(page, { chatHistoryOpen: "true" });
  await expect(historyRow(page, created.threadId)).toBeVisible();
});
