import type { Run } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyStreamError } from "@/lib/stream-error-classifier";
import type { useStreamContext } from "@/providers/Stream";

const FAST_RETRY_WINDOW_MS = 60_000;
const PASSIVE_RETRY_INTERVAL_MS = 30_000;
const FAST_RETRY_DELAYS_MS = [800, 1_500, 2_500, 4_000, 6_000, 8_000];
const RUN_LIST_LIMIT = 10;
const TERMINAL_RUN_FRESHNESS_WINDOW_MS = 10 * 60_000;
const MAX_FINAL_RECONCILE_ATTEMPTS = 3;
const RECONNECT_INTENT_MAX_AGE_MS = 12_000;

type StreamLike = ReturnType<typeof useStreamContext>;
export type ReconnectIntentReason = "recoverable_disconnect" | "startup_resume";
export type ReconnectIntent = {
  id: string;
  threadId: string;
  reason: ReconnectIntentReason;
  createdAtMs: number;
  showStatus: boolean;
};
type RunResolutionSource =
  | "session_storage"
  | "running"
  | "pending"
  | "latest";
type ResolvedRunCandidate = {
  runId: string;
  status: string | null;
  source: RunResolutionSource;
};

export type StreamReconnectPhase =
  | "idle"
  | "resolving_run"
  | "joining_stream"
  | "retry_wait"
  | "passive_wait";

type StreamReconnectState = {
  isReconnecting: boolean;
  phase: StreamReconnectPhase;
  attemptCount: number;
  statusText: string | null;
  activeRunId: string | null;
  reconnectReason: ReconnectIntentReason | null;
  shouldShowStatus: boolean;
};

type UseStreamAutoReconnectParams = {
  stream: StreamLike;
  threadId: string | null;
  threadStatus: string | null;
  isCurrentThreadBusyElsewhere: boolean;
  isCurrentThreadOwnedByTab: boolean;
  reconnectIntent: ReconnectIntent | null;
  consumeReconnectIntent: (intentId: string) => void;
};

type UseStreamAutoReconnectResult = StreamReconnectState & {
  stopReconnect: () => void;
  showReconnectStatus: boolean;
};

const INITIAL_STATE: StreamReconnectState = {
  isReconnecting: false,
  phase: "idle",
  attemptCount: 0,
  statusText: null,
  activeRunId: null,
  reconnectReason: null,
  shouldShowStatus: false,
};

function toTimestampMs(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function selectFreshestRun(runs: Run[]): Run | null {
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => {
    const aTs = Math.max(
      toTimestampMs(a.updated_at),
      toTimestampMs(a.created_at),
    );
    const bTs = Math.max(
      toTimestampMs(b.updated_at),
      toTimestampMs(b.created_at),
    );
    return bTs - aTs;
  })[0];
}

function getRunUpdatedAtMs(run: Run): number {
  return Math.max(toTimestampMs(run.updated_at), toTimestampMs(run.created_at));
}

function isRunFreshEnough(run: Run, maxAgeMs: number): boolean {
  const updatedAtMs = getRunUpdatedAtMs(run);
  if (updatedAtMs <= 0) return false;
  return Date.now() - updatedAtMs <= maxAgeMs;
}

function readStoredRunId(threadId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const runId = window.sessionStorage.getItem(`lg:stream:${threadId}`);
    if (!runId) return null;
    const normalized = runId.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function buildAbortError(): Error {
  try {
    return new DOMException("Reconnect aborted", "AbortError");
  } catch {
    const fallback = new Error("Reconnect aborted");
    fallback.name = "AbortError";
    return fallback;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name?: string }).name === "AbortError"
  );
}

