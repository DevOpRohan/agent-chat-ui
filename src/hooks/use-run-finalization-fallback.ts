import type { Message, Run } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readRecoveryRunId } from "@/lib/stream-run-shadow";
import type { useStreamContext } from "@/providers/Stream";

const FALLBACK_INTENT_MAX_AGE_MS = 20_000;
const POLL_INTERVAL_MS = 2_000;
const RUN_LIST_LIMIT = 10;
const HYDRATE_RETRY_DELAYS_MS = [500, 900, 1_500];

type StreamLike = ReturnType<typeof useStreamContext>;

export type FinalizationFallbackReason =
  | "react_render_crash"
  | "react_185_stream_error"
  | "reconnect_exhausted";

export type FinalizationFallbackIntent = {
  id: string;
  threadId: string;
  reason: FinalizationFallbackReason;
  createdAtMs: number;
  runId?: string | null;
};

export type FinalizationFallbackPhase =
  | "idle"
  | "polling_terminal"
  | "hydrating_final_state"
  | "failed";

type FinalizationSnapshot = {
  hydratedAtMs: number;
  messages: Message[];
  snapshotKey: string;
  values: Record<string, unknown>;
};

type UseRunFinalizationFallbackParams = {
  stream: StreamLike;
  threadId: string | null;
  threadStatus: string | null;
  latestRunStatus: string | null;
  isCurrentThreadBusyElsewhere: boolean;
  isCurrentThreadOwnedByTab: boolean;
  intent: FinalizationFallbackIntent | null;
  consumeIntent: (intentId: string) => void;
};

type UseRunFinalizationFallbackResult = {
  activeRunId: string | null;
  clearFinalSnapshot: () => void;
  finalSnapshot: FinalizationSnapshot | null;
  isActive: boolean;
  phase: FinalizationFallbackPhase;
  statusText: string | null;
  stopFallback: () => void;
};

type FallbackState = {
  activeRunId: string | null;
  isActive: boolean;
  phase: FinalizationFallbackPhase;
  statusText: string | null;
};

const INITIAL_STATE: FallbackState = {
  activeRunId: null,
  isActive: false,
  phase: "idle",
  statusText: null,
};

function normalizeStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isRunActiveStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === "pending" || normalized === "running";
}

function isThreadBusyStatus(status: string | null | undefined): boolean {
  return normalizeStatus(status) === "busy";
}

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

function readMessagesFromValues(values: Record<string, unknown>): Message[] {
  const candidate = values.messages;
  return Array.isArray(candidate) ? (candidate as Message[]) : [];
}

