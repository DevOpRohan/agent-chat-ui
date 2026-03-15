import { expect, test, type Page } from "@playwright/test";
import { gotoAndDetectChatEnvironment } from "./helpers/environment-gates";

const COMPLEX_NUMBER_PROMPT =
  "Genrate a topic of 6 ct eahc have 3 varaints on the basis latest question trends in jee advanced exam on complex number.";

const REACT_ERROR_PATTERNS = [
  /minified react error #185/i,
  /\/errors\/185/i,
  /maximum update depth exceeded/i,
  /too many re-renders/i,
];

function attachReactErrorMonitor(page: Page) {
  const signals: string[] = [];

  const record = (source: string, text: string) => {
    if (REACT_ERROR_PATTERNS.some((pattern) => pattern.test(text))) {
      signals.push(`[${source}] ${text}`);
    }
  };

  const onConsole = (message: { text(): string; type(): string }) => {
    record(`console:${message.type()}`, message.text());
  };
  const onPageError = (error: Error) => {
    record("pageerror", error.message || String(error));
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  return {
    assertClean() {
      expect(
        signals,
        `Detected React render instability signal(s):\n${signals.join("\n")}`,
      ).toEqual([]);
    },
    dispose() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

async function openFreshThread(page: Page): Promise<void> {
  const newButton = page.getByRole("button", { name: /^New$/ }).first();
  await expect(newButton).toBeVisible({ timeout: 60_000 });
  await newButton.click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 15_000,
      message: "Expected threadId to be cleared for a fresh thread",
    })
    .toBeNull();
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder("Type your message...");
  const sendButton = page.getByRole("button", { name: "Send" });
  await expect(input).toBeVisible({ timeout: 60_000 });
  await input.fill(prompt);
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();
}

async function waitForThreadId(page: Page): Promise<string> {
  await expect
    .poll(() => new URL(page.url()).searchParams.get("threadId"), {
      timeout: 30_000,
      message: "Expected threadId in URL after submit",
    })
    .not.toBeNull();

  return new URL(page.url()).searchParams.get("threadId")!;
}

async function readAssistantTextLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const assistantGroups = Array.from(
      document.querySelectorAll("div.group.mr-auto"),
    );
    const lastAssistant = assistantGroups.at(-1) as HTMLElement | undefined;
    if (!lastAssistant) return 0;
    const segments = Array.from(lastAssistant.querySelectorAll("div.py-1")).map(
      (node) => node.textContent ?? "",
    );
    return segments.join("\n").length;
  });
}

async function waitForRunCompletion(page: Page): Promise<void> {
  const sendButton = page.getByRole("button", { name: "Send" });
  const cancelButton = page.getByRole("button", { name: "Cancel" });
  await expect
    .poll(
      async () => ({
        assistantLength: await readAssistantTextLength(page),
        finalizingVisible: await page
          .getByTestId("stream-finalization-status")
          .isVisible()
          .catch(() => false),
        sendEnabled: await sendButton.isEnabled().catch(() => false),
        cancelVisible: await cancelButton.isVisible().catch(() => false),
      }),
      {
        timeout: 300_000,
        message:
          "Expected the run to complete with final assistant output, no active cancel control, and a restored send button",
      },
    )
    .toEqual({
      assistantLength: expect.any(Number),
      finalizingVisible: false,
      sendEnabled: true,
      cancelVisible: false,
    });
}

test.describe.configure({ mode: "serial" });

test.describe("JEE complex-number soak coverage", () => {
  test("completes the exact prompt three times sequentially without render instability", async ({
    page,
  }) => {
    const gate = await gotoAndDetectChatEnvironment(
      page,
      "/?chatHistoryOpen=true",
    );
    test.skip(!gate.ok, gate.reason);
    const reactErrorMonitor = attachReactErrorMonitor(page);

    try {
      for (let runIndex = 0; runIndex < 3; runIndex += 1) {
        await openFreshThread(page);
        await sendPrompt(page, COMPLEX_NUMBER_PROMPT);
        await waitForThreadId(page);

        const cancelButton = page.getByRole("button", { name: "Cancel" });
        await expect(cancelButton).toBeVisible({ timeout: 120_000 });

        await waitForRunCompletion(page);
        await expect
          .poll(() => readAssistantTextLength(page), {
            timeout: 10_000,
            message: `Expected non-empty assistant output after run ${runIndex + 1}`,
          })
          .toBeGreaterThan(0);

        await expect(
          page.getByText("An error occurred. Please try again."),
        ).toHaveCount(0);
      }

      reactErrorMonitor.assertClean();
    } finally {
      reactErrorMonitor.dispose();
    }
  });

  test("keeps the intermediate artifact open through completion on the exact prompt", async ({
    page,
  }) => {
    const gate = await gotoAndDetectChatEnvironment(
      page,
      "/?chatHistoryOpen=true",
    );
    test.skip(!gate.ok, gate.reason);
    const reactErrorMonitor = attachReactErrorMonitor(page);

    try {
      await openFreshThread(page);
      await sendPrompt(page, COMPLEX_NUMBER_PROMPT);
      await waitForThreadId(page);

      const cancelButton = page.getByRole("button", { name: "Cancel" });
      await expect(cancelButton).toBeVisible({ timeout: 120_000 });

      const intermediateStepButton = page
        .getByRole("button", { name: /Intermediate Step/i })
        .first();
      await expect(intermediateStepButton).toBeVisible({ timeout: 180_000 });
      await intermediateStepButton.click();

      const artifactContent = page.getByTestId("artifact-content");
      await expect(artifactContent).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(
          async () => ({
            artifactVisible: await artifactContent.isVisible().catch(() => false),
            assistantLength: await readAssistantTextLength(page),
            cancelVisible: await cancelButton.isVisible().catch(() => false),
          }),
          {
            timeout: 300_000,
            message:
              "Expected artifact pane to stay mounted until the run completes",
          },
        )
        .toMatchObject({
          artifactVisible: true,
          assistantLength: expect.any(Number),
        });

      await waitForRunCompletion(page);
      await expect
        .poll(() => readAssistantTextLength(page), {
          timeout: 10_000,
          message: "Expected non-empty assistant output after artifact-open run",
        })
        .toBeGreaterThan(0);
      await expect(
        page.getByText("An error occurred. Please try again."),
      ).toHaveCount(0);
      reactErrorMonitor.assertClean();
    } finally {
      reactErrorMonitor.dispose();
    }
  });
});
