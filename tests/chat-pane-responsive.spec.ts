import { test, expect, type Page } from "@playwright/test";
import { Client } from "@langchain/langgraph-sdk";

const apiUrl = process.env.PLAYWRIGHT_LANGGRAPH_API_URL;
const assistantId =
  process.env.PLAYWRIGHT_ASSISTANT_ID ?? "o3_question_crafter_agent";

function buildLongToken() {
  return `TOKEN_${"A".repeat(900)}`;
}

function buildLongUrl() {
  return `https://example.com/${"very-long-url-segment-".repeat(50)}tail`;
}

async function seedLongContentThread(targetApiUrl: string): Promise<string> {
  const client = new Client({ apiUrl: targetApiUrl });
  const longToken = buildLongToken();
  const longUrl = buildLongUrl();
  const ts = Date.now();
  const toolCallId = `call-${ts}`;

  const thread = await client.threads.create({
    graphId: assistantId,
    metadata: {
      thread_preview: "Chat pane responsiveness test thread",
      thread_title: "Chat Pane Responsive Test",
    },
  });

  const messages = [
    {
      id: `human-${ts}`,
      type: "human",
      content: `Human long token baseline: ${longToken}`,
    },
    {
      id: `ai-${ts}`,
      type: "ai",
      content: [
        {
          type: "text",
          text: `Assistant long URL baseline: ${longUrl}\\n\\nAssistant long token baseline: ${longToken}`,
        },
        {
          type: "tool_call",
          name: "collect_diagnostics",
          id: toolCallId,
          args: {
            url: longUrl,
            token: longToken,
          },
        },
      ],
      tool_calls: [
        {
          name: "collect_diagnostics",
          id: toolCallId,
          type: "tool_call",
          args: {
            url: longUrl,
            token: longToken,
          },
        },
      ],
    },
    {
      id: `tool-${ts}`,
      type: "tool",
      name: "collect_diagnostics",
      tool_call_id: toolCallId,
      content: JSON.stringify({ ok: true, url: longUrl, token: longToken }),
    },
  ];

  await client.threads.updateState(thread.thread_id, {
    values: {
      messages,
    },
  });

  return thread.thread_id;
}

async function assertNoChatHorizontalOverflow(page: Page) {
  await expect(page.getByTestId("chat-scroll-container")).toBeVisible({
    timeout: 60_000,
  });

  const metrics = await page.evaluate(() => {
    const container = document.querySelector(
      '[data-testid="chat-scroll-container"]',
    );
    if (!(container instanceof HTMLElement)) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const visibleTextOverflows = Array.from(
      container.querySelectorAll("p, li, blockquote, td, th, a"),
    )
      .map((node) => {
        const element = node as HTMLElement;
        const styles = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          diff: element.scrollWidth - element.clientWidth,
          rightDiff: rect.right - containerRect.right,
          leftDiff: containerRect.left - rect.left,
          overflowX: styles.overflowX,
          className: (element.className || "").toString(),
        };
      })
      .filter(
        (entry) =>
          (entry.diff > 1 && entry.overflowX !== "hidden") ||
          entry.rightDiff > 1 ||
          entry.leftDiff > 1,
      )
      .sort((a, b) => b.diff - a.diff);

    return {
      containerDiff: container.scrollWidth - container.clientWidth,
      containerOverflowX: window.getComputedStyle(container).overflowX,
      docDiff:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      visibleTextOverflows,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics?.docDiff ?? 0).toBeLessThanOrEqual(1);
  expect(metrics?.containerDiff ?? 0).toBeLessThanOrEqual(1);
  expect(metrics?.containerOverflowX).toBe("hidden");
  expect(metrics?.visibleTextOverflows ?? []).toHaveLength(0);
}

async function assertWrappedTextRow(page: Page, textSnippet: string) {
  const row = page.locator("p", { hasText: textSnippet }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });

  const overflow = await row.evaluate((element) => {
    const container = document.querySelector(
      '[data-testid="chat-scroll-container"]',
    );
    if (!(container instanceof HTMLElement)) {
      return null;
    }
    const rowRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      widthDiff: element.scrollWidth - element.clientWidth,
      rightDiff: rowRect.right - containerRect.right,
      leftDiff: containerRect.left - rowRect.left,
    };
  });

  expect(overflow).not.toBeNull();
  expect(overflow?.widthDiff ?? 0).toBeLessThanOrEqual(1);
  expect(overflow?.rightDiff ?? 0).toBeLessThanOrEqual(1);
  expect(overflow?.leftDiff ?? 0).toBeLessThanOrEqual(1);
}

test.describe("Chat pane responsiveness", () => {
  test.skip(
    !apiUrl,
    "Set PLAYWRIGHT_LANGGRAPH_API_URL to run responsiveness checks locally.",
  );

  test("chat pane stays responsive for long token/url and artifact pane", async ({
    page,
  }) => {
    const threadId = await seedLongContentThread(apiUrl!);
    const targetUrl =
      `/?apiUrl=${encodeURIComponent(apiUrl!)}` +
      `&assistantId=${encodeURIComponent(assistantId)}` +
      `&threadId=${encodeURIComponent(threadId)}` +
      "&chatHistoryOpen=false";

    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("Type your message...")).toBeVisible({
      timeout: 60_000,
    });

    await assertNoChatHorizontalOverflow(page);
    await assertWrappedTextRow(page, "Human long token baseline:");
    await assertWrappedTextRow(page, "Assistant long URL baseline:");

    const intermediateStepTrigger = page
      .getByRole("button", { name: /Intermediate Step/i })
      .first();
    await expect(intermediateStepTrigger).toBeVisible({ timeout: 60_000 });
    await intermediateStepTrigger.click();

    await assertNoChatHorizontalOverflow(page);

    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder("Type your message...")).toBeVisible({
      timeout: 60_000,
    });

    await assertNoChatHorizontalOverflow(page);
    await assertWrappedTextRow(page, "Human long token baseline:");
    await assertWrappedTextRow(page, "Assistant long URL baseline:");
  });
});
