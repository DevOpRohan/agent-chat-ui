import { expect, type Page } from "@playwright/test";
import {
  gotoAndDetectChatEnvironment,
  type ChatEnvironmentGate,
} from "./environment-gates";

export const RUN_STREAM_ROUTE_PATTERN =
  /\/threads\/[^/]+\/runs(?:\/[^/]+)?\/stream(?:\?|$)/;

export async function readThreadId(page: Page): Promise<string | null> {
  return new URL(page.url()).searchParams.get("threadId");
}

export async function waitForThreadId(
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

export async function readAssistantTextLength(page: Page): Promise<number> {
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

export async function clearStaleClientState(page: Page): Promise<void> {
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

export async function openFreshThread(page: Page): Promise<void> {
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

export async function prepareFreshChatPage(
  page: Page,
): Promise<ChatEnvironmentGate> {
  const gate = await gotoAndDetectChatEnvironment(page, "/?chatHistoryOpen=true");
  if (!gate.ok) {
    return gate;
  }

  await clearStaleClientState(page);
  await page.reload();
  await openFreshThread(page);
  await expect(page.getByPlaceholder("Type your message...")).toBeVisible({
    timeout: 60_000,
  });
  return gate;
}