async function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw buildAbortError();
  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(buildAbortError());
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForPassiveRetryTrigger(signal: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    await waitWithAbort(PASSIVE_RETRY_INTERVAL_MS, signal);
    return;
  }

  if (signal.aborted) throw buildAbortError();

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };

    const fail = () => {
      if (done) return;
      done = true;
      cleanup();
      reject(buildAbortError());
    };

    const onOnline = () => finish();
    const onVisibility = () => {
      if (!document.hidden) finish();
    };
    const onAbort = () => fail();

    const timeoutId = window.setTimeout(finish, PASSIVE_RETRY_INTERVAL_MS);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      signal.removeEventListener("abort", onAbort);
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useStreamAutoReconnect({
  stream,
  threadId,
  threadStatus,
  isCurrentThreadBusyElsewhere,
  isCurrentThreadOwnedByTab,
  reconnectIntent,
  consumeReconnectIntent,
}: UseStreamAutoReconnectParams): UseStreamAutoReconnectResult {
  const [state, setState] = useState<StreamReconnectState>(INITIAL_STATE);
  const controllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  const previousThreadIdRef = useRef<string | null>(threadId);
  const latestRef = useRef({
    threadStatus,
    isLoading: stream.isLoading,
    isCurrentThreadBusyElsewhere,
    isCurrentThreadOwnedByTab,
  });

  const hasValidReconnectIntent = useMemo(() => {
    if (!reconnectIntent || !threadId) return false;
    if (reconnectIntent.threadId !== threadId) return false;
    return Date.now() - reconnectIntent.createdAtMs <= RECONNECT_INTENT_MAX_AGE_MS;
  }, [reconnectIntent, threadId]);

  const shouldAttemptReconnect = useMemo(
    () =>
      hasValidReconnectIntent &&
      threadStatus === "busy" &&
      !stream.isLoading &&
      (!isCurrentThreadBusyElsewhere || isCurrentThreadOwnedByTab),
    [
      hasValidReconnectIntent,
      threadStatus,
      stream.isLoading,
      isCurrentThreadBusyElsewhere,
      isCurrentThreadOwnedByTab,
    ],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestRef.current = {
      threadStatus,
      isLoading: stream.isLoading,
      isCurrentThreadBusyElsewhere,
      isCurrentThreadOwnedByTab,
    };
  }, [
    threadStatus,
    stream.isLoading,
    isCurrentThreadBusyElsewhere,
    isCurrentThreadOwnedByTab,
  ]);

  const stopReconnect = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const resolveRunForRecovery = useCallback(
    async (
      targetThreadId: string,
      options?: { includeTerminalFallback?: boolean },
    ): Promise<ResolvedRunCandidate | null> => {
      const includeTerminalFallback = options?.includeTerminalFallback ?? false;
      const sessionRunId = readStoredRunId(targetThreadId);
      if (sessionRunId) {
        return {
          runId: sessionRunId,
          source: "session_storage",
          status: null,
        };
      }

      let firstError: unknown;

      try {
        const runningRuns = await stream.client.runs.list(targetThreadId, {
          status: "running",
          limit: RUN_LIST_LIMIT,
        });
        const freshestRunningRun = selectFreshestRun(runningRuns);
        if (freshestRunningRun?.run_id) {
          return {
            runId: freshestRunningRun.run_id,
            source: "running",
            status: freshestRunningRun.status,
          };
        }
      } catch (error) {
        firstError = error;
      }

      try {
        const pendingRuns = await stream.client.runs.list(targetThreadId, {
          status: "pending",
          limit: RUN_LIST_LIMIT,
        });
        const freshestPendingRun = selectFreshestRun(pendingRuns);
        if (freshestPendingRun?.run_id) {
          return {
            runId: freshestPendingRun.run_id,
            source: "pending",
            status: freshestPendingRun.status,
          };
        }
      } catch (error) {
        if (!firstError) {
          firstError = error;
        }
      }

      if (includeTerminalFallback) {
        try {
          const recentRuns = await stream.client.runs.list(targetThreadId, {
            limit: RUN_LIST_LIMIT,
          });
          const freshestRun = selectFreshestRun(recentRuns);
          if (
            freshestRun?.run_id &&
            isRunFreshEnough(freshestRun, TERMINAL_RUN_FRESHNESS_WINDOW_MS)
          ) {
            return {
              runId: freshestRun.run_id,
              source: "latest",
              status: freshestRun.status,
            };
          }
        } catch (error) {
          if (!firstError) {
            firstError = error;
          }
        }
      }

      if (firstError) {
        throw firstError;
      }

      return null;
    },
    [stream.client.runs],
  );

  const startReconnectLoop = useCallback(
    async (
      targetThreadId: string,
      reconnectReason: ReconnectIntentReason,
      shouldShowStatus: boolean,
    ) => {
      if (!targetThreadId) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const startAtMs = Date.now();
      let attempt = 0;
      let joinedSuccessfully = false;

      while (!controller.signal.aborted) {
        const latest = latestRef.current;
        const stillEligible =
          threadId === targetThreadId &&
          latest.threadStatus === "busy" &&
          !latest.isLoading &&
          (!latest.isCurrentThreadBusyElsewhere ||
            latest.isCurrentThreadOwnedByTab);

        if (!stillEligible) {
          break;
        }

        attempt += 1;
        setState((prev) => ({
          ...prev,
          isReconnecting: true,
          phase: "resolving_run",
          attemptCount: attempt,
          reconnectReason,
          shouldShowStatus,
          statusText: shouldShowStatus
            ? `Reconnecting stream (attempt ${attempt})...`
            : null,
        }));

        let runCandidate: ResolvedRunCandidate | null = null;
        let encounteredError: unknown;
        try {
          runCandidate = await resolveRunForRecovery(targetThreadId, {
            includeTerminalFallback: false,
          });
        } catch (error) {
          encounteredError = error;
        }

        if (controller.signal.aborted) return;

        if (runCandidate?.runId) {
          try {
            setState((prev) => ({
              ...prev,
              isReconnecting: true,
              phase: "joining_stream",
              attemptCount: attempt,
              activeRunId: runCandidate.runId,
              reconnectReason,
              shouldShowStatus,
              statusText: shouldShowStatus
                ? `Reconnecting stream (attempt ${attempt})...`
                : null,
            }));

            await stream.joinStream(runCandidate.runId);
            if (controller.signal.aborted) return;

            joinedSuccessfully = true;
            controllerRef.current = null;
            setState((prev) => ({
              ...prev,
              isReconnecting: false,
              phase: "idle",
              statusText: null,
              attemptCount: attempt,
              activeRunId: runCandidate.runId,
              reconnectReason: null,
              shouldShowStatus: false,
            }));
            return;
          } catch (error) {
            if (isAbortError(error)) {
              return;
            }
            encounteredError = error;
          }
        }

        if (controller.signal.aborted) return;

        const classification = classifyStreamError(encounteredError, {
          hasInterrupt: false,
        });
        if (classification === "expected_interrupt_or_breakpoint") {
          controllerRef.current = null;
          setState(INITIAL_STATE);
          return;
        }

        if (classification !== "recoverable_disconnect") {
          break;
        }

        const elapsedMs = Date.now() - startAtMs;
        const withinFastWindow = elapsedMs < FAST_RETRY_WINDOW_MS;

        if (withinFastWindow) {
          const delayMs =
            FAST_RETRY_DELAYS_MS[
              Math.min(attempt - 1, FAST_RETRY_DELAYS_MS.length - 1)
            ];
          const waitLabel = Math.max(1, Math.ceil(delayMs / 1_000));
          setState((prev) => ({
            ...prev,
            isReconnecting: true,
            phase: "retry_wait",
            attemptCount: attempt,
            reconnectReason,
            shouldShowStatus,
            statusText: shouldShowStatus
              ? `Reconnecting in ${waitLabel}s...`
              : null,
          }));
          try {
            await waitWithAbort(delayMs, controller.signal);
          } catch (error) {
            if (isAbortError(error)) return;
            throw error;
          }
          continue;
        }

        setState((prev) => ({
          ...prev,
          isReconnecting: true,
          phase: "passive_wait",
          attemptCount: attempt,
          reconnectReason,
          shouldShowStatus,
          statusText: shouldShowStatus
            ? "Waiting for connection to resume..."
            : null,
        }));
        try {
          await waitForPassiveRetryTrigger(controller.signal);
        } catch (error) {
          if (isAbortError(error)) return;
          throw error;
        }
      }

      const latest = latestRef.current;
      const shouldTryFinalReconciliation =
        !joinedSuccessfully &&
        !controller.signal.aborted &&
        threadId === targetThreadId &&
        !latest.isLoading &&
        (!latest.isCurrentThreadBusyElsewhere ||
          latest.isCurrentThreadOwnedByTab);

      if (shouldTryFinalReconciliation) {
        for (
          let reconcileAttempt = 1;
          reconcileAttempt <= MAX_FINAL_RECONCILE_ATTEMPTS;
          reconcileAttempt += 1
        ) {
          const latestState = latestRef.current;
          const reconciliationEligible =
            !controller.signal.aborted &&
            threadId === targetThreadId &&
            !latestState.isLoading &&
            (!latestState.isCurrentThreadBusyElsewhere ||
              latestState.isCurrentThreadOwnedByTab);
          if (!reconciliationEligible) {
            break;
          }

          setState((prev) => ({
            ...prev,
            isReconnecting: true,
            phase: "resolving_run",
            attemptCount: Math.max(1, attempt),
            reconnectReason,
            shouldShowStatus,
            statusText: shouldShowStatus ? "Finalizing latest response..." : null,
          }));

          let runCandidate: ResolvedRunCandidate | null = null;
          let encounteredError: unknown;
          try {
            runCandidate = await resolveRunForRecovery(targetThreadId, {
              includeTerminalFallback: true,
            });
          } catch (error) {
            encounteredError = error;
          }

          if (controller.signal.aborted) return;
          if (!runCandidate?.runId) {
            break;
          }

          try {
            setState((prev) => ({
              ...prev,
              isReconnecting: true,
              phase: "joining_stream",
              attemptCount: Math.max(1, attempt),
              activeRunId: runCandidate.runId,
              reconnectReason,
              shouldShowStatus,
              statusText: shouldShowStatus
                ? "Finalizing latest response..."
                : null,
            }));

            await stream.joinStream(runCandidate.runId);
            if (controller.signal.aborted) return;

            joinedSuccessfully = true;
            controllerRef.current = null;
            setState((prev) => ({
              ...prev,
              isReconnecting: false,
              phase: "idle",
              statusText: null,
              attemptCount: Math.max(1, attempt),
              activeRunId: runCandidate.runId,
              reconnectReason: null,
              shouldShowStatus: false,
            }));
            return;
          } catch (error) {
            if (isAbortError(error)) {
              return;
            }
            encounteredError = error;
          }

          if (controller.signal.aborted) return;

          const classification = classifyStreamError(encounteredError, {
            hasInterrupt: false,
          });
          if (classification === "expected_interrupt_or_breakpoint") {
            controllerRef.current = null;
            setState(INITIAL_STATE);
            return;
          }

          const shouldRetry =
            classification === "recoverable_disconnect" &&
            reconcileAttempt < MAX_FINAL_RECONCILE_ATTEMPTS;
          if (!shouldRetry) {
            break;
          }

          setState((prev) => ({
            ...prev,
            isReconnecting: true,
            phase: "passive_wait",
            attemptCount: Math.max(1, attempt),
            reconnectReason,
            shouldShowStatus,
            statusText: shouldShowStatus
              ? "Waiting to finalize response..."
              : null,
          }));
          try {
            await waitForPassiveRetryTrigger(controller.signal);
          } catch (error) {
            if (isAbortError(error)) return;
            throw error;
          }
        }
      }

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setState((prev) =>
        prev.isReconnecting
          ? INITIAL_STATE
          : {
              ...prev,
              phase: "idle",
              statusText: null,
              activeRunId: null,
              attemptCount: 0,
              reconnectReason: null,
              shouldShowStatus: false,
            },
      );
    },
    [resolveRunForRecovery, stream, threadId],
  );

  useEffect(() => {
    if (stream.isLoading) {
      setState((prev) =>
        prev.isReconnecting
          ? {
              ...prev,
              isReconnecting: false,
              phase: "idle",
              statusText: null,
              reconnectReason: null,
              shouldShowStatus: false,
            }
          : prev,
      );
    }
  }, [stream.isLoading]);

  useEffect(() => {
    if (threadStatus === "busy") return;
    setState((prev) => {
      if (prev.isReconnecting) return prev;
      if (
        prev.activeRunId == null &&
        prev.phase === "idle" &&
        prev.statusText == null &&
        prev.attemptCount === 0
      ) {
        return prev;
      }

      return {
        ...prev,
        activeRunId: null,
        phase: "idle",
        statusText: null,
        attemptCount: 0,
        reconnectReason: null,
        shouldShowStatus: false,
      };
    });
  }, [threadStatus]);

  useEffect(() => {
    if (previousThreadIdRef.current === threadId) return;
    previousThreadIdRef.current = threadId;
    stopReconnect();
  }, [threadId, stopReconnect]);

  useEffect(() => {
    if (shouldAttemptReconnect && reconnectIntent) {
      if (!stateRef.current.isReconnecting) {
        consumeReconnectIntent(reconnectIntent.id);
        void startReconnectLoop(
          threadId!,
          reconnectIntent.reason,
          reconnectIntent.showStatus,
        );
      }
    }
  }, [
    consumeReconnectIntent,
    reconnectIntent,
    shouldAttemptReconnect,
    startReconnectLoop,
    threadId,
  ]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  return {
    ...state,
    showReconnectStatus: state.isReconnecting && state.shouldShowStatus,
    stopReconnect,
  };
}
