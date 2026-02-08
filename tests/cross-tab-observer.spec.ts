import { expect, test, type Page } from "@playwright/test";

function longPrompt(tag: string) {
  return `Cross-tab observer ${tag}. Create a very detailed 40-section report with 20 bullets per section and include dense explanations and examples. Do not summarize.`;
}

async function sendMessage(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test("second tab observes active run without fatal stream error toast", async ({
  page,
}) => {
  const tag = `cross-tab-${Date.now()}`;
  const draftText = `draft-${Date.now()}`;

  await page.goto("/?chatHistoryOpen=true");
  await sendMessage(page, longPrompt(tag));

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 30_000,
      message: "Expected threadId in URL",
    })
    .not.toBeNull();

  const threadId = new URL(page.url()).searchParams.get("threadId");
  if (!threadId) {
    throw new Error("Expected threadId in URL after run start");
  }

  const primaryUrl = new URL(page.url());
  primaryUrl.searchParams.set("threadId", String(threadId));

  const secondPage = await page.context().newPage();
  await secondPage.goto(primaryUrl.toString());

  const secondInput = secondPage.getByPlaceholder("Type your message...");
  await expect(secondInput).toBeVisible({ timeout: 60_000 });
  await secondInput.fill(draftText);

  const sendButton = secondPage.getByRole("button", { name: "Send" });
  await expect(sendButton).toBeDisabled();

  await expect(
    secondPage.getByText(/Working on your query/),
  ).toBeVisible();

  await secondPage.waitForTimeout(4_000);
  await expect(secondPage.getByText("Human Interrupt")).toHaveCount(0);
  await expect(
    secondPage.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);

  await cancelButton.click();
  await expect(cancelButton).not.toBeVisible({ timeout: 30_000 });

  await expect
    .poll(async () => {
      try {
        const refreshedInput = secondPage.getByPlaceholder("Type your message...");
        await refreshedInput.fill(draftText);
        return secondPage.getByRole("button", { name: "Send" }).isDisabled();
      } catch {
        return true;
      }
    }, {
      timeout: 60_000,
      message: "Expected send button to re-enable after active run ends",
    })
    .toBe(false);

  await expect(
    secondPage.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);

  await secondPage.close();
});
