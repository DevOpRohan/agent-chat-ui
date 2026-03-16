import { test, expect } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

test("thread history lists new thread", async ({ page }) => {
  const unique = `history-check-${Date.now()}`;
  const prompt = `Thread history check: ${unique}`;

  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });

  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  const historyHeading = page.getByRole("heading", { name: "Chat History" });
  await expect(historyHeading).toBeVisible({ timeout: 60_000 });

  const historyPanel = page.locator("div", { has: historyHeading });
  const historyItem = historyPanel
    .locator("button[data-thread-id]", { hasText: unique })
    .first();

  await expect(historyItem).toBeVisible({ timeout: 120_000 });

  await page.getByRole("button", { name: /^New$/ }).first().click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 15_000,
    })
    .toBeNull();

  await historyItem.click();
  await expect(page.getByText(prompt, { exact: false })).toBeVisible({
    timeout: 60_000,
  });
});
