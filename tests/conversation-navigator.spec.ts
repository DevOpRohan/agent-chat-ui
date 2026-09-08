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

test("narrow screens use a searchable outline with large targets and restore focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const { errors } = await openConversation(page, conversation(60));
  await expect(navigator(page)).toHaveCount(0);
  const trigger = page.getByRole("button", {
    name: "Conversation outline",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Conversation",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const currentRow = dialog.locator('button[aria-current="location"]');
  await expect(currentRow).toBeInViewport();
  await expect(currentRow).toBeFocused();
  const search = dialog.getByRole("searchbox", { name: "Find a message" });
  await search.fill("topic 2");
  const second = dialog.getByRole("button", {
    name: "Turn 2: Explain topic 2",
    exact: true,
  });
  expect((await second.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await second.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expectTurnNearTop(page, 2);
  await trigger.click();
  await expect(
    dialog.getByRole("button", {
      name: "Turn 2: Explain topic 2",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "location");
  await search.fill("no such message");
  await expect(dialog.getByRole("status")).toContainText(
    "No matching messages",
  );
  await search.fill("");
  await page.screenshot({
    path: "test-results/conversation-navigator-mobile.png",
  });
  await search.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("desktop ticks rest quietly, taper around hover and keyboard focus, and dismiss without losing focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { errors } = await openConversation(page);
  const nav = navigator(page);
  const ticks = nav.getByTestId("conversation-tick");
  await page.mouse.move(900, 50);
  await expect
    .poll(() =>
      ticks.evaluateAll((nodes) =>
        nodes.every((node) => node.getBoundingClientRect().width === 12),
      ),
    )
    .toBeTruthy();
  const grip = page.getByTestId("resize-handle-history-chat").locator("span");
  await expect(grip).toHaveCSS("opacity", "0");
  await page.screenshot({
    path: "test-results/conversation-navigator-rest.png",
  });
  const fourth = nav.getByRole("button").nth(3);
  await fourth.hover();
  await expect
    .poll(() =>
      ticks.evaluateAll((nodes) =>
        nodes.map((node) => node.getBoundingClientRect().width),
      ),
    )
    .toEqual([16, 24, 36, 52, 36, 24, 16, 12]);
  await expect(page.getByRole("tooltip")).toContainText("Explain topic 4");
  await page.screenshot({
    path: "test-results/conversation-navigator-hover.png",
  });
  await fourth.click();
  await expectTurnNearTop(page, 6);
  await page.mouse.move(900, 50);
  await expect
    .poll(() =>
      ticks.evaluateAll((nodes) =>
        nodes.every((node) => node.getBoundingClientRect().width === 12),
      ),
    )
    .toBeTruthy();
  await fourth.press("ArrowDown");
  const fifth = nav.getByRole("button").nth(4);
  await expect(fifth).toBeFocused();
  await expect(ticks.nth(4)).toHaveCSS("width", "52px");
  await fifth.press("Escape");
  await expect(fifth).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(ticks.nth(4)).toHaveCSS("width", "12px");
  await fifth.press("End");
  await nav.getByRole("button").last().press("Enter");
  await expectTurnNearTop(page, 14);
  await nav.getByRole("button").last().press("Home");
  await expect(nav.getByRole("button").first()).toBeFocused();
  await page.getByTestId("resize-handle-history-chat").hover();
  await expect(grip).toHaveCSS("opacity", "1");
  expect(errors).toEqual([]);
});

test("short conversations that fit need no navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  const { errors } = await openConversation(
    page,
    conversation(3).filter((message) => message.type === "human"),
  );
  await expect(navigator(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Conversation outline", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("500 turns stay searchable without making the rail or page grow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const messages = conversation(500).map((message) =>
    message.type === "ai"
      ? { ...message, content: `Answer for ${message.id}` }
      : message,
  );
  const { errors } = await openConversation(page, messages);
  const nav = navigator(page);
  await expect(nav.getByRole("button")).toHaveCount(500);
  expect(await nav.evaluate((node) => node.clientHeight)).toBeLessThan(385);
  await page
    .getByRole("button", { name: "Conversation outline", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Conversation",
    exact: true,
  });
  await dialog.getByRole("searchbox").fill("topic 425");
  await expect(dialog.getByRole("button", { name: /^Turn / })).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Turn 425: Explain topic 425", exact: true })
    .click();
  await expectTurnNearTop(page, 848);
  await expect(nav.getByRole("button").nth(424)).toBeInViewport();
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
  fixture.messages = [
    ...conversation(8),
    { id: "pending", type: "human", content: "Pending message" },
  ];
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
  await nav.getByRole("button").last().hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Waiting for a response",
  );
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
  const artifactHandle = page.getByTestId("resize-handle-chat-artifact");
  await artifactHandle.focus();
  for (let step = 0; step < 12; step++) await artifactHandle.press("ArrowLeft");
  await expect(nav).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Conversation outline", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe("touch input", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 900 },
  });

  test("wide touch screens use an outline without hover-dependent controls", async ({
    page,
  }) => {
    const { errors } = await openConversation(page);
    await expect(navigator(page)).toHaveCount(0);
    const trigger = page.getByRole("button", {
      name: "Conversation outline",
      exact: true,
    });
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    const dialog = page.getByRole("dialog", {
      name: "Conversation",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Turn 1: Explain topic 1", exact: true })
      .tap();
    await expect(dialog).toBeHidden();
    await expectTurnNearTop(page, 0);
    expect(errors).toEqual([]);
  });
});
