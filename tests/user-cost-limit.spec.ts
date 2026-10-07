import { test, expect, type Page } from "@playwright/test";
import { Client } from "@langchain/langgraph-sdk";
import {
  getUserLimitMessage,
  stopUserLimitRetries,
} from "../src/lib/user-limit-error";

const limitMessage =
  "You’ve reached your daily limit. It resets at midnight IST. To get more credits, please contact your reporting manager.";
const unavailableMessage =
  "We couldn’t check your daily usage. Please try again in a moment.";

test("SDK does not retry a budget rejection", async () => {
  let calls = 0;
  const client = new Client({
    apiUrl: "https://fixture.invalid",
    callerOptions: {
      onFailedResponseHook: stopUserLimitRetries,
      fetch: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ detail: "DAILY_COST_LIMIT_EXCEEDED" }),
          {
            status: 429,
            headers: { "X-User-Limit-Code": "DAILY_COST_LIMIT_EXCEEDED" },
          },
        );
      },
    },
  });
  await expect(
    client.runs.create("thread", "agent", { input: {} }),
  ).rejects.toThrow(limitMessage);
  expect(calls).toBe(1);
  expect(
    getUserLimitMessage(new Error("HTTP 429: rate limited")),
  ).toBeUndefined();
});

async function openChat(page: Page, actions = 0) {
  const fixture = {
    submits: 0,
    busy: false,
    reads: 0,
    cancelCalls: 0,
    rejection: "DAILY_COST_LIMIT_EXCEEDED",
    budgetReads: 0,
    budgetStatus: 200,
    budgetDelayMs: 0,
    budget: {
      timezone: "Asia/Kolkata",
      currency: "USD",
      spent_microusd: 0,
      base_limit_microusd: 5_000_000,
      extra_credit_microusd: 0,
      limit_microusd: 5_000_000,
      remaining_microusd: 5_000_000,
      resets_at: new Date(Date.now() + 3600_000).toISOString(),
    },
  };
  const messages = [
    { id: "human-1", type: "human", content: "Original prompt" },
    { id: "ai-1", type: "ai", content: "Original answer" },
  ];
  const interrupts = actions
    ? [
        {
          id: "approval-1",
          value: {
            action_requests: Array.from({ length: actions }, (_, i) => ({
              name: `review_${i}`,
              args: { text: "Review draft" },
            })),
            review_configs: Array.from({ length: actions }, (_, i) => ({
              action_name: `review_${i}`,
              allowed_decisions: ["approve", "edit"],
            })),
          },
        },
      ]
    : [];
  const values = { messages, __interrupt__: interrupts };
  await page.route("**/cost-api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let json: unknown = {};
    if (url.pathname.endsWith("/user/limits")) {
      fixture.budgetReads += 1;
      if (fixture.budgetDelayMs)
        await new Promise((resolve) =>
          setTimeout(resolve, fixture.budgetDelayMs),
        );
      return route.fulfill({
        status: fixture.budgetStatus,
        json: fixture.budget,
      });
    }
    if (url.pathname.endsWith("/runs") && req.method() === "POST") {
      fixture.submits += 1;
      if (fixture.rejection === "DAILY_COST_LIMIT_EXCEEDED") {
        fixture.budget.spent_microusd = fixture.budget.limit_microusd;
        fixture.budget.remaining_microusd = 0;
      }
      return route.fulfill({
        status: fixture.rejection === "USAGE_UNAVAILABLE" ? 503 : 429,
        headers: { "X-User-Limit-Code": fixture.rejection },
        json: { detail: fixture.rejection },
      });
    }
    if (url.pathname.endsWith("/cancel")) fixture.cancelCalls += 1;
    const thread = {
      thread_id: "thread",
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-07T00:00:00Z",
      metadata: { thread_title: "Budget fixture" },
      status: fixture.busy ? "busy" : actions ? "interrupted" : "idle",
      values,
    };
    if (url.pathname.endsWith("/state")) {
      fixture.reads += 1;
      json = { values, next: [], tasks: [], checkpoint: null };
    } else if (url.pathname.endsWith("/history")) json = [];
    else if (url.pathname.endsWith("/runs"))
      json = fixture.busy ? [{ run_id: "running", status: "running" }] : [];
    else if (url.pathname.endsWith("/search")) json = [thread];
    else if (url.pathname.includes("/threads/")) json = thread;
    await route.fulfill({ json });
  });
  await page.goto("/");
  const apiUrl = `${new URL(page.url()).origin}/cost-api`;
  await page.goto(
    `/?${new URLSearchParams({ apiUrl, assistantId: "fixture", threadId: "thread" })}`,
  );
  await expect(page.getByPlaceholder("Type your message...")).toBeVisible();
  await expect(
    page.getByText("Original prompt", { exact: true }),
  ).toBeVisible();
  return fixture;
}

