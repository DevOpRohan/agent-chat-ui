import { expect, test, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const STREAM_ROUTE_PATTERN =
  /\/threads\/[^/]+\/runs(?:\/[^/]+)?\/stream(?:\?|$)/;

function reconciliationPrompt(tag: string): string {
  return [
    `Final reconcile validation ${tag}.`,
    "Use at least one available tool before final answer.",
    "Return exactly 24 numbered sections with 8 detailed bullets in each section.",
    "Do not summarize.",
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
  throw new Error("Expected threadId in URL after submit");
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

test("hydrates final assistant output without refresh when run finishes during stream disconnect", async ({
  page,
  context,
}) => {
  await prepareFreshPage(page);

  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });
  const cancelButton = page.getByRole("button", { name: "Cancel" });

  const tag = `${Date.now()}-final-reconcile`;
  await input.fill(reconciliationPrompt(tag));
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();

  await waitForThreadId(page);
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  await context.route(STREAM_ROUTE_PATTERN, (route) =>
    route.abort("addressunreachable"),
  );

  await page.waitForTimeout(20_000);

  const lengthWhileBlocked = await readAssistantTextLength(page);

  await context.unroute(STREAM_ROUTE_PATTERN);

  await expect
    .poll(async () => readAssistantTextLength(page), {
      timeout: 120_000,
      message:
        "Expected assistant output to render after stream unroute without page refresh",
    })
    .toBeGreaterThan(0);

  await expect
    .poll(async () => readAssistantTextLength(page), {
      timeout: 120_000,
      message:
        "Expected assistant output to stay non-regressive after stream unroute without page refresh",
    })
    .toBeGreaterThanOrEqual(lengthWhileBlocked);

  await expect(sendButton).toBeVisible({ timeout: 180_000 });
  await expect(
    page.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);
});
