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

test("daily ring refreshes remaining budget and extra credits without changing drafts", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const fixture = await openChat(page);
  const ring = page.getByTestId("daily-budget");
  await expect(ring).toContainText("$5.00 left of $5.00 today");
  const input = page.getByPlaceholder("Type your message...");
  await input.fill("Plan my next request");
  fixture.budget = {
    ...fixture.budget,
    spent_microusd: 1_800_000,
    extra_credit_microusd: 2_000_000,
    limit_microusd: 7_000_000,
    remaining_microusd: 5_200_000,
  };
  await page.clock.fastForward(61_000);
  await expect(ring).toContainText("$5.20 left of $7.00 today");
  await expect(ring).toContainText("Includes $2.00 extra credits");
  await expect(ring).toContainText("Resets at midnight IST");
  await page.screenshot({
    path: testInfo.outputPath("daily-budget-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("daily-budget-mobile.png"),
  });
  const box = await ring.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(input).toHaveValue("Plan my next request");
  fixture.budget = {
    ...fixture.budget,
    spent_microusd: 7_500_000,
    remaining_microusd: 0,
  };
  await page.clock.fastForward(61_000);
  await expect(ring).toContainText("$0.00 left of $7.00 today");
  fixture.budgetStatus = 503;
  await page.clock.fastForward(61_000);
  await expect(ring).toContainText("Daily budget temporarily unavailable");
  await expect(ring).not.toContainText("$0.00");
  fixture.budgetStatus = 200;
  fixture.budget.remaining_microusd = -1;
  await page.clock.fastForward(61_000);
  await expect(ring).toContainText("Daily budget temporarily unavailable");
  fixture.budgetStatus = 404;
  await page.clock.fastForward(61_000);
  await expect(ring).toHaveCount(0);
});

test("daily ring clears the old balance at the reset boundary", async ({
  page,
}) => {
  const fixture = await openChat(page);
  fixture.rejection = "USAGE_UNAVAILABLE";
  await expect(page.getByTestId("daily-budget")).toContainText(
    "$5.00 left of $5.00 today",
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
  const ring = page.getByTestId("daily-budget");
  await expect(ring).toContainText("$1.00 left of $5.00 today");
  fixture.budgetDelayMs = 3500;
  fixture.budgetStatus = 503;
  // A new submission restarts the poll effect while its budget request is slow.
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(ring).toContainText("Updating daily budget…", { timeout: 3000 });
  await expect(ring).not.toContainText("$1.00");
  await expect(ring).toContainText("Daily budget temporarily unavailable", {
    timeout: 5000,
  });
  await expect(ring).not.toContainText("$1.00");
});
