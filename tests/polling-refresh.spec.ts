import { expect, test } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

test("refresh keeps busy thread on polling path until completion", async ({
  page,
}) => {
  const prompt =
    process.env.PLAYWRIGHT_LONG_PROMPT ??
    "Write a long detailed report with many sections so the run stays active long enough to validate polling refresh behavior.";

  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });

  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(prompt, { exact: false })).toBeVisible({
    timeout: 60_000,
  });

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("thread-working-status")).toBeVisible({
    timeout: 60_000,
  });

  await page.reload();

  await expect(page.getByTestId("thread-working-status")).toBeVisible({
    timeout: 60_000,
  });

  await expect
    .poll(
      async () => page.getByTestId("thread-working-status").isVisible(),
      {
        timeout: 180_000,
        message: "Expected busy badge to clear once polling detects completion",
      },
    )
    .toBeFalsy();

  const assistantMessages = page.locator("div.group.mr-auto");
  await expect
    .poll(
      async () => {
        const count = await assistantMessages.count();
        if (count === 0) return 0;
        const text = await assistantMessages.last().textContent();
        return text?.trim().length ?? 0;
      },
      {
        timeout: 180_000,
        message: "Expected final assistant content after polling completion",
      },
    )
    .toBeGreaterThan(0);
});
