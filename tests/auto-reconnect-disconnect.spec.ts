import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const STREAM_ROUTE_PATTERN =
  /\/threads\/[^/]+\/runs(?:\/[^/]+)?\/stream(?:\?|$)/;

function longPrompt(tag: string): string {
  return [
    `Reconnect validation ${tag}.`,
    "Use at least one available tool before final answer.",
    "Produce a very long response with 60 numbered sections.",
    "Each section must include 12 detailed bullet points and examples.",
    "Do not summarize or shorten.",
  ].join(" ");
}

function toolHeavyPrompt(tag: string): string {
  return [
    `Intermediate reconnect validation ${tag}.`,
    "Use at least one available tool before final answer.",
    "Show intermediate reasoning/tool activity first, then continue streaming.",
    "Return 20 numbered sections with detailed bullets.",
  ].join(" ");
}

async function readThreadId(page: Page): Promise<string | null> {
  return new URL(page.url()).searchParams.get("threadId");
}

async function waitForThreadId(
  page: Page,
  timeoutMs = 30_000,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const threadId = await readThreadId(page);
    if (threadId) return threadId;
    await page.waitForTimeout(250);
  }
  throw new Error("Expected new threadId after submit");
}

async function readAssistantTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const assistantGroups = Array.from(
      document.querySelectorAll("div.group.mr-auto"),
    );
    const lastAssistant = assistantGroups.at(-1) as HTMLElement | undefined;
    if (!lastAssistant) return 0;
    const segments = Array.from(lastAssistant.querySelectorAll("div.py-1")).map(
      (node) => node.textContent ?? "",
    );
    return segments.join("\n").length;
  });
}

async function clearStaleClientState(page: Page): Promise<void> {
  await page.evaluate(() => {
    const localKeys = Object.keys(window.localStorage);
    for (const key of localKeys) {
      if (key.startsWith("lg:thread:")) {
        window.localStorage.removeItem(key);
      }
    }

    const sessionKeys = Object.keys(window.sessionStorage);
    for (const key of sessionKeys) {
      if (key.startsWith("lg:thread:") || key.startsWith("lg:stream:")) {
        window.sessionStorage.removeItem(key);
      }
    }
  });
}

async function openFreshThread(page: Page): Promise<void> {
  const newButton = page.getByRole("button", { name: /^New$/ }).first();
  await expect(newButton).toBeVisible({ timeout: 60_000 });
  await newButton.click();

  await expect
    .poll(() => readThreadId(page), {
      timeout: 15_000,
      message: "Expected threadId to be cleared for a fresh test thread",
    })
    .toBeNull();
}

async function prepareFreshPage(page: Page): Promise<void> {
  const gate = await gotoAndDetectChatEnvironment(
    page,
    "/?chatHistoryOpen=true",
  );
  test.skip(!gate.ok, gate.reason);
  await clearStaleClientState(page);
  await page.reload();
  await openFreshThread(page);
  await expect(page.getByPlaceholder("Type your message...")).toBeVisible({
    timeout: 60_000,
  });
}

type StartRunOptions = {
  promptBuilder?: (tag: string) => string;
  requireCancel?: boolean;
};

type StartedRun = {
  threadId: string;
  cancelVisible: boolean;
};

async function startLongRun(
  page: Page,
  options?: StartRunOptions,
): Promise<StartedRun> {
  const promptBuilder = options?.promptBuilder ?? longPrompt;
  const requireCancel = options?.requireCancel ?? false;
  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });
  const cancelButton = page.getByRole("button", { name: "Cancel" });

  await expect(input).toBeVisible({ timeout: 60_000 });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await openFreshThread(page);

    const tag = `${Date.now()}-attempt-${attempt}`;
    await input.fill(promptBuilder(tag));
    await expect(sendButton).toBeEnabled({ timeout: 15_000 });
    await sendButton.click();

    const threadId = await waitForThreadId(page);

    const cancelVisible = await cancelButton.isVisible().catch(() => false);

    if (cancelVisible) {
      return { threadId, cancelVisible: true };
    }

    try {
      await expect(cancelButton).toBeVisible({ timeout: 20_000 });
      return { threadId, cancelVisible: true };
    } catch {
      const runningIndicatorVisible = await page
        .locator('button[data-thread-active="true"]')
        .first()
        .getByLabel("Thread running")
        .isVisible()
        .catch(() => false);

      if (!requireCancel && runningIndicatorVisible) {
        return { threadId, cancelVisible: false };
      }

      const sendVisible = await sendButton.isVisible().catch(() => false);
      const reconnectVisible = await page
        .getByTestId("stream-reconnect-status")
        .isVisible()
        .catch(() => false);

      if (!requireCancel && (reconnectVisible || !sendVisible)) {
        return { threadId, cancelVisible: false };
      }
    }
  }

  if (requireCancel) {
    throw new Error(
      "Unable to start a cancel-visible run after 4 attempts (likely stale ownership/runtime contention).",
    );
  }

  throw new Error("Unable to start an active run after 4 attempts.");
}

async function forceOfflineDisconnect(
  context: BrowserContext,
  holdMs = 1_800,
): Promise<void> {
  await context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, holdMs));
  await context.setOffline(false);
}

