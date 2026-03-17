export const BUSY_POLL_INTERVAL_MS = 1500;
export const SETTLED_VISIBLE_POLL_INTERVAL_MS = 15000;
export const SETTLED_HIDDEN_POLL_INTERVAL_MS = 60000;
export const SETTLED_HIDDEN_LONG_POLL_INTERVAL_MS = 120000;
export const BACKGROUND_SLOW_POLL_AFTER_MS = 5 * 60 * 1000;
export const BACKGROUND_LONG_POLL_AFTER_MS = 30 * 60 * 1000;
export const POLL_RETRY_DELAYS_MS = [3000, 5000, 10000] as const;
export const INTERACTION_REFRESH_THROTTLE_MS = 5000;

function normalizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  return status.trim().toLowerCase();
}

export function isRunActiveStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === "pending" || normalized === "running";
}

export function isThreadActiveStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === "busy";
}

export function getThreadPollDelay(params: {
  atMs: number;
  failureCount: number;
  isPageVisible: boolean;
  isWindowFocused: boolean;
  lastUserInteractionAtMs: number;
  runStatus: string | null;
  threadStatus: string | null;
}): number {
  const {
    atMs,
    failureCount,
    isPageVisible,
    isWindowFocused,
    lastUserInteractionAtMs,
    runStatus,
    threadStatus,
  } = params;

  if (failureCount > 0) {
    return (
      POLL_RETRY_DELAYS_MS[
        Math.min(failureCount - 1, POLL_RETRY_DELAYS_MS.length - 1)
      ]
    );
  }

  if (isThreadActiveStatus(threadStatus) || isRunActiveStatus(runStatus)) {
    return BUSY_POLL_INTERVAL_MS;
  }

  if (isPageVisible && isWindowFocused) {
    return SETTLED_VISIBLE_POLL_INTERVAL_MS;
  }

  const inactivityMs = Math.max(0, atMs - lastUserInteractionAtMs);
  if (inactivityMs >= BACKGROUND_LONG_POLL_AFTER_MS) {
    return SETTLED_HIDDEN_LONG_POLL_INTERVAL_MS;
  }

  if (inactivityMs >= BACKGROUND_SLOW_POLL_AFTER_MS) {
    return SETTLED_HIDDEN_POLL_INTERVAL_MS;
  }

  return SETTLED_VISIBLE_POLL_INTERVAL_MS;
}

export function shouldHydrateThreadState(params: {
  forceHistory?: boolean;
  forceHydrate?: boolean;
  hasRawState: boolean;
  runChanged: boolean;
  staleUiRecovery: boolean;
  threadBecameActive: boolean;
  threadBecameSettled: boolean;
  threadUpdated: boolean;
}): boolean {
  const {
    forceHistory,
    forceHydrate,
    hasRawState,
    runChanged,
    staleUiRecovery,
    threadBecameActive,
    threadBecameSettled,
    threadUpdated,
  } = params;

  return (
    !!forceHistory ||
    !!forceHydrate ||
    !hasRawState ||
    runChanged ||
    staleUiRecovery ||
    threadBecameActive ||
    threadBecameSettled ||
    threadUpdated
  );
}
