import { test, expect } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

test("thread history lists new thread", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const unique = `history-check-${Date.now()}`;
  const prompt = `Thread history check: ${unique}`;

  const gate = await gotoAndDetectChatEnvironment(page, "/?chatHistoryOpen=true");
  test.skip(!gate.ok, gate.reason);

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });

  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  const historyHeading = page.getByRole("heading", { name: "Chat History" });
  await expect(historyHeading).toBeVisible({ timeout: 60_000 });

  const historyPanel = page.getByTestId("pane-history");
  await expect(historyPanel).toBeVisible({ timeout: 60_000 });
  const historyItem = historyPanel
    .locator("button[data-thread-id]", { hasText: unique })
    .first();

  await expect(historyItem).toBeVisible({ timeout: 120_000 });

  const newThreadButton = historyPanel.getByRole("button", { name: /^New$/ });
  await expect(newThreadButton).toBeVisible({ timeout: 60_000 });
  await newThreadButton.click();
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
