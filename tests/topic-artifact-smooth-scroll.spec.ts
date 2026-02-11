import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXTURE_TOPIC_JSON_URL =
  "https://storage.googleapis.com/question_crafter_public/topic_merged_20260207_230527_b4179f45.json";

const EXACT_PROMPT = `Call generate_preview_link_of_topic exactly once with topic_json_url=\"${FIXTURE_TOPIC_JSON_URL}\". Then call present_topic_preview_artifact exactly once using the same topic_json_url and the preview_link returned by the first tool. After both tool calls succeed, respond with a concise completion message and do not dump raw URLs unless I explicitly ask.`;

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Type your message...");
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await page.getByRole("button", { name: "Send" }).click();
}

async function readClosestScrollableParentTop(locator: Locator): Promise<number | null> {
  return locator.evaluate((node) => {
    let current = node.parentElement;
    while (current) {
      const style = window.getComputedStyle(current);
      const isScrollable =
        /(auto|scroll)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight;
      if (isScrollable) {
        return current.scrollTop;
      }
      current = current.parentElement;
    }
    return null;
  });
}

test("topic artifact pane open/refresh keeps chat scroll stable", async ({ page }) => {
  await page.goto("/");
  await sendPrompt(page, EXACT_PROMPT);

  const card = page.getByTestId("topic-preview-artifact-card");
  await expect(card).toBeVisible({ timeout: 180_000 });
  await expect(card).toHaveCount(1);

  const scrollTopBeforeOpen = await readClosestScrollableParentTop(card);

  await card.click();

  await expect(page.getByTestId("topic-preview-artifact-panel-heading")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("topic-preview-artifact-action-download")).toBeVisible();
  await expect(page.getByTestId("topic-preview-artifact-action-share")).toBeVisible();
  await expect(page.getByTestId("topic-preview-artifact-action-refresh")).toBeVisible();

  const iframe = page.getByTestId("topic-preview-artifact-iframe");
  await expect(iframe).toBeVisible({ timeout: 120_000 });
  const artifactContent = page.getByTestId("artifact-content");
  await expect(artifactContent).toBeVisible();
  const artifactOverflowY = await artifactContent.evaluate((node) =>
    window.getComputedStyle(node).overflowY,
  );
  expect(["hidden", "clip"]).toContain(artifactOverflowY);

  const iframeSrcBefore = await iframe.getAttribute("src");
  await page.getByTestId("topic-preview-artifact-action-refresh").click();

  await expect
    .poll(async () => page.getByTestId("topic-preview-artifact-iframe").getAttribute("src"), {
      timeout: 30_000,
      message: "Expected iframe src token to update after refresh",
    })
    .not.toBe(iframeSrcBefore);

  const scrollTopAfterRefresh = await readClosestScrollableParentTop(card);

  if (scrollTopBeforeOpen !== null && scrollTopAfterRefresh !== null) {
    expect(Math.abs(scrollTopAfterRefresh - scrollTopBeforeOpen)).toBeLessThanOrEqual(24);
  }
});
