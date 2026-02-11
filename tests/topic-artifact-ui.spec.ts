import { expect, test, type Page } from "@playwright/test";

const FIXTURE_TOPIC_JSON_URL =
  "https://storage.googleapis.com/question_crafter_public/topic_merged_20260207_230527_b4179f45.json";

const EXACT_PROMPT = `Call generate_preview_link_of_topic exactly once with topic_json_url=\"${FIXTURE_TOPIC_JSON_URL}\". Then call present_topic_preview_artifact exactly once using the same topic_json_url and the preview_link returned by the first tool. After both tool calls succeed, respond with a concise completion message and do not dump raw URLs unless I explicitly ask.`;

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test("topic preview artifact renders card, opens pane, and supports actions", async ({
  page,
}) => {
  await page.goto("/");
  await sendPrompt(page, EXACT_PROMPT);

  const card = page.getByTestId("topic-preview-artifact-card");
  await expect(card).toBeVisible({ timeout: 180_000 });
  await expect(card).toHaveCount(1);

  const renderedInAssistantColumn = await card.first().evaluate((node) =>
    Boolean(node.closest("div.group.mr-auto")),
  );
  expect(renderedInAssistantColumn).toBeTruthy();

  await card.first().click();

  const panelHeading = page.getByTestId("topic-preview-artifact-panel-heading");
  await expect(panelHeading).toHaveText("Topic Preview", { timeout: 30_000 });
  await expect(panelHeading).toHaveCount(1);

  const iframe = page.getByTestId("topic-preview-artifact-iframe");
  await expect(iframe).toBeVisible({ timeout: 120_000 });

  const heightRatio = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('[data-testid="pane-artifact"]');
    const iframeNode = document.querySelector<HTMLElement>(
      '[data-testid="topic-preview-artifact-iframe"]',
    );
    if (!pane || !iframeNode) return null;
    const paneRect = pane.getBoundingClientRect();
    const iframeRect = iframeNode.getBoundingClientRect();
    if (paneRect.height <= 0) return null;
    return iframeRect.height / paneRect.height;
  });
  expect(heightRatio).not.toBeNull();
  expect(heightRatio ?? 0).toBeGreaterThan(0.8);

  const refreshButton = page.getByTestId("topic-preview-artifact-action-refresh");
  const srcBeforeRefresh = await iframe.getAttribute("src");
  await refreshButton.click();
  await expect
    .poll(async () => page.getByTestId("topic-preview-artifact-iframe").getAttribute("src"), {
      timeout: 30_000,
      message: "Expected topic preview iframe src to change after refresh",
    })
    .not.toBe(srcBeforeRefresh);

  const shareButton = page.getByTestId("topic-preview-artifact-action-share");
  await shareButton.click();
  await expect(page.getByText("Preview link copied to clipboard")).toBeVisible({
    timeout: 10_000,
  });

  const downloadButton = page.getByTestId("topic-preview-artifact-action-download");
  const popupPromise = page.waitForEvent("popup", { timeout: 30_000 });
  await downloadButton.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/topic_merged_20260207_230527_b4179f45\.json/);
  await popup.close();

  const assistantMessages = page.locator("div.group.mr-auto");
  await expect(assistantMessages.last()).not.toContainText(FIXTURE_TOPIC_JSON_URL);
});
