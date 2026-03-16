import { expect, test } from "@playwright/test";
import { Client } from "@langchain/langgraph-sdk";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const apiUrl = process.env.PLAYWRIGHT_LANGGRAPH_API_URL;
const assistantId =
  process.env.PLAYWRIGHT_ASSISTANT_ID ?? "o3_question_crafter_agent";

async function seedHydrationThread(targetApiUrl: string): Promise<string> {
  const client = new Client({ apiUrl: targetApiUrl });
  const ts = Date.now();

  const thread = await client.threads.create({
    graphId: assistantId,
    metadata: {
      thread_preview: "Hydration regression thread",
      thread_title: "Hydration regression thread",
    },
  });

  await client.threads.updateState(thread.thread_id, {
    values: {
      messages: [
        {
          id: `human-${ts}`,
          type: "human",
          content: "Hydration regression human message",
        },
        {
          id: `ai-${ts}`,
          type: "ai",
          content:
            "Hydration regression assistant message should render before history completes.",
        },
      ],
    },
  });

  return thread.thread_id;
}

test.describe("Thread hydration", () => {
  test.skip(
    !apiUrl,
    "Set PLAYWRIGHT_LANGGRAPH_API_URL to run thread hydration checks locally.",
  );

  test("selected thread renders from state before history finishes", async ({
    page,
  }) => {
    const threadId = await seedHydrationThread(apiUrl!);
    const historyPattern = `**/threads/${threadId}/history`;

    await page.route(historyPattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      const response = await route.fetch();
      await route.fulfill({ response });
    });

    const targetUrl =
      `/?apiUrl=${encodeURIComponent(apiUrl!)}` +
      `&assistantId=${encodeURIComponent(assistantId)}` +
      `&threadId=${encodeURIComponent(threadId)}` +
      "&chatHistoryOpen=true";

    const gate = await gotoAndDetectChatEnvironment(page, targetUrl);
    test.skip(!gate.ok, gate.reason);

    await expect(
      page.getByText("Hydration regression human message", { exact: true }),
    ).toBeVisible({ timeout: 4_000 });
    await expect(
      page.getByText(
        "Hydration regression assistant message should render before history completes.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 4_000 });
  });
});