test("rejected message preserves its draft and shows one clear message", async ({
  page,
}) => {
  const fixture = await openChat(page);
  const input = page.getByPlaceholder("Type your message...");
  await input.fill("Keep this rejected draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(limitMessage, { exact: true })).toHaveCount(1);
  await expect(input).toHaveValue("Keep this rejected draft");
  await expect(
    page.getByText("An error occurred. Please try again."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  expect(fixture.submits).toBe(1);
  expect(fixture.cancelCalls).toBe(0);
});

for (const mobile of [false, true]) {
  test(`quota notice stays readable for five seconds (${mobile ? "mobile" : "desktop"})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    const fixture = await openChat(page);
    const input = page.getByPlaceholder("Type your message...");
    await input.fill("Keep this draft while the notice is visible");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const notice = page.locator("[data-sonner-toast]");
    await expect(notice).toHaveCount(1);
    await expect(
      notice.getByText("Daily limit reached", { exact: true }),
    ).toBeVisible();
    await expect(notice.getByText(limitMessage, { exact: true })).toBeVisible();
    // Let Sonner finish its entrance transition before reviewing the screenshot.
    await page.waitForTimeout(400);
    await page.screenshot({ path: testInfo.outputPath("quota-notice.png") });
    const box = await notice.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.waitForTimeout(3500);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(0, { timeout: 3500 });
    await expect(input).toHaveValue(
      "Keep this draft while the notice is visible",
    );
    expect(fixture.submits).toBe(1);
  });
}

test("temporary usage failure has a distinct dismissible notice and preserves the draft", async ({
  page,
}, testInfo) => {
  const fixture = await openChat(page);
  fixture.rejection = "USAGE_UNAVAILABLE";
  const input = page.getByPlaceholder("Type your message...");
  await input.fill("Retry this draft later");
  const reads = fixture.reads;
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const notice = page.locator("[data-sonner-toast]");
  await expect(notice).toHaveCount(1);
  await expect(
    notice.getByText("Usage check temporarily unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    notice.getByText(unavailableMessage, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(limitMessage, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Request not sent", { exact: true })).toHaveCount(
    0,
  );
  await expect.poll(() => fixture.reads).toBeGreaterThan(reads);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: testInfo.outputPath("usage-unavailable-notice.png"),
  });
  await notice.getByRole("button", { name: "Close toast" }).click();
  await expect(notice).toHaveCount(0);
  await expect(input).toHaveValue("Retry this draft later");
  expect(fixture.submits).toBe(1);
  expect(fixture.cancelCalls).toBe(0);
});

test("rejected edit remains editable with its draft", async ({ page }) => {
  const fixture = await openChat(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const editor = page
    .locator("textarea")
    .filter({ hasNot: page.locator('[placeholder="Type your message..."]') })
    .first();
  await editor.fill("Keep my edited prompt");
  await editor.press("Control+Enter");
  await expect(page.getByText(limitMessage, { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("Keep my edited prompt");
  expect(fixture.submits).toBe(1);
});

test("active work keeps polling and remains cancellable", async ({ page }) => {
  const fixture = await openChat(page);
  fixture.busy = true;
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  const reads = fixture.reads;
  await expect.poll(() => fixture.reads).toBeGreaterThan(reads);
  expect(fixture.submits).toBe(0);
  expect(fixture.cancelCalls).toBe(0);
});

test("rejected regeneration keeps the previous answer", async ({ page }) => {
  const fixture = await openChat(page);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(limitMessage, { exact: true })).toHaveCount(1);
  await expect(
    page.getByText("Original answer", { exact: true }),
  ).toBeVisible();
  expect(fixture.submits).toBe(1);
});

test("rejected approval edit preserves the edited arguments", async ({
  page,
}) => {
  const fixture = await openChat(page, 1);
  const input = page
    .locator("textarea")
    .filter({ hasNot: page.locator('[placeholder="Type your message..."]') })
    .first();
  await input.fill("Keep my approval changes");
  const previousReads = fixture.reads;
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText(limitMessage, { exact: true })).toHaveCount(1);
  await expect.poll(() => fixture.reads).toBeGreaterThan(previousReads);
  await expect(input).toHaveValue("Keep my approval changes");
  expect(fixture.submits).toBe(1);
  await expect(page.getByText("Success", { exact: true })).toHaveCount(0);
});

test("rejected batch approval does not report success", async ({ page }) => {
  const fixture = await openChat(page, 2);
  await page.getByRole("button", { name: "Approve All", exact: true }).click();
  await expect(page.getByText(limitMessage, { exact: true })).toHaveCount(1);
  await expect(page.getByText("Success", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve All", exact: true }),
  ).toBeEnabled();
  expect(fixture.submits).toBe(1);
});

test("daily ring stays quiet and reveals current details on hover and keyboard focus", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const fixture = await openChat(page);
  const ring = page.getByTestId("daily-budget");
  const details = page.locator('[data-slot="tooltip-content"]');
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $5.00 left of $5.00 today",
  );
  await expect(details).toHaveCount(0);
  await expect(ring).toHaveText("");
  const input = page.getByPlaceholder("Type your message...");
  await input.fill("Plan my next request");
  await page.screenshot({
    path: testInfo.outputPath("daily-budget-desktop-rest.png"),
  });
  fixture.budget = {
    ...fixture.budget,
    spent_microusd: 1_800_000,
    extra_credit_microusd: 2_000_000,
    limit_microusd: 7_000_000,
    remaining_microusd: 5_200_000,
  };
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $5.20 left of $7.00 today",
  );
  await ring.hover();
  await expect(details).toBeVisible();
  await expect(details).toContainText("Spent today: $1.80");
  await expect(details).toContainText("Extra credits: $2.00");
  await expect(details).toContainText("Resets at midnight IST");
  await page.waitForTimeout(250);
  await page.screenshot({
    path: testInfo.outputPath("daily-budget-desktop-details.png"),
  });
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await ring.focus();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(input).toHaveValue("Plan my next request");
  fixture.budget = {
    ...fixture.budget,
    spent_microusd: 7_500_000,
    remaining_microusd: 0,
  };
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $0.00 left of $7.00 today",
  );
  fixture.budgetStatus = 503;
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: Daily budget temporarily unavailable",
  );
  fixture.budgetStatus = 200;
  fixture.budget.remaining_microusd = -1;
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: Daily budget temporarily unavailable",
  );
  fixture.budgetStatus = 404;
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveCount(0);
});

test("daily ring clears the old balance at the reset boundary", async ({
  page,
}) => {
  const fixture = await openChat(page);
  fixture.rejection = "USAGE_UNAVAILABLE";
  const ring = page.getByTestId("daily-budget");
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $5.00 left of $5.00 today",
  );
  fixture.budget = {
    ...fixture.budget,
    spent_microusd: 4_000_000,
    remaining_microusd: 1_000_000,
    resets_at: new Date(Date.now() + 2500).toISOString(),
  };
  const input = page.getByPlaceholder("Type your message...");
  await input.fill("Refresh budget");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $1.00 left of $5.00 today",
  );
  fixture.budgetDelayMs = 3500;
  fixture.budgetStatus = 503;
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: Updating daily budget…",
    { timeout: 3000 },
  );
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: Daily budget temporarily unavailable",
    { timeout: 5000 },
  );
});

test.describe("budget touch details", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("tap toggles details, outside dismisses, and the footer stays compact", async ({
    page,
  }, testInfo) => {
    await openChat(page);
    const ring = page.getByTestId("daily-budget");
    const details = page.locator('[data-slot="tooltip-content"]');
    await expect(ring).toHaveAttribute(
      "aria-label",
      "Daily budget: $5.00 left of $5.00 today",
    );
    await expect(details).toHaveCount(0);
    const box = await ring.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    expect(box!.width).toBeGreaterThanOrEqual(36);
    await page.screenshot({
      path: testInfo.outputPath("daily-budget-mobile-rest.png"),
    });
    await ring.tap();
    await expect(details).toBeVisible();
    await expect(details).toContainText("$5.00 left of $5.00 today");
    await page.waitForTimeout(250);
    await page.screenshot({
      path: testInfo.outputPath("daily-budget-mobile-details.png"),
    });
    const detailBox = await details.boundingBox();
    expect(detailBox!.x).toBeGreaterThanOrEqual(0);
    expect(detailBox!.x + detailBox!.width).toBeLessThanOrEqual(390);
    await ring.tap();
    await expect(details).toHaveCount(0);
    await ring.tap();
    await expect(details).toBeVisible();
    await page.getByText("Original answer", { exact: true }).tap();
    await expect(details).toHaveCount(0);
  });
});

test("budget ring colours use the full daily allowance at the 50 and 75 percent thresholds", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await openChat(page);
  const ring = page.getByTestId("daily-budget");
  await expect(ring).toHaveAttribute(
    "aria-label",
    "Daily budget: $5.00 left of $5.00 today",
  );
  for (const [percent, colour] of [
    [49, "green"],
    [50, "amber"],
    [74, "amber"],
    [75, "red"],
    [100, "red"],
  ] as const) {
    fixture.budget = {
      ...fixture.budget,
      extra_credit_microusd: 5_000_000,
      limit_microusd: 10_000_000,
      spent_microusd: percent * 100_000,
      remaining_microusd: (100 - percent) * 100_000,
    };
    await page.clock.fastForward(61_000);
    await expect(ring).toHaveAttribute(
      "aria-label",
      `Daily budget: $${((100 - percent) / 10).toFixed(2)} left of $10.00 today`,
    );
    await expect(ring.locator("svg")).toHaveClass(
      new RegExp(`text-${colour}-600`),
    );
    await page.getByPlaceholder("Type your message...").focus();
    await ring.focus();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
      `${percent}% used`,
    );
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
  }
  await expect(ring.locator("circle").first()).toHaveClass("opacity-70");
  fixture.budget = {
    ...fixture.budget,
    base_limit_microusd: 0,
    extra_credit_microusd: 0,
    limit_microusd: 0,
    spent_microusd: 0,
    remaining_microusd: 0,
  };
  await page.clock.fastForward(61_000);
  await expect(ring.locator("svg")).toHaveClass(/text-red-600/);
});
