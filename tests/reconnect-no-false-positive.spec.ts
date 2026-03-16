import { expect, test, type Page } from "@playwright/test";
import {
  openFreshThread,
  prepareFreshChatPage,
} from "./helpers/chat-thread";

const SHORT_PROMPT_ITERATIONS = 10;
const LONG_PROMPT_ITERATIONS = 3;
const RUN_SETTLE_TIMEOUT_MS = 180_000;

const SHORT_PROMPT =
  "Think about A* heuristics and explain admissible vs consistent heuristics in exactly 5 concise bullet points with one tiny edge-cost example.";
const LONG_PROMPT =
  "Research current market trends, shares, and trading scenarios, then provide beginner-friendly suggestions in clear numbered sections with practical caution notes.";

async function prepareFreshPage(page: Page): Promise<void> {
  const gate = await prepareFreshChatPage(page);
  test.skip(!gate.ok, gate.reason);
}

async function runHealthyPromptAndAssertNoReconnect(
  page: Page,
  prompt: string,
): Promise<void> {
  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });
  const cancelButton = page.getByRole("button", { name: "Cancel" });
  const reconnectBadge = page.getByTestId("stream-reconnect-status");

  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();
  await expect(input).toHaveValue("", { timeout: 15_000 });

  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_SETTLE_TIMEOUT_MS) {
    const reconnectVisible = await reconnectBadge.isVisible().catch(() => false);
    if (reconnectVisible) {
      const reconnectText = await reconnectBadge
        .innerText()
        .catch(() => "unavailable");
      throw new Error(
        `Unexpected reconnect badge during healthy run: ${reconnectText}`,
      );
    }

    const [sendVisible, cancelVisible] = await Promise.all([
      sendButton.isVisible().catch(() => false),
      cancelButton.isVisible().catch(() => false),
    ]);

    if (sendVisible && !cancelVisible && Date.now() - startedAt > 800) {
      break;
    }

    await page.waitForTimeout(250);
  }

  await expect(sendButton).toBeVisible({ timeout: 15_000 });
  await expect(cancelButton).not.toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);
}

test("healthy short prompts never show reconnect status badge", async ({
  page,
}) => {
  await prepareFreshPage(page);

  for (let index = 1; index <= SHORT_PROMPT_ITERATIONS; index += 1) {
    await openFreshThread(page);
    await runHealthyPromptAndAssertNoReconnect(
      page,
      `${SHORT_PROMPT} (short-run ${index}/${SHORT_PROMPT_ITERATIONS})`,
    );
  }
});

test("healthy market-style prompts do not show reconnect status badge", async ({
  page,
}) => {
  await prepareFreshPage(page);

  for (let index = 1; index <= LONG_PROMPT_ITERATIONS; index += 1) {
    await openFreshThread(page);
    await runHealthyPromptAndAssertNoReconnect(
      page,
      `${LONG_PROMPT} (long-run ${index}/${LONG_PROMPT_ITERATIONS})`,
    );
  }
});
