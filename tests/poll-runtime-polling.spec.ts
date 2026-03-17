import { expect, test } from "@playwright/test";
import {
  BACKGROUND_LONG_POLL_AFTER_MS,
  BACKGROUND_SLOW_POLL_AFTER_MS,
  BUSY_POLL_INTERVAL_MS,
  SETTLED_HIDDEN_LONG_POLL_INTERVAL_MS,
  SETTLED_HIDDEN_POLL_INTERVAL_MS,
  SETTLED_VISIBLE_POLL_INTERVAL_MS,
  getThreadPollDelay,
  shouldHydrateThreadState,
} from "../src/lib/poll-runtime-polling";

test("poll delay stays fast while thread or run is active", async () => {
  const nowMs = Date.now();

  const activeThreadDelay = getThreadPollDelay({
    atMs: nowMs,
    failureCount: 0,
    isPageVisible: true,
    isWindowFocused: true,
    lastUserInteractionAtMs: nowMs,
    runStatus: null,
    threadStatus: "busy",
  });
  expect(activeThreadDelay).toBe(BUSY_POLL_INTERVAL_MS);

  const activeRunDelay = getThreadPollDelay({
    atMs: nowMs,
    failureCount: 0,
    isPageVisible: false,
    isWindowFocused: false,
    lastUserInteractionAtMs: nowMs - BACKGROUND_LONG_POLL_AFTER_MS,
    runStatus: "running",
    threadStatus: "idle",
  });
  expect(activeRunDelay).toBe(BUSY_POLL_INTERVAL_MS);
});

test("poll delay degrades for settled hidden sessions by inactivity", async () => {
  const nowMs = Date.now();

  const visibleDelay = getThreadPollDelay({
    atMs: nowMs,
    failureCount: 0,
    isPageVisible: true,
    isWindowFocused: true,
    lastUserInteractionAtMs: nowMs,
    runStatus: "success",
    threadStatus: "idle",
  });
  expect(visibleDelay).toBe(SETTLED_VISIBLE_POLL_INTERVAL_MS);

  const hiddenShortDelay = getThreadPollDelay({
    atMs: nowMs,
    failureCount: 0,
    isPageVisible: false,
    isWindowFocused: false,
    lastUserInteractionAtMs: nowMs - BACKGROUND_SLOW_POLL_AFTER_MS,
    runStatus: "success",
    threadStatus: "idle",
  });
  expect(hiddenShortDelay).toBe(SETTLED_HIDDEN_POLL_INTERVAL_MS);

  const hiddenLongDelay = getThreadPollDelay({
    atMs: nowMs,
    failureCount: 0,
    isPageVisible: false,
    isWindowFocused: false,
    lastUserInteractionAtMs: nowMs - BACKGROUND_LONG_POLL_AFTER_MS,
    runStatus: "success",
    threadStatus: "idle",
  });
  expect(hiddenLongDelay).toBe(SETTLED_HIDDEN_LONG_POLL_INTERVAL_MS);
});

test("hydrate decision stays true for forced or material state transitions", async () => {
  expect(
    shouldHydrateThreadState({
      forceHydrate: true,
      hasRawState: true,
      runChanged: false,
      staleUiRecovery: false,
      threadBecameActive: false,
      threadBecameSettled: false,
      threadUpdated: false,
    }),
  ).toBe(true);

  expect(
    shouldHydrateThreadState({
      hasRawState: true,
      runChanged: true,
      staleUiRecovery: false,
      threadBecameActive: false,
      threadBecameSettled: false,
      threadUpdated: false,
    }),
  ).toBe(true);

  expect(
    shouldHydrateThreadState({
      hasRawState: true,
      runChanged: false,
      staleUiRecovery: false,
      threadBecameActive: false,
      threadBecameSettled: false,
      threadUpdated: false,
    }),
  ).toBe(false);
});
