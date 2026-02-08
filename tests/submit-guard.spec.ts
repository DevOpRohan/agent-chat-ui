import { test, expect } from "@playwright/test";

function longPrompt(tag: string) {
  return `Submit guard ${tag}. Create a very detailed 40-section report with 20 bullets per section and include dense explanations and examples. Do not summarize.`;
}

test("same-thread submit is rejected while run is active and draft is preserved", async ({
  page,
}) => {
  const tag = `submit-guard-${Date.now()}`;
  const blockedPrompt = `blocked-while-running-${Date.now()}`;

  await page.goto("/?chatHistoryOpen=true");

  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });

  await input.fill(longPrompt(tag));
  await page.getByRole("button", { name: "Send" }).click();

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  await input.fill(blockedPrompt);
  await input.evaluate((element) => {
    const form = element.closest("form");
    if (!form) return;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  await expect(page.getByText("Thread is still running")).toBeVisible({
    timeout: 10_000,
  });

  await expect(input).toHaveValue(blockedPrompt, {
    timeout: 10_000,
  });

  await expect(
    page.locator("p.bg-muted", {
      hasText: blockedPrompt,
    }),
  ).toHaveCount(0);
});
