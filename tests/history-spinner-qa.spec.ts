import { test, expect, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

function longPrompt(tag: string) {
  return `QA spinner check ${tag}. Create a very detailed 40-section report with 20 bullets per section and include dense explanations and examples. Do not summarize.`;
}

async function sendMessage(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitForThreadId(page: Page) {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 30_000,
      message: "Expected threadId in URL",
    })
    .not.toBeNull();
}

test.describe("QA: Thread history run indicators", () => {
  test("history spinner starts/stops close to cancel spinner timing", async ({
    page,
  }) => {
    const tag = `qa-latency-${Date.now()}`;
    const gate = await gotoAndDetectChatEnvironment(
      page,
      "/?chatHistoryOpen=true",
    );
    test.skip(!gate.ok, gate.reason);

    // Warm up so the thread already exists in history before the measured run.
    await sendMessage(page, `warmup-${tag}`);
    await waitForThreadId(page);
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
      timeout: 120_000,
    });

    await sendMessage(page, longPrompt(tag));

    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeVisible({ timeout: 60_000 });
    const cancelVisibleAt = Date.now();

    const activeHistoryItem = page
      .locator('button[data-thread-active="true"]')
      .first();
    await expect(activeHistoryItem).toBeVisible({ timeout: 60_000 });
    const historySpinner = activeHistoryItem.getByLabel("Thread running");
    await expect(historySpinner).toBeVisible({ timeout: 10_000 });
    const spinnerVisibleAt = Date.now();

    expect(spinnerVisibleAt - cancelVisibleAt).toBeLessThanOrEqual(7_000);

    await cancelButton.click();
    await expect(cancelButton).not.toBeVisible({ timeout: 30_000 });
    const cancelHiddenAt = Date.now();

    await expect(historySpinner).not.toBeVisible({ timeout: 10_000 });
    const spinnerHiddenAt = Date.now();

    expect(spinnerHiddenAt - cancelHiddenAt).toBeLessThanOrEqual(7_000);
  });

  test("inactive thread never shows cancel while active thread keeps running indicator", async ({
    page,
  }) => {
    const tag = `qa-switch-${Date.now()}`;
    const gate = await gotoAndDetectChatEnvironment(
      page,
      "/?chatHistoryOpen=true",
    );
    test.skip(!gate.ok, gate.reason);
    await sendMessage(page, longPrompt(tag));

    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeVisible({ timeout: 60_000 });

    const historySpinner = page.getByLabel("Thread running").first();
    await expect(historySpinner).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /^New$/ }).first().click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("threadId"), {
        timeout: 10_000,
      })
      .toBeNull();

    await expect(page.getByRole("button", { name: "Cancel" })).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(historySpinner).toBeVisible({
      timeout: 10_000,
    });

    const sendButton = page.getByRole("button", { name: "Send" });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeDisabled();
  });
});
