import { expect, test, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const STREAM_ROUTE_PATTERN =
  /\/threads\/[^/]+\/runs(?:\/[^/]+)?\/stream(?:\?|$)/;

const TOOL_HEAVY_PROMPT = [
  "Use at least one available tool before your final answer.",
  "Research JEE Advanced complex-number question patterns and produce a long, structured answer.",
  "Return 18 numbered sections with detailed bullets and examples.",
].join(" ");

async function waitForThreadId(
  page: Page,
  timeoutMs = 30_000,
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const threadId = new URL(page.url()).searchParams.get("threadId");
    if (threadId) return threadId;
    await page.waitForTimeout(250);
  }
  throw new Error("Expected threadId in URL after submit");
}

async function readAssistantTextLength(page: Page): Promise<number> {
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

async function installReact185StreamFailure(page: Page): Promise<void> {
  await page.addInitScript((patternSource: string) => {
    const streamPattern = new RegExp(patternSource);
    const originalFetch = window.fetch.bind(window);
    let injected = false;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const response = await originalFetch(input, init);
      if (injected || !streamPattern.test(requestUrl) || !response.body) {
        return response;
      }

      injected = true;
      const reader = response.body.getReader();
      let forwardedChunks = 0;

      const failingBody = new ReadableStream<Uint8Array>({
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
              await reader.cancel("intentional react185 fallback test");
            } catch {
              // no-op
            }
            controller.error(
              new Error(
                "Minified React error #185; visit https://react.dev/errors/185 for the full message.",
              ),
            );
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

      return new Response(failingBody, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers(response.headers),
      });
    };
  }, STREAM_ROUTE_PATTERN.source);
}

test("finalizes the response via polling when streaming becomes react-185-style unhealthy", async ({
  page,
}) => {
  await installReact185StreamFailure(page);
  const gate = await gotoAndDetectChatEnvironment(page, "/?chatHistoryOpen=true");
  test.skip(!gate.ok, gate.reason);

  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });
  const cancelButton = page.getByRole("button", { name: "Cancel" });

  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(TOOL_HEAVY_PROMPT);
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();

  const threadId = await waitForThreadId(page);
  await expect(cancelButton).toBeVisible({ timeout: 90_000 });

  await expect
    .poll(() => readAssistantTextLength(page), {
      timeout: 120_000,
      message: "Expected assistant output to begin before fallback triggers",
    })
    .toBeGreaterThan(20);

  await expect
    .poll(() => readAssistantTextLength(page), {
      timeout: 240_000,
      message:
        "Expected assistant output to be finalized after the fallback polling flow",
    })
    .toBeGreaterThan(40);

  await expect(input).toBeEnabled({ timeout: 240_000 });
  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 15_000,
      message: "Expected the same thread to stay open without refresh",
    })
    .toBe(threadId);
  await input.fill("follow-up readiness check");
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await input.fill("");
  await expect(cancelButton).toHaveCount(0);
  await expect(
    page.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);
});