function buildSnapshotKey(messages: Message[]): string {
  const tail = messages.at(-1);
  const tailId = tail?.id ?? "no-tail";
  let tailText = "";
  try {
    tailText =
      typeof tail?.content === "string"
        ? tail.content
        : JSON.stringify(tail?.content ?? "");
  } catch {
    tailText = "";
  }
  return `${messages.length}:${tailId}:${tailText.length}`;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useRunFinalizationFallback({
  stream,
  threadId,
  threadStatus,
  latestRunStatus,
  isCurrentThreadBusyElsewhere,
  isCurrentThreadOwnedByTab,
  intent,
  consumeIntent,
}: UseRunFinalizationFallbackParams): UseRunFinalizationFallbackResult {
  const [state, setState] = useState<FallbackState>(INITIAL_STATE);
  const [finalSnapshot, setFinalSnapshot] = useState<FinalizationSnapshot | null>(
    null,
  );
  const controllerRef = useRef<AbortController | null>(null);
  const latestRef = useRef({
    isCurrentThreadBusyElsewhere,
    isCurrentThreadOwnedByTab,
    latestRunStatus,
    threadId,
    threadStatus,
  });

  useEffect(() => {
    latestRef.current = {
      isCurrentThreadBusyElsewhere,
      isCurrentThreadOwnedByTab,
      latestRunStatus,
      threadId,
      threadStatus,
    };
  }, [
    isCurrentThreadBusyElsewhere,
    isCurrentThreadOwnedByTab,
    latestRunStatus,
    threadId,
    threadStatus,
  ]);

  const clearFinalSnapshot = useCallback(() => {
    setFinalSnapshot(null);
  }, []);

  const stopFallback = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const hasValidIntent = useMemo(() => {
    if (!intent || !threadId) return false;
    if (intent.threadId !== threadId) return false;
    return Date.now() - intent.createdAtMs <= FALLBACK_INTENT_MAX_AGE_MS;
  }, [intent, threadId]);

  const resolveRunId = useCallback(
    async (targetThreadId: string, preferredRunId?: string | null) => {
      if (preferredRunId) {
        try {
          const run = await stream.client.runs.get(targetThreadId, preferredRunId);
          return {
            runId: run.run_id,
            status: run.status ?? null,
          };
        } catch {
          // Fall through to listing runs.
        }
      }

      const recoveryRunId = readRecoveryRunId(targetThreadId);
      if (recoveryRunId && recoveryRunId !== preferredRunId) {
        try {
          const run = await stream.client.runs.get(targetThreadId, recoveryRunId);
          return {
            runId: run.run_id,
            status: run.status ?? null,
          };
        } catch {
          // Fall through to listing runs.
        }
      }

      try {
        const runningRuns = await stream.client.runs.list(targetThreadId, {
          limit: RUN_LIST_LIMIT,
          status: "running",
        });
        const freshestRunning = selectFreshestRun(runningRuns);
        if (freshestRunning?.run_id) {
          return {
            runId: freshestRunning.run_id,
            status: freshestRunning.status ?? null,
          };
        }
      } catch {
        // Fall through to any recent run.
      }

      try {
        const recentRuns = await stream.client.runs.list(targetThreadId, {
          limit: RUN_LIST_LIMIT,
        });
        const freshestRun = selectFreshestRun(recentRuns);
        if (freshestRun?.run_id) {
          return {
            runId: freshestRun.run_id,
            status: freshestRun.status ?? null,
          };
        }
      } catch {
        // No-op.
      }

      return {
        runId: null,
        status: null,
      };
    },
    [stream.client.runs],
  );

  const hydrateFinalState = useCallback(
    async (targetThreadId: string, signal: AbortSignal) => {
      for (let idx = 0; idx < HYDRATE_RETRY_DELAYS_MS.length; idx += 1) {
        const threadState = await stream.client.threads.getState(
          targetThreadId,
          undefined,
          { subgraphs: true },
        );
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const values =
          threadState?.values && typeof threadState.values === "object"
            ? (threadState.values as Record<string, unknown>)
            : {};
        const messages = readMessagesFromValues(values);
        if (messages.length > 0 || idx === HYDRATE_RETRY_DELAYS_MS.length - 1) {
          return {
            hydratedAtMs: Date.now(),
            messages,
            snapshotKey: buildSnapshotKey(messages),
            values,
          } satisfies FinalizationSnapshot;
        }

        await wait(HYDRATE_RETRY_DELAYS_MS[idx], signal);
      }

      return null;
    },
    [stream.client.threads],
  );

  useEffect(() => {
    if (!hasValidIntent || !intent || !threadId) {
      return;
    }

    if (controllerRef.current) {
      return;
    }

    consumeIntent(intent.id);

    const controller = new AbortController();
    controllerRef.current = controller;

    void (async () => {
      try {
        let runCandidate = await resolveRunId(threadId, intent.runId ?? null);
        if (controller.signal.aborted) return;

        setState({
          activeRunId: runCandidate.runId,
          isActive: true,
          phase: "polling_terminal",
          statusText: "Finalizing latest response...",
        });

        while (!controller.signal.aborted) {
          const latest = latestRef.current;
          const threadStillRelevant = latest.threadId === threadId;
          const shouldKeepAuthority =
            !latest.isCurrentThreadBusyElsewhere || latest.isCurrentThreadOwnedByTab;

          if (!threadStillRelevant || !shouldKeepAuthority) {
            break;
          }

          let currentThreadStatus: string | null = null;
          try {
            const currentThread = await stream.client.threads.get(threadId);
            currentThreadStatus = currentThread.status ?? null;
          } catch {
            currentThreadStatus = latest.threadStatus;
          }

          if (runCandidate.runId) {
            try {
              const run = await stream.client.runs.get(threadId, runCandidate.runId);
              runCandidate = {
                runId: run.run_id,
                status: run.status ?? null,
              };
            } catch {
              runCandidate = await resolveRunId(threadId, runCandidate.runId);
            }
          } else {
            runCandidate = await resolveRunId(threadId, null);
          }

          if (controller.signal.aborted) return;

          setState((previous) =>
            previous.isActive &&
            previous.phase === "polling_terminal" &&
            previous.activeRunId === runCandidate.runId
              ? previous
              : {
                  activeRunId: runCandidate.runId,
                  isActive: true,
                  phase: "polling_terminal",
                  statusText: "Finalizing latest response...",
                },
          );

          const threadBusy = isThreadBusyStatus(currentThreadStatus);
          const runActive = isRunActiveStatus(runCandidate.status);

          if (!threadBusy && !runActive) {
            break;
          }

          await wait(POLL_INTERVAL_MS, controller.signal);
        }

        if (controller.signal.aborted) return;

        setState((previous) => ({
          ...previous,
          isActive: true,
          phase: "hydrating_final_state",
          statusText: "Finalizing latest response...",
        }));

        const snapshot = await hydrateFinalState(threadId, controller.signal);
        if (controller.signal.aborted) return;

        setFinalSnapshot(snapshot);
        controllerRef.current = null;
        setState(INITIAL_STATE);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        controllerRef.current = null;
        setState({
          activeRunId: null,
          isActive: false,
          phase: "failed",
          statusText: null,
        });
      }
    })();

    return () => {
      controller.abort();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    consumeIntent,
    hasValidIntent,
    hydrateFinalState,
    intent,
    resolveRunId,
    stream.client.runs,
    stream.client.threads,
    threadId,
  ]);

  useEffect(() => {
    clearFinalSnapshot();
    stopFallback();
  }, [clearFinalSnapshot, stopFallback, threadId]);

  return {
    activeRunId: state.activeRunId,
    clearFinalSnapshot,
    finalSnapshot,
    isActive: state.isActive,
    phase: state.phase,
    statusText: state.statusText,
    stopFallback,
  };
}