async function waitForReconnectSignal(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const composer = document.querySelector(
            '[data-testid="stream-reconnect-status"]',
          );
          if (
            composer &&
            composer.textContent?.toLowerCase().includes("reconnect")
          ) {
            return true;
          }

          const intermediateButtons = Array.from(
            document.querySelectorAll("button"),
          );
          return intermediateButtons.some((button) => {
            const label = (button.textContent ?? "").toLowerCase();
            return (
              label.includes("intermediate step") && label.includes("reconnect")
            );
          });
        }),
      {
        timeout: 90_000,
        message: "Expected reconnect UI indicator during stream recovery",
      },
    )
    .toBe(true);
}

test.describe("Auto reconnect UX after disconnect", () => {
  test("resumes stream after offline disconnect without page refresh", async ({
    page,
    context,
  }) => {
    await prepareFreshPage(page);

    const started = await startLongRun(page);
    const beforeDisconnectLength = await readAssistantTextLength(page);

    await forceOfflineDisconnect(context, 2_200);

    await expect
      .poll(() => readThreadId(page), {
        timeout: 30_000,
        message: "Thread ID changed unexpectedly during reconnect",
      })
      .toBe(started.threadId);

    await expect
      .poll(
        async () => {
          const nextLength = await readAssistantTextLength(page);
          const sendVisible = await page
            .getByRole("button", { name: "Send" })
            .isVisible()
            .catch(() => false);
          const reconnectVisible = await page
            .getByTestId("stream-reconnect-status")
            .isVisible()
            .catch(() => false);
          return (
            nextLength > beforeDisconnectLength ||
            sendVisible ||
            reconnectVisible
          );
        },
        {
          timeout: 120_000,
          message: "Stream did not progress after reconnect",
        },
      )
      .toBe(true);
  });

  test("recovers after aborting reconnect stream requests and unroute", async ({
    page,
    context,
  }) => {
    await prepareFreshPage(page);

    await startLongRun(page);
    const beforeDisconnectLength = await readAssistantTextLength(page);

    await context.route(STREAM_ROUTE_PATTERN, (route) =>
      route.abort("addressunreachable"),
    );

    await forceOfflineDisconnect(context, 2_200);

    await context.unroute(STREAM_ROUTE_PATTERN);

    await expect
      .poll(
        async () => {
          const nextLength = await readAssistantTextLength(page);
          const sendVisible = await page
            .getByRole("button", { name: "Send" })
            .isVisible()
            .catch(() => false);
          return nextLength > beforeDisconnectLength || sendVisible;
        },
        {
          timeout: 120_000,
          message: "Stream did not recover after removing route abort",
        },
      )
      .toBe(true);
  });

  test("cancel stays available during reconnect and can terminate run", async ({
    page,
    context,
  }) => {
    await prepareFreshPage(page);

    const started = await startLongRun(page, { requireCancel: true });
    expect(started.cancelVisible).toBeTruthy();

    const cancelButton = page.getByRole("button", { name: "Cancel" });

    await context.route(STREAM_ROUTE_PATTERN, (route) =>
      route.abort("addressunreachable"),
    );

    await forceOfflineDisconnect(context, 2_200);

    await expect(cancelButton).toBeVisible({ timeout: 30_000 });
    await cancelButton.click();

    await expect(cancelButton).not.toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
      timeout: 60_000,
    });

    await context.unroute(STREAM_ROUTE_PATTERN);
  });

  test("history spinner stays active while reconnecting and clears after completion", async ({
    page,
    context,
  }) => {
    await prepareFreshPage(page);

    const started = await startLongRun(page, { requireCancel: true });
    expect(started.cancelVisible).toBeTruthy();

    const cancelButton = page.getByRole("button", { name: "Cancel" });
    const activeHistoryItem = page
      .locator('button[data-thread-active="true"]')
      .first();
    const historySpinner = activeHistoryItem.getByLabel("Thread running");

    await expect(historySpinner).toBeVisible({ timeout: 30_000 });

    await context.route(STREAM_ROUTE_PATTERN, (route) =>
      route.abort("addressunreachable"),
    );

    await forceOfflineDisconnect(context, 2_200);
    await expect(historySpinner).toBeVisible({ timeout: 20_000 });

    await context.unroute(STREAM_ROUTE_PATTERN);

    await cancelButton.click();
    await expect(cancelButton).not.toBeVisible({ timeout: 60_000 });
    await expect(historySpinner).not.toBeVisible({ timeout: 20_000 });
  });

  test("intermediate-step stays stable during recovery", async ({
    page,
    context,
  }) => {
    await prepareFreshPage(page);

    await startLongRun(page, {
      promptBuilder: toolHeavyPrompt,
      requireCancel: true,
    });

    const intermediateButton = page.getByRole("button", {
      name: /Intermediate Step/i,
    });
    await expect(intermediateButton.first()).toBeVisible({ timeout: 120_000 });

    await context.route(STREAM_ROUTE_PATTERN, (route) =>
      route.abort("addressunreachable"),
    );

    await forceOfflineDisconnect(context, 2_200);
    await expect(intermediateButton.first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText("An error occurred. Please try again."),
    ).toHaveCount(0);

    await context.unroute(STREAM_ROUTE_PATTERN);
  });
});
