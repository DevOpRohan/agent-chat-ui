import { expect, test, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const FIXTURE_MARKDOWN_URL =
  "https://raw.githubusercontent.com/langchain-ai/agent-chat-ui/main/README.md";

const EXACT_PROMPT = `Call present_markdown_artifact exactly once with name="Agent Chat UI README" and url="${FIXTURE_MARKDOWN_URL}". Do not call read_markdown_artifact. After the tool call succeeds, respond with a concise completion message and do not dump raw URLs unless I explicitly ask.`;

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

test("markdown artifact renders card, opens pane, and shows rendered markdown", async ({
  page,
}) => {
  const gate = await gotoAndDetectChatEnvironment(page, "/");
  test.skip(!gate.ok, gate.reason);
  await sendPrompt(page, EXACT_PROMPT);

  const card = page.getByTestId("markdown-artifact-card");
  await expect(card).toBeVisible({ timeout: 180_000 });
  await expect(card).toHaveCount(1);

  const renderedInAssistantColumn = await card
    .first()
    .evaluate((node) => Boolean(node.closest("div.group.mr-auto")));
  expect(renderedInAssistantColumn).toBeTruthy();

  await card.first().click();

  const panelHeading = page.getByTestId("markdown-artifact-panel-heading");
  await expect(panelHeading).toHaveText("Agent Chat UI README", {
    timeout: 30_000,
  });

  const rendered = page.getByTestId("markdown-artifact-rendered");
  await expect(rendered).toBeVisible({ timeout: 120_000 });
  await expect(rendered).toContainText("Agent Chat UI");

  await page.getByTestId("markdown-artifact-action-share").click();
  await expect(
    page.getByText("Markdown artifact link copied to clipboard"),
  ).toBeVisible({
    timeout: 10_000,
  });

  const popupPromise = page.waitForEvent("popup", { timeout: 30_000 });
  await page.getByTestId("markdown-artifact-action-open-raw").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/raw\.githubusercontent\.com/);
  await popup.close();

  await page.getByTestId("markdown-artifact-action-refresh").click();
  await expect(rendered).toContainText("Agent Chat UI", { timeout: 120_000 });

  const assistantMessages = page.locator("div.group.mr-auto");
  await expect(assistantMessages.last()).not.toContainText(FIXTURE_MARKDOWN_URL);
});
