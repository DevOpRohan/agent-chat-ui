import { expect, test, type Page } from "@playwright/test";
import {
  prepareFreshChatPage,
  readAssistantTextLength,
  readThreadId,
  RUN_STREAM_ROUTE_PATTERN,
  waitForThreadId,
} from "./helpers/chat-thread";

function longPrompt(tag: string): string {
  return [
    `Silent close recovery validation ${tag}.`,
    "Use at least one available tool before the final answer.",
    "Produce a very long response with 40 numbered sections.",
    "Each section must include 8 detailed bullet points and examples.",
    "Do not summarize or shorten.",
  ].join(" ");
}

async function installSilentStreamClose(page: Page): Promise<void> {
  await page.addInitScript((patternSource: string) => {
    const streamPattern = new RegExp(patternSource);
    const originalFetch = window.fetch.bind(window);
    let truncated = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const response = await originalFetch(input, init);
      if (truncated || !streamPattern.test(requestUrl) || !response.body) {
        return response;
      }

      truncated = true;
      const reader = response.body.getReader();
      let forwardedChunks = 0;

      const truncatedBody = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const result = await reader.read();
          if (result.done) {
            controller.close();
            return;
          }

          controller.enqueue(result.value);
          forwardedChunks += 1;
          if (forwardedChunks >= 12) {
            try {
              await reader.cancel("intentional test truncation");
            } catch {
              // no-op
            }
            controller.close();
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } catch {
            // no-op
          }
        },
      });

      return new Response(truncatedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    };
  }, RUN_STREAM_ROUTE_PATTERN.source);
}

async function prepareFreshPage(page: Page): Promise<void> {
  const gate = await prepareFreshChatPage(page);
  test.skip(!gate.ok, gate.reason);
}

test("recovers when the initial stream closes cleanly without surfacing a fetch error", async ({
  page,
}) => {
  await installSilentStreamClose(page);
  await prepareFreshPage(page);

  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });

  const tag = `${Date.now()}-silent-close`;
  await input.fill(longPrompt(tag));
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();

  const threadId = await waitForThreadId(page);
  await expect
    .poll(async () => readAssistantTextLength(page), {
      timeout: 90_000,
      message: "Expected assistant output to begin before silent close fires",
    })
    .toBeGreaterThan(40);

  const beforeRecoveryLength = await readAssistantTextLength(page);

  await expect
    .poll(() => readThreadId(page), {
      timeout: 30_000,
      message: "Thread ID changed unexpectedly during silent-close recovery",
    })
    .toBe(threadId);

  await expect
    .poll(async () => readAssistantTextLength(page), {
      timeout: 150_000,
      message:
        "Assistant output did not resume after the stream closed cleanly without refresh",
    })
    .toBeGreaterThan(beforeRecoveryLength + 40);

  await expect(
    page.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);
});
