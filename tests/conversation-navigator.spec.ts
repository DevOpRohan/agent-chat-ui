import { expect, test, type Page } from "@playwright/test";
import type { Message } from "@langchain/langgraph-sdk";

test.setTimeout(60_000);

function conversation(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => [
    {
      id: `human-${index}`,
      type: "human" as const,
      content: `Explain topic ${index + 1}`,
    },
    {
      id: `ai-${index}`,
      type: "ai" as const,
      content: Array.from(
        { length: 4 },
        (_, paragraph) =>
          `Topic ${index + 1}, explanation ${paragraph + 1}. ` +
          "Work through the example carefully and compare the result with the original question. ".repeat(
            5,
          ),
      ).join("\n\n"),
    },
  ]).flat();
}

async function openConversation(page: Page, messages = conversation(8)) {
  const fixture = { messages, busy: false, stateReads: 0 };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/navigator-api/**", async (route) => {
    const url = new URL(route.request().url());
    const short = url.pathname.includes("/short-thread");
    const thread = {
      thread_id: short ? "short-thread" : "long-thread",
      created_at: "2026-09-07T00:00:00Z",
      updated_at: "2026-09-07T00:00:00Z",
      metadata: {
        thread_title: short ? "Short conversation" : "Navigator examples",
      },
      status: fixture.busy ? "busy" : "idle",
      values: { messages: short ? conversation(2) : fixture.messages },
    };
    let json: unknown = {};
    if (url.pathname.endsWith("/state")) {
      fixture.stateReads += 1;
      json = { values: thread.values, next: [], tasks: [], checkpoint: null };
    } else if (url.pathname.endsWith("/history")) json = [];
    else if (url.pathname.endsWith("/runs")) json = [];
    else if (url.pathname.endsWith("/search"))
      json = [
        thread,
        {
          ...thread,
          thread_id: "short-thread",
          metadata: { thread_title: "Short conversation" },
        },
      ];
    else if (url.pathname.includes("/threads/")) json = thread;
    await route.fulfill({ json });
  });
  await page.goto("/");
  const apiUrl = `${new URL(page.url()).origin}/navigator-api`;
  await page.goto(
    `/?${new URLSearchParams({
      apiUrl,
      assistantId: "navigator-fixture",
      threadId: "long-thread",
      chatHistoryOpen: String((page.viewportSize()?.width ?? 1280) >= 1024),
    })}`,
  );
  await expect(page.getByPlaceholder("Type your message...")).toBeVisible();
  await expect(page.locator("[data-conversation-turn]")).toHaveCount(
    messages.filter(
      (message) =>
        message.type === "human" && !message.id?.startsWith("do-not-render-"),
    ).length,
  );
  return { fixture, errors };
}

function navigator(page: Page) {
  return page.getByRole("navigation", { name: "Conversation navigator" });
}

async function expectTurnNearTop(page: Page, messageIndex: number) {
  await expect
    .poll(async () =>
      page
        .locator(`[data-conversation-turn="${messageIndex}"]`)
        .evaluate((anchor) => {
          const scroll = document.querySelector(
            '[data-testid="chat-scroll-container"]',
          )!;
          return Math.abs(
            anchor.getBoundingClientRect().top -
              scroll.getBoundingClientRect().top -
              32,
          );
        }),
    )
    .toBeLessThan(5);
}

test("previews visible turns and jumps without changing the draft or bottom control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const messages = conversation(8);
  messages.splice(
    1,
    0,
    { id: "do-not-render-private", type: "human", content: "Hidden prompt" },
    { id: "do-not-render-answer", type: "ai", content: "Hidden answer" },
    {
      id: "reasoning",
      type: "ai",
      content: [
        { type: "reasoning", reasoning: "Internal reasoning" },
      ] as unknown as Message["content"],
    },
  );
  messages.push({
    id: "attachment",
    type: "human",
    content: [
      {
        type: "file",
        source_type: "id",
        id: "file-example",
        mime_type: "application/pdf",
      },
    ] as unknown as Message["content"],
  });
  const { errors } = await openConversation(page, messages);
  const nav = navigator(page);
  await expect(nav.getByRole("button")).toHaveCount(9);
  await expect(nav.getByRole("button", { name: /Hidden/ })).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "Turn 9: Attachment message" }),
  ).toHaveCount(1);
  const first = nav.getByRole("button", {
    name: "Turn 1: Explain topic 1",
    exact: true,
  });
  await first.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Topic 1, explanation 1.",
  );
  await expect(page.getByRole("tooltip")).not.toContainText("Hidden answer");
  await expect(page.getByRole("tooltip")).not.toContainText(
    "Internal reasoning",
  );
  await page.getByPlaceholder("Type your message...").fill("Keep my draft");
  await first.click();
  await expectTurnNearTop(page, 0);
  await expect(first).toHaveAttribute("aria-current", "location");
  await expect(page.getByPlaceholder("Type your message...")).toHaveValue(
    "Keep my draft",
  );
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect(
    page.getByRole("button", { name: "Scroll to bottom" }),
  ).toBeHidden();
  expect(errors).toEqual([]);
  await first.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({
    path: "test-results/conversation-navigator-desktop.png",
  });
});

test("keyboard navigation reaches a bounded long rail on mobile with reduced motion and dark theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const { errors } = await openConversation(page, conversation(60));
  const nav = navigator(page);
  const first = nav.getByRole("button").first();
  await first.focus();
  await first.press("ArrowDown");
  const second = nav.getByRole("button").nth(1);
  await expect(second).toBeFocused();
  await second.press("Enter");
  await expectTurnNearTop(page, 2);
  await expect(second).toHaveAttribute("aria-current", "location");
  await second.press("End");
  const last = nav.getByRole("button").last();
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await last.press("Enter");
  await expectTurnNearTop(page, 118);
  await expect(last).toHaveAttribute("aria-current", "location");
  await last.press("Home");
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
  await first.press("Enter");
  await expectTurnNearTop(page, 0);
  await first.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  expect(await nav.evaluate((element) => element.clientHeight)).toBeLessThan(
    340,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await first.press("ArrowDown");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({
    path: "test-results/conversation-navigator-mobile.png",
  });
  expect(errors).toEqual([]);
});

test("poll updates preserve reading position and switching to a short thread removes the rail", async ({
  page,
}) => {
  const { fixture, errors } = await openConversation(page);
  const nav = navigator(page);
  const third = nav.getByRole("button").nth(2);
  await third.click();
  await expectTurnNearTop(page, 4);
  fixture.busy = true;
  fixture.messages = conversation(9);
  const before = fixture.stateReads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => fixture.stateReads).toBeGreaterThan(before);
  await expect(nav.getByRole("button")).toHaveCount(9);
  await expect(page.getByTestId("thread-working-status")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  await expectTurnNearTop(page, 4);
  await expect(third).toHaveAttribute("aria-current", "location");
  await page.getByText("Short conversation", { exact: true }).first().click();
  await expect(page).toHaveURL(/threadId=short-thread/);
  await expect(nav).toBeHidden();
  await expect(page.locator("[data-conversation-turn]")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("manual scrolling and pane resizing keep the navigator scoped to the chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { errors } = await openConversation(page);
  const nav = navigator(page);
  await nav.getByRole("button").first().click();
  await expectTurnNearTop(page, 0);
  const scroll = page.getByTestId("chat-scroll-container");
  await scroll.evaluate((element) => {
    const anchor = element.querySelector('[data-conversation-turn="6"]')!;
    element.scrollTop +=
      anchor.getBoundingClientRect().top -
      element.getBoundingClientRect().top -
      32;
  });
  await expect(nav.getByRole("button").nth(3)).toHaveAttribute(
    "aria-current",
    "location",
  );
  await page
    .getByTestId("open-artifact-panel-test-control")
    .dispatchEvent("click");
  await expect(page.getByTestId("artifact-expand-toggle")).toBeVisible();
  const handle = page.getByTestId("resize-handle-history-chat");
  await handle.focus();
  await handle.press("ArrowLeft");
  await nav.getByRole("button").nth(1).click();
  await expectTurnNearTop(page, 2);
  const railBox = (await nav.boundingBox())!;
  const chatBox = (await page.getByTestId("pane-chat").boundingBox())!;
  expect(railBox.x).toBeGreaterThanOrEqual(chatBox.x);
  expect(railBox.x + railBox.width).toBeLessThan(chatBox.x + chatBox.width);
  await page.getByTestId("artifact-expand-toggle").click();
  await expect(nav).toHaveCount(0);
  await page.getByTestId("artifact-expand-toggle").click();
  await expect(nav).toBeVisible();
  expect(errors).toEqual([]);
});
