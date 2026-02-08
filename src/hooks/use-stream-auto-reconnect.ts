import type { Run } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyStreamError } from "@/lib/stream-error-classifier";
import type { useStreamContext } from "@/providers/Stream";

const FAST_RETRY_WINDOW_MS = 60_000;
const PASSIVE_RETRY_INTERVAL_MS = 30_000;
const FAST_RETRY_DELAYS_MS = [800, 1_500, 2_500, 4_000, 6_000, 8_000];
const RUN_LIST_LIMIT = 10;

type StreamLike = ReturnType<typeof useStreamContext>;

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
};

type UseStreamAutoReconnectParams = {
  stream: StreamLike;
  threadId: string | null;
  threadStatus: string | null;
  isCurrentThreadBusyElsewhere: boolean;
  isCurrentThreadOwnedByTab: boolean;
};

type UseStreamAutoReconnectResult = StreamReconnectState & {
  stopReconnect: () => void;
};

const INITIAL_STATE: StreamReconnectState = {
  isReconnecting: false,
  phase: "idle",
  attemptCount: 0,
  statusText: null,
  activeRunId: null,
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

  const shouldAttemptReconnect = useMemo(
    () =>
      !!threadId &&
      threadStatus === "busy" &&
      !stream.isLoading &&
      (!isCurrentThreadBusyElsewhere || isCurrentThreadOwnedByTab),
    [
      threadId,
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

  const resolveActiveRunId = useCallback(
    async (targetThreadId: string): Promise<string | null> => {
      const sessionRunId = readStoredRunId(targetThreadId);
      if (sessionRunId) {
        return sessionRunId;
      }

      let firstError: unknown;

      try {
        const runningRuns = await stream.client.runs.list(targetThreadId, {
          status: "running",
          limit: RUN_LIST_LIMIT,
        });
        const freshestRunningRun = selectFreshestRun(runningRuns);
        if (freshestRunningRun?.run_id) {
          return freshestRunningRun.run_id;
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
          return freshestPendingRun.run_id;
        }
      } catch (error) {
        if (!firstError) {
          firstError = error;
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
    async (targetThreadId: string) => {
      if (!targetThreadId) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const startAtMs = Date.now();
      let attempt = 0;

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
          statusText: `Reconnecting stream (attempt ${attempt})...`,
        }));

        let runId: string | null = null;
        let encounteredError: unknown;
        try {
          runId = await resolveActiveRunId(targetThreadId);
        } catch (error) {
          encounteredError = error;
        }

        if (controller.signal.aborted) return;

        if (runId) {
          try {
            setState((prev) => ({
              ...prev,
              isReconnecting: true,
              phase: "joining_stream",
              attemptCount: attempt,
              activeRunId: runId,
              statusText: `Reconnecting stream (attempt ${attempt})...`,
            }));

            await stream.joinStream(runId);
            if (controller.signal.aborted) return;

            controllerRef.current = null;
            setState((prev) => ({
              ...prev,
              isReconnecting: false,
              phase: "idle",
              statusText: null,
              attemptCount: attempt,
              activeRunId: runId,
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
            statusText: `Reconnecting in ${waitLabel}s...`,
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
          statusText: "Waiting for connection to resume...",
        }));
        try {
          await waitForPassiveRetryTrigger(controller.signal);
        } catch (error) {
          if (isAbortError(error)) return;
          throw error;
        }
      }

      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setState((prev) =>
        prev.isReconnecting ? INITIAL_STATE : { ...prev, phase: "idle" },
      );
    },
    [resolveActiveRunId, stream, threadId],
  );

  useEffect(() => {
    if (stream.isLoading) {
      setState((prev) =>
        prev.isReconnecting
          ? { ...prev, isReconnecting: false, phase: "idle", statusText: null }
          : prev,
      );
    }
  }, [stream.isLoading]);

  useEffect(() => {
    if (threadStatus === "busy") return;
    if (stateRef.current.activeRunId == null && !stateRef.current.isReconnecting) {
      return;
    }
    stopReconnect();
  }, [threadStatus, stopReconnect]);

  useEffect(() => {
    if (previousThreadIdRef.current === threadId) return;
    previousThreadIdRef.current = threadId;
    stopReconnect();
  }, [threadId, stopReconnect]);

  useEffect(() => {
    if (shouldAttemptReconnect) {
      if (!stateRef.current.isReconnecting) {
        void startReconnectLoop(threadId!);
      }
      return;
    }

    if (stateRef.current.isReconnecting && !stream.isLoading) {
      stopReconnect();
    }
  }, [
    shouldAttemptReconnect,
    startReconnectLoop,
    stopReconnect,
    stream.isLoading,
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
    stopReconnect,
  };
}
