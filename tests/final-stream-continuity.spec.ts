import { expect, test, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const DEFAULT_PROMPT =
  "Use at least one available tool before your final answer. Then provide a long response with 12 numbered sections and detailed bullet points.";

async function sendMessage(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function getLastAssistantBodyTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const assistantGroups = Array.from(
      document.querySelectorAll("div.group.mr-auto"),
    );
    const lastAssistant = assistantGroups.at(-1) as HTMLElement | undefined;
    if (!lastAssistant) return 0;

    const textSegments = Array.from(lastAssistant.querySelectorAll("div.py-1"))
      .map((node) => node.textContent ?? "")
      .join("\n");

    return textSegments.length;
  });
}

test("final assistant stream stays monotonic after intermediate step completes", async ({
  page,
}) => {
  const prompt =
    process.env.PLAYWRIGHT_STREAM_CONTINUITY_PROMPT ?? DEFAULT_PROMPT;
  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);

  await sendMessage(page, prompt);

  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect(cancelButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Intermediate Step")).toBeVisible({
    timeout: 120_000,
  });

  await expect
    .poll(async () => getLastAssistantBodyTextLength(page), {
      timeout: 120_000,
      message: "Expected final assistant text to start streaming",
    })
    .toBeGreaterThan(20);

  // Even after intermediate status settles, composer loading stays authoritative.
  await expect(cancelButton).toBeVisible();

  let maxLength = await getLastAssistantBodyTextLength(page);
  const observedLengths: number[] = [maxLength];
  let sawRunComplete = false;
  let postRunSamples = 0;

  for (let idx = 0; idx < 210; idx += 1) {
    const currentLength = await getLastAssistantBodyTextLength(page);
    observedLengths.push(currentLength);

    expect(
      currentLength,
      `Assistant text regressed at sample ${idx}. Lengths: ${observedLengths.join(",")}`,
    ).toBeGreaterThanOrEqual(maxLength);

    if (currentLength > maxLength) {
      maxLength = currentLength;
    }

    const isCancelVisible = await cancelButton.isVisible().catch(() => false);
    if (!isCancelVisible) {
      sawRunComplete = true;
      postRunSamples += 1;
      if (postRunSamples >= 5) break;
    }

    await page.waitForTimeout(1_000);
  }

  expect(sawRunComplete).toBeTruthy();
  await expect(cancelButton).not.toBeVisible({ timeout: 1_000 });
});
