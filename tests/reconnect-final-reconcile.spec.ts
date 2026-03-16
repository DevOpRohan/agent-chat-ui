import { expect, test, type Page } from "@playwright/test";
import {
  prepareFreshChatPage,
  readAssistantTextLength,
  RUN_STREAM_ROUTE_PATTERN,
  waitForThreadId,
} from "./helpers/chat-thread";

function reconciliationPrompt(tag: string): string {
  return [
    `Final reconcile validation ${tag}.`,
    "Use at least one available tool before final answer.",
    "Return exactly 24 numbered sections with 8 detailed bullets in each section.",
    "Do not summarize.",
  ].join(" ");
}

async function prepareFreshPage(page: Page): Promise<void> {
  const gate = await prepareFreshChatPage(page);
  test.skip(!gate.ok, gate.reason);
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

  await context.route(RUN_STREAM_ROUTE_PATTERN, (route) =>
    route.abort("addressunreachable"),
  );

  await page.waitForTimeout(20_000);

  const lengthWhileBlocked = await readAssistantTextLength(page);

  await context.unroute(RUN_STREAM_ROUTE_PATTERN);

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
