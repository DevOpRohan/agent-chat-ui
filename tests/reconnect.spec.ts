import { test, expect } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

test("refresh resumes or keeps run active", async ({ page }) => {
  const prompt =
    process.env.PLAYWRIGHT_LONG_PROMPT ??
    "Write a very long, detailed story with multiple sections, including a summary at the end.";

  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });

  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  // Capture current assistant message text to detect future updates.
  const assistantMessages = page.locator("div.group.mr-auto");
  const beforeText = (await assistantMessages.last().textContent()) ?? "";

  await page.reload();
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  // After refresh, expect streaming to continue (text should change).
  await page.waitForFunction(
    (prev) => {
      const nodes = document.querySelectorAll("div.group.mr-auto");
      const last = nodes[nodes.length - 1];
      if (!last) return false;
      return (last.textContent ?? "") !== prev;
    },
    beforeText,
    { timeout: 90_000 },
  );
});
