import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type Checkpoint,
  type Client,
  type Command,
  type Config,
  type Interrupt,
  type Message,
  type Metadata,
  type Run,
  type Thread,
  type ThreadState,
} from "@langchain/langgraph-sdk";
import { Client as LangGraphClient } from "@langchain/langgraph-sdk";
import { type UIMessage } from "@langchain/langgraph-sdk/react-ui";
import { useQueryState } from "nuqs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QuestionCrafterLogoSVG } from "@/components/icons/question-crafter";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { getApiKey } from "@/lib/api-key";
import {
  createAuthFetch,
  getAuthHeaderValue,
  getCachedAuthHeader,
  getAuthToken,
  isIapAuthMode,
} from "@/lib/auth-token";
import { THREAD_HISTORY_ENABLED } from "@/lib/constants";
import { THREAD_HISTORY_PAGE_SIZE, useThreads } from "./Thread";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  buildMessageMetadata,
  getBranchContext,
  getMessagesFromState,
  type RuntimeMessageMetadata,
} from "@/lib/thread-branching";
import {
  INTERACTION_REFRESH_THROTTLE_MS,
  getThreadPollDelay,
  isRunActiveStatus,
  shouldHydrateThreadState,
} from "@/lib/poll-runtime-polling";

export type StateType = {
  context?: Record<string, unknown>;
  messages: Message[];
  ui?: UIMessage[];
  [key: string]: unknown;
};

type RuntimePhase =
  | "hydrating"
  | "idle"
  | "submitting"
  | "polling"
  | "canceling"
  | "error";

type RuntimeSubmitOptions = {
  config?: Config;
  context?: Record<string, unknown>;
  checkpoint?: Omit<Checkpoint, "thread_id"> | null;
  command?: Command;
  interruptBefore?: "*" | string[];
  interruptAfter?: "*" | string[];
  metadata?: Metadata;
  multitaskStrategy?: "enqueue" | "interrupt" | "reject" | "rollback";
  onCompletion?: "complete" | "continue";
  onDisconnect?: "cancel" | "continue";
  optimisticValues?:
    | Partial<StateType>
    | ((prev: StateType) => Partial<StateType>);
  durability?: "async" | "exit" | "sync";
  threadId?: string;
};

type RuntimeSubmitInput =
  | Record<string, unknown>
  | Message
  | Message[]
  | string
  | null
  | undefined;

type OptimisticState = {
  pendingMessageIds: string[];
  threadId: string;
  values: StateType;
};

type ThreadRuntimeContextType = {
  activeRunId: string | null;
  assistantId: string;
  branch: string;
  cancel: () => Promise<void>;
  client: Client;
  error: unknown;
  experimental_branchTree: ReturnType<typeof getBranchContext<StateType>>["branchTree"];
  getMessagesMetadata: (
    message: Message,
    index?: number,
  ) => RuntimeMessageMetadata<StateType> | undefined;
  history: ThreadState<StateType>[];
  interrupt: Interrupt<unknown> | Interrupt<unknown>[] | undefined;
  isLoading: boolean;
  isThreadLoading: boolean;
  isWorking: boolean;
  latestRunStatus: string | null;
  messages: Message[];
  phase: RuntimePhase;
  refresh: (options?: {
    forceHistory?: boolean;
    forceHydrate?: boolean;
  }) => Promise<void>;
  setBranch: (branch: string) => void;
  submit: (
    values: RuntimeSubmitInput,
    options?: RuntimeSubmitOptions,
  ) => Promise<void>;
  threadId: string | null;
  threadStatus: string | null;
  values: StateType;
};

const HISTORY_LIMIT = 100;
const RUN_STATUS_LIST_LIMIT = 10;
const REFRESH_THREADS_DELAY_MS = 750;

const ThreadRuntimeContext = createContext<
  ThreadRuntimeContextType | undefined
>(undefined);

function getEmptyValues(): StateType {
  return {
    messages: [],
    ui: [],
  };
}

async function sleep(ms = REFRESH_THREADS_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isThreadBusy(status: string | null | undefined) {
  return status === "busy";
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

function selectActiveRun(runs: Run[]): Run | null {
  const activeRuns = runs.filter(
    (run) => run.status === "pending" || run.status === "running",
  );
  return selectFreshestRun(activeRuns);
}

function compareThreadRecency(a: Thread, b: Thread): number {
  const aUpdatedAt = toTimestampMs(
    (a as Thread & { updated_at?: string | null }).updated_at,
  );
  const bUpdatedAt = toTimestampMs(
    (b as Thread & { updated_at?: string | null }).updated_at,
  );
  return bUpdatedAt - aUpdatedAt;
}

function upsertThreadSummary(
  previousThreads: Thread[],
  nextThread: Thread,
): Thread[] {
  const existingIndex = previousThreads.findIndex(
    (thread) => thread.thread_id === nextThread.thread_id,
  );
  const nextThreads =
    existingIndex >= 0
      ? previousThreads.map((thread, index) =>
          index === existingIndex ? nextThread : thread,
        )
      : [nextThread, ...previousThreads];

  return [...nextThreads].sort(compareThreadRecency);
}

function normalizeSubmitInput(values: RuntimeSubmitInput) {
  if (typeof values === "undefined") {
    return undefined;
  }

  if (values === null) {
    return null;
  }

  if (typeof values === "string") {
    return {
      messages: [
        {
          type: "human",
          content: values,
        } satisfies Message,
      ],
    };
  }

  if (Array.isArray(values)) {
    return { messages: values };
  }

  if ("type" in values) {
    return { messages: [values as Message] };
  }

  return values;
}

function getInterrupt(
  values: StateType,
  threadHead: ThreadState<StateType> | undefined,
  error: unknown,
) {
  const valueInterrupts = values.__interrupt__;
  if (Array.isArray(valueInterrupts)) {
    if (valueInterrupts.length === 0) {
      return { when: "breakpoint" } as Interrupt<unknown>;
    }

    if (valueInterrupts.length === 1) {
      return valueInterrupts[0] as Interrupt<unknown>;
    }

    return valueInterrupts as Interrupt<unknown>[];
  }

  const interrupts = threadHead?.tasks?.at(-1)?.interrupts;
  if (interrupts == null || interrupts.length === 0) {
    const next = threadHead?.next ?? [];
    if (!next.length || error != null) return undefined;
    return { when: "breakpoint" } as Interrupt<unknown>;
  }

  return interrupts.at(-1) as Interrupt<unknown> | undefined;
}

function getUiMessages(values: StateType | null | undefined): UIMessage[] {
  return Array.isArray(values?.ui) ? values.ui : [];
}

function mergeStateValues(
  liveValues: StateType | null | undefined,
  historyValues: StateType | null | undefined,
): StateType {
  if (!liveValues && !historyValues) {
    return getEmptyValues();
  }

  if (!historyValues) {
    return liveValues ?? getEmptyValues();
  }

  if (!liveValues) {
    return historyValues;
  }

  const mergedValues = {
    ...historyValues,
    ...liveValues,
  };

  if (
    getMessagesFromState(liveValues).length === 0 &&
    getMessagesFromState(historyValues).length > 0
  ) {
    mergedValues.messages = historyValues.messages;
  }

  if (
    getUiMessages(liveValues).length === 0 &&
    getUiMessages(historyValues).length > 0
  ) {
    mergedValues.ui = historyValues.ui;
  }

  return mergedValues;
}

function mergeThreadStates(
  liveState: ThreadState<StateType> | null,
  historyState: ThreadState<StateType> | undefined,
): ThreadState<StateType> | undefined {
  if (!liveState) {
    return historyState;
  }

  if (!historyState) {
    return liveState;
  }

  return {
    ...historyState,
    ...liveState,
    values: mergeStateValues(liveState.values, historyState.values),
    next:
      liveState.next.length > 0 || historyState.next.length === 0
        ? liveState.next
        : historyState.next,
    tasks:
      liveState.tasks.length > 0 || historyState.tasks.length === 0
        ? liveState.tasks
        : historyState.tasks,
  };
}

async function checkGraphStatus(
  apiUrl: string,
  apiKey: string | null,
  isIapAuth: boolean,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (isIapAuth) {
      const authHeader = await getAuthHeaderValue();
      if (authHeader) {
        headers.Authorization = authHeader;
      }
    } else if (apiKey) {
      headers["X-Api-Key"] = apiKey;
    }

    const res = await fetch(`${apiUrl}/info`, {
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });

    return res.ok;
  } catch (error) {
    console.error(error);
    return false;
  }
}

const ThreadRuntimeSession = ({
  children,
  apiKey,
  apiUrl,
  assistantId,
  isIapAuth,
}: {
  children: ReactNode;
  apiKey: string | null;
  apiUrl: string;
  assistantId: string;
  isIapAuth: boolean;
}) => {
  const [threadId, setThreadId] = useQueryState("threadId");
  const { getThreads, setThreads, threads } = useThreads();
  const [authHeader, setAuthHeader] = useState<string | undefined>(() =>
    isIapAuth ? getCachedAuthHeader() : undefined,
  );
  const authFetch = useMemo(
    () => (isIapAuth ? createAuthFetch() : undefined),
    [isIapAuth],
  );
  const callerOptions = useMemo(
    () => (authFetch ? { fetch: authFetch } : undefined),
    [authFetch],
  );
  const defaultHeaders = useMemo(
    () => (authHeader ? { Authorization: authHeader } : undefined),
    [authHeader],
  );
  const client = useMemo(
    () =>
      new LangGraphClient({
        apiUrl,
        apiKey: isIapAuth ? undefined : (apiKey ?? undefined),
        callerOptions,
        defaultHeaders,
      }),
    [apiKey, apiUrl, callerOptions, defaultHeaders, isIapAuth],
  );

  const [phase, setPhase] = useState<RuntimePhase>(() =>
    threadId ? "hydrating" : "idle",
  );
  const [error, setError] = useState<unknown>(undefined);
  const [rawState, setRawState] = useState<ThreadState<StateType> | null>(null);
  const [historyData, setHistoryData] = useState<ThreadState<StateType>[]>([]);
  const [branch, setBranch] = useState("");
  const [threadStatus, setThreadStatus] = useState<string | null>(null);
  const [latestRunStatus, setLatestRunStatus] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [optimisticState, setOptimisticState] = useState<OptimisticState | null>(
    null,
  );

  const threadIdRef = useRef(threadId);
  const rawStateRef = useRef(rawState);
  const historyDataRef = useRef(historyData);
  const threadStatusRef = useRef(threadStatus);
  const latestRunStatusRef = useRef(latestRunStatus);
  const activeRunIdRef = useRef(activeRunId);
  const phaseRef = useRef(phase);
  const optimisticStateRef = useRef(optimisticState);
  const refreshRequestRef = useRef(0);
  const pollFailureCountRef = useRef(0);
  const lastSettledThreadStatusRef = useRef<string | null>(threadStatus);
  const lastThreadUpdatedAtRef = useRef<string | null>(null);
  const forceHydrateNextPollRef = useRef(true);
  const isPageVisibleRef = useRef(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const isWindowFocusedRef = useRef(
    typeof document === "undefined" ? true : document.hasFocus(),
  );
  const lastUserInteractionAtRef = useRef(Date.now());
  const lastInteractionRefreshAtRef = useRef(0);

  const persistThreadIdInUrl = useCallback((nextThreadId: string | null) => {
    if (typeof window === "undefined") return;

    const currentUrl = new URL(window.location.href);
    if (nextThreadId) {
      currentUrl.searchParams.set("threadId", nextThreadId);
    } else {
      currentUrl.searchParams.delete("threadId");
    }

    const nextRelativeUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    const currentRelativeUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRelativeUrl === currentRelativeUrl) {
      return;
    }

    // Keep the browser location in sync immediately so a manual reload does not
    // race ahead of the async query-state update.
    window.history.replaceState(window.history.state, "", nextRelativeUrl);
  }, []);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    rawStateRef.current = rawState;
  }, [rawState]);

  useEffect(() => {
    historyDataRef.current = historyData;
  }, [historyData]);

  useEffect(() => {
    threadStatusRef.current = threadStatus;
  }, [threadStatus]);

  useEffect(() => {
    latestRunStatusRef.current = latestRunStatus;
  }, [latestRunStatus]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    optimisticStateRef.current = optimisticState;
  }, [optimisticState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const effectiveThreadId = threadIdRef.current ?? threadId;
    if (!effectiveThreadId) return;
    if (phase !== "submitting" && phase !== "polling" && phase !== "hydrating") {
      return;
    }

    const currentThreadId = new URL(window.location.href).searchParams.get(
      "threadId",
    );
    if (currentThreadId === effectiveThreadId) {
      return;
    }

    persistThreadIdInUrl(effectiveThreadId);
  }, [persistThreadIdInUrl, phase, threadId]);

  useEffect(() => {
    if (!isIapAuth) {
      setAuthHeader(undefined);
      return;
    }

    let cancelled = false;
    getAuthToken()
      .then((token) => {
        if (!cancelled && token) {
          setAuthHeader(`Bearer ${token}`);
        }
      })
      .catch((authError) => {
        console.error("Failed to prefetch auth token", authError);
      });

    return () => {
      cancelled = true;
    };
  }, [isIapAuth]);

  const syncThreadsSoon = useCallback(
    (nextThreadId?: string | null) => {
      if (!THREAD_HISTORY_ENABLED) return;
      const historyLimit = Math.max(
        threads.length + (nextThreadId ? 1 : 0),
        THREAD_HISTORY_PAGE_SIZE,
      );
      void sleep()
        .then(() => getThreads({ limit: historyLimit }).then(setThreads))
        .catch(console.error);
    },
    [getThreads, setThreads, threads.length],
  );

  const refreshThreadState = useCallback(
    async (
      targetThreadId: string,
      options?: {
        forceHistory?: boolean;
        forceHydrate?: boolean;
      },
    ) => {
      const refreshId = ++refreshRequestRef.current;

      try {
        const [currentThread, recentRuns] = await Promise.all([
          client.threads.get<StateType>(targetThreadId),
          client.runs
            .list(targetThreadId, { limit: RUN_STATUS_LIST_LIMIT })
            .catch(() => []),
        ]);
        if (
          threadIdRef.current !== targetThreadId ||
          refreshRequestRef.current !== refreshId
        ) {
          return;
        }

        const nextThreadStatus = currentThread.status ?? null;
        const nextActiveRun = selectActiveRun(recentRuns);
        const nextLatestRun = selectFreshestRun(recentRuns);
        const nextRunStatus = nextLatestRun?.status ?? null;
        const nextActiveRunId = nextActiveRun?.run_id ?? null;
        const nextThreadUpdatedAt =
          typeof currentThread.updated_at === "string"
            ? currentThread.updated_at
            : null;
        const previousThreadStatus = threadStatusRef.current;
        const previousRunStatus = latestRunStatusRef.current;
        const previousActiveRunId = activeRunIdRef.current;
        const previousThreadUpdatedAt = lastThreadUpdatedAtRef.current;
        const threadBecameActive =
          !isThreadBusy(previousThreadStatus) && isThreadBusy(nextThreadStatus);
        const threadBecameSettled =
          isThreadBusy(previousThreadStatus) && !isThreadBusy(nextThreadStatus);
        const runChanged =
          previousRunStatus !== nextRunStatus ||
          previousActiveRunId !== nextActiveRunId;
        const threadUpdated =
          !!nextThreadUpdatedAt &&
          nextThreadUpdatedAt !== previousThreadUpdatedAt;
        const shouldHydrateState = shouldHydrateThreadState({
          forceHistory: options?.forceHistory,
          forceHydrate: options?.forceHydrate,
          hasRawState: rawStateRef.current != null,
          runChanged,
          staleUiRecovery: forceHydrateNextPollRef.current,
          threadBecameActive,
          threadBecameSettled,
          threadUpdated,
        });
        const refreshedThreadSummary: Thread = {
          ...currentThread,
          status: nextThreadStatus,
          updated_at: currentThread.updated_at ?? new Date().toISOString(),
        };

        pollFailureCountRef.current = 0;
        lastSettledThreadStatusRef.current = nextThreadStatus;
        lastThreadUpdatedAtRef.current = nextThreadUpdatedAt;
        setError(undefined);
        setThreadStatus(nextThreadStatus);
        setLatestRunStatus(nextRunStatus);
        setActiveRunId(nextActiveRunId);
        setPhase(
          isThreadBusy(nextThreadStatus) || isRunActiveStatus(nextRunStatus)
            ? "polling"
            : "idle",
        );
        setThreads((previousThreads) =>
          upsertThreadSummary(previousThreads, refreshedThreadSummary),
        );
        setOptimisticState((previous) => {
          if (!previous || previous.threadId !== targetThreadId) {
            return previous;
          }

          if (!isThreadBusy(nextThreadStatus) && nextActiveRun == null) {
            return null;
          }
          return previous;
        });

        if (!shouldHydrateState) {
          return;
        }

        const nextRawState = await client.threads.getState<StateType>(
          targetThreadId,
        );
        if (
          threadIdRef.current !== targetThreadId ||
          refreshRequestRef.current !== refreshId
        ) {
          return;
        }

        forceHydrateNextPollRef.current = false;
        setRawState(nextRawState);
        setOptimisticState((previous) => {
          if (!previous || previous.threadId !== targetThreadId) {
            return previous;
          }

          const messageIds = new Set(
            getMessagesFromState(nextRawState.values)
              .map((message) => message.id)
              .filter((messageId): messageId is string => !!messageId),
          );
          const isHydrated = previous.pendingMessageIds.every((id) =>
            messageIds.has(id),
          );
          if (
            isHydrated ||
            (!isThreadBusy(nextThreadStatus) && nextActiveRun == null)
          ) {
            return null;
          }
          return previous;
        });

        const shouldRefreshHistory =
          options?.forceHistory ||
          historyDataRef.current.length === 0 ||
          threadBecameSettled;

        if (!shouldRefreshHistory) {
          return;
        }

        const nextHistory = await client.threads.getHistory<StateType>(
          targetThreadId,
          {
            limit: HISTORY_LIMIT,
          },
        );
        if (
          threadIdRef.current !== targetThreadId ||
          refreshRequestRef.current !== refreshId
        ) {
          return;
        }

        setHistoryData(nextHistory);
      } catch (refreshError) {
        if (threadIdRef.current !== targetThreadId) {
          return;
        }

        forceHydrateNextPollRef.current = true;
        pollFailureCountRef.current += 1;
        console.error("Failed to refresh thread state", refreshError);
        if (!rawStateRef.current && historyDataRef.current.length === 0) {
          setError(refreshError);
          setPhase("error");
        }
      }
    },
    [client, setThreads],
  );

  const refresh = useCallback(
    async (options?: { forceHistory?: boolean; forceHydrate?: boolean }) => {
      const targetThreadId = threadIdRef.current;
      if (!targetThreadId) {
        setPhase("idle");
        setError(undefined);
        setRawState(null);
        setHistoryData([]);
        setThreadStatus(null);
        setLatestRunStatus(null);
        setActiveRunId(null);
        setOptimisticState(null);
        return;
      }

      await refreshThreadState(targetThreadId, options);
    },
    [refreshThreadState],
  );

  useEffect(() => {
    if (!threadId) {
      setPhase("idle");
      setError(undefined);
      setRawState(null);
      setHistoryData([]);
      setThreadStatus(null);
      setLatestRunStatus(null);
      setActiveRunId(null);
      setOptimisticState(null);
      setBranch("");
      pollFailureCountRef.current = 0;
      lastSettledThreadStatusRef.current = null;
      lastThreadUpdatedAtRef.current = null;
      forceHydrateNextPollRef.current = true;
      return;
    }

    const nextOptimisticState = optimisticStateRef.current;
    const nextPhase = phaseRef.current;
    if (
      nextOptimisticState?.threadId === threadId &&
      (nextPhase === "submitting" || nextPhase === "polling")
    ) {
      return;
    }

    setBranch("");
    setError(undefined);
    setPhase("hydrating");
    setRawState(null);
    setHistoryData([]);
    setThreadStatus(null);
    setLatestRunStatus(null);
    setActiveRunId(null);
    setOptimisticState((previous) =>
      previous?.threadId === threadId ? previous : null,
    );
    pollFailureCountRef.current = 0;
    lastSettledThreadStatusRef.current = null;
    lastThreadUpdatedAtRef.current = null;
    forceHydrateNextPollRef.current = true;
    void refreshThreadState(threadId, { forceHistory: true, forceHydrate: true });
  }, [refreshThreadState, threadId]);

  useEffect(() => {
    if (!threadId) return;

    let cancelled = false;
    let timeoutId: number | null = null;

    const tick = async () => {
      await refreshThreadState(threadId);
      if (cancelled) return;
      timeoutId = window.setTimeout(
        tick,
        getThreadPollDelay({
          atMs: Date.now(),
          failureCount: pollFailureCountRef.current,
          isPageVisible: isPageVisibleRef.current,
          isWindowFocused: isWindowFocusedRef.current,
          lastUserInteractionAtMs: lastUserInteractionAtRef.current,
          runStatus: latestRunStatusRef.current,
          threadStatus: threadStatusRef.current,
        }),
      );
    };

    void tick();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [refreshThreadState, threadId]);

  useEffect(() => {
    if (!threadId) return;

    isPageVisibleRef.current = document.visibilityState === "visible";
    isWindowFocusedRef.current = document.hasFocus();

    const refreshNow = (markInteraction = false) => {
      const now = Date.now();
      if (markInteraction) {
        lastUserInteractionAtRef.current = now;
      }
      forceHydrateNextPollRef.current = true;
      void refresh({ forceHydrate: true });
    };

    const handleFocus = () => {
      isWindowFocusedRef.current = true;
      refreshNow(true);
    };
    const handleBlur = () => {
      isWindowFocusedRef.current = false;
    };
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      isPageVisibleRef.current = isVisible;
      if (isVisible) {
        isWindowFocusedRef.current = document.hasFocus();
        refreshNow(true);
      }
    };
    const handleOnline = () => {
      refreshNow(true);
    };
    const handleInteraction = () => {
      const now = Date.now();
      lastUserInteractionAtRef.current = now;
      if (
        now - lastInteractionRefreshAtRef.current <
        INTERACTION_REFRESH_THROTTLE_MS
      ) {
        return;
      }
      lastInteractionRefreshAtRef.current = now;
      refreshNow(false);
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pointerdown", handleInteraction, {
      passive: true,
    });
    window.addEventListener("keydown", handleInteraction);
    document.addEventListener("scroll", handleInteraction, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("keydown", handleInteraction);
      document.removeEventListener("scroll", handleInteraction, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refresh, threadId]);

  useEffect(() => {
    checkGraphStatus(apiUrl, apiKey, isIapAuth).then((ok) => {
      if (!ok) {
        toast.error("Failed to connect to LangGraph server", {
          description: () => (
            <p>
              Please ensure your graph is running at <code>{apiUrl}</code> and
              {isIapAuth
                ? " your IAP auth configuration is valid."
                : " your API key is correctly set (if connecting to a deployed graph)."}
            </p>
          ),
          duration: 10000,
          richColors: true,
          closeButton: true,
        });
      }
    });
  }, [apiKey, apiUrl, isIapAuth]);

  const branchContext = useMemo(() => {
    const usableHistory =
      historyData.length > 0
        ? historyData
        : rawState
          ? [rawState]
          : [];
    return getBranchContext<StateType>(branch, usableHistory);
  }, [branch, historyData, rawState]);

  const historyHead = branchContext.threadHead;

  const activeState = useMemo(() => {
    if (branch) {
      return historyHead ?? rawState ?? undefined;
    }

    return mergeThreadStates(rawState, historyHead);
  }, [branch, historyHead, rawState]);

  const baseValues = useMemo(() => {
    return activeState?.values ?? getEmptyValues();
  }, [activeState]);

  const effectiveThreadId = threadId ?? threadIdRef.current ?? null;

  const values = useMemo(() => {
    if (!optimisticState || optimisticState.threadId !== effectiveThreadId) {
      return baseValues;
    }

    return {
      ...baseValues,
      ...optimisticState.values,
    };
  }, [baseValues, effectiveThreadId, optimisticState]);

  const messages = useMemo(() => getMessagesFromState(values), [values]);
  const messageMetadata = useMemo(
    () =>
      buildMessageMetadata({
        values,
        history:
          historyData.length > 0
            ? historyData
            : activeState
              ? [activeState]
              : [],
        branchByCheckpoint: branchContext.branchByCheckpoint,
      }),
    [activeState, branchContext.branchByCheckpoint, historyData, values],
  );

  const getMessagesMetadata = useCallback(
    (message: Message, index?: number) => {
      return messageMetadata.find(
        (candidate) =>
          candidate.messageId === String(message.id ?? index ?? ""),
      );
    },
    [messageMetadata],
  );

  const isWorking = useMemo(
    () =>
      phase === "submitting" ||
      phase === "polling" ||
      phase === "canceling" ||
      isThreadBusy(threadStatus) ||
      isRunActiveStatus(latestRunStatus),
    [latestRunStatus, phase, threadStatus],
  );

  const interrupt = useMemo(
    () => getInterrupt(values, activeState, error),
    [activeState, error, values],
  );

  const submit = useCallback(
    async (input: RuntimeSubmitInput, options?: RuntimeSubmitOptions) => {
      const normalizedInput = normalizeSubmitInput(input);
      const checkpointId = options?.checkpoint?.checkpoint_id;
      if (checkpointId) {
        setBranch(branchContext.branchByCheckpoint[checkpointId]?.branch ?? "");
      }

      setPhase("submitting");
      setError(undefined);

      let targetThreadId = threadIdRef.current ?? null;
      let persistedThreadId = false;
      try {
        if (!targetThreadId) {
          const createdThread = await client.threads.create({
            metadata: options?.metadata,
            threadId: options?.threadId,
          });
          targetThreadId = createdThread.thread_id;
          threadIdRef.current = targetThreadId;
          if (threadId !== targetThreadId) {
            persistThreadIdInUrl(targetThreadId);
            void setThreadId(targetThreadId);
            persistedThreadId = true;
          }
          syncThreadsSoon(targetThreadId);
        }

        if (!targetThreadId) {
          throw new Error("Failed to determine thread ID for run creation.");
        }

        const nowIso = new Date().toISOString();
        setThreads((previousThreads) => {
          const existingThread = previousThreads.find(
            (thread) => thread.thread_id === targetThreadId,
          );
          const optimisticThreadSummary: Thread = {
            ...(existingThread ?? {
              thread_id: targetThreadId,
              created_at: nowIso,
            }),
            metadata: {
              ...(existingThread?.metadata ?? {}),
              ...(options?.metadata ?? {}),
            },
            status: "busy",
            thread_id: targetThreadId,
            updated_at: nowIso,
          } as Thread;

          return upsertThreadSummary(previousThreads, optimisticThreadSummary);
        });

        const optimisticValues =
          options?.optimisticValues == null
            ? null
            : typeof options.optimisticValues === "function"
              ? options.optimisticValues(baseValues)
              : options.optimisticValues;
        if (optimisticValues) {
          const optimisticSnapshot = {
            ...baseValues,
            ...optimisticValues,
          };
          const existingIds = new Set(
            getMessagesFromState(baseValues)
              .map((message) => message.id)
              .filter((messageId): messageId is string => !!messageId),
          );
          const pendingMessageIds = getMessagesFromState(optimisticSnapshot)
            .map((message) => message.id)
            .filter(
              (messageId): messageId is string =>
                !!messageId && !existingIds.has(messageId),
            );
          setOptimisticState({
            pendingMessageIds,
            threadId: targetThreadId,
            values: optimisticSnapshot,
          });
        }

        const run = await client.runs.create(targetThreadId, assistantId, {
          config: options?.config,
          context: options?.context,
          command: options?.command,
          durability: options?.durability,
          input: normalizedInput as Record<string, unknown> | null | undefined,
          interruptAfter: options?.interruptAfter,
          interruptBefore: options?.interruptBefore,
          metadata: options?.metadata,
          multitaskStrategy: options?.multitaskStrategy,
          onCompletion: options?.onCompletion,
          onDisconnect: options?.onDisconnect,
          checkpoint:
            options?.checkpoint === null ? undefined : options?.checkpoint,
        });

        setActiveRunId(run.run_id);
        setLatestRunStatus(run.status ?? null);
        setThreadStatus("busy");
        setPhase("polling");
        if (!persistedThreadId && threadId !== targetThreadId) {
          setThreadId(targetThreadId);
        }
        await refreshThreadState(targetThreadId, {
          forceHistory: historyDataRef.current.length === 0,
        });
      } catch (submitError) {
        console.error("Failed to create run", submitError);
        setError(submitError);
        setPhase(threadIdRef.current ? "idle" : "error");
        setOptimisticState(null);
        throw submitError;
      }
    },
    [
      assistantId,
      baseValues,
      branchContext.branchByCheckpoint,
      client,
      refreshThreadState,
      setThreads,
      setThreadId,
      syncThreadsSoon,
      threadId,
      persistThreadIdInUrl,
    ],
  );

  const resolveActiveRunId = useCallback(async () => {
    const targetThreadId = threadIdRef.current;
    if (!targetThreadId) return null;
    if (activeRunId) return activeRunId;

    const recentRuns = await client.runs
      .list(targetThreadId, { limit: RUN_STATUS_LIST_LIMIT })
      .catch(() => []);
    const nextActiveRun = selectActiveRun(recentRuns);
    return nextActiveRun?.run_id ?? null;
  }, [activeRunId, client]);

  const cancel = useCallback(async () => {
    const targetThreadId = threadIdRef.current;
    if (!targetThreadId) return;

    setPhase("canceling");
    setError(undefined);
    try {
      const runId = await resolveActiveRunId();
      if (runId) {
        await client.runs.cancel(targetThreadId, runId);
      }
      setOptimisticState(null);
      await refreshThreadState(targetThreadId, { forceHistory: true });
    } catch (cancelError) {
      console.error("Failed to cancel run", cancelError);
      setError(cancelError);
      setPhase("error");
      throw cancelError;
    }
  }, [client, refreshThreadState, resolveActiveRunId]);

  const value = useMemo<ThreadRuntimeContextType>(
    () => ({
      activeRunId,
      assistantId,
      branch,
      cancel,
      client,
      error,
      experimental_branchTree: branchContext.branchTree,
      getMessagesMetadata,
      history: branchContext.flatHistory,
      interrupt,
      isLoading: isWorking,
      isThreadLoading:
        phase === "hydrating" && rawState == null && historyData.length === 0,
      isWorking,
      latestRunStatus,
      messages,
      phase,
      refresh,
      setBranch,
      submit,
      threadId,
      threadStatus,
      values,
    }),
    [
      activeRunId,
      assistantId,
      branch,
      branchContext.branchTree,
      branchContext.flatHistory,
      cancel,
      client,
      error,
      getMessagesMetadata,
      historyData.length,
      interrupt,
      isWorking,
      latestRunStatus,
      messages,
      phase,
      rawState,
      refresh,
      submit,
      threadId,
      threadStatus,
      values,
    ],
  );

  return (
    <ThreadRuntimeContext.Provider value={value}>
      {children}
    </ThreadRuntimeContext.Provider>
  );
};

const DEFAULT_API_URL = "http://localhost:2024";
const DEFAULT_ASSISTANT_ID = "agent";

export const ThreadRuntimeProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { resolvedTheme } = useTheme();
  const isIapAuth = isIapAuthMode();
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const envAssistantId: string | undefined =
    process.env.NEXT_PUBLIC_ASSISTANT_ID;

  const [apiUrl, setApiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  const [assistantId, setAssistantId] = useQueryState("assistantId", {
    defaultValue: envAssistantId || "",
  });
  const [apiKey, _setApiKey] = useState(() => {
    if (isIapAuth) return "";
    const storedKey = getApiKey();
    return storedKey || "";
  });

  const setApiKey = (key: string) => {
    if (isIapAuth) return;
    window.localStorage.setItem("lg:chat:apiKey", key);
    _setApiKey(key);
  };

  const finalApiUrl = apiUrl || envApiUrl;
  const finalAssistantId = assistantId || envAssistantId;
  const logoVariant = resolvedTheme === "dark" ? "dark" : "light";

  if (!finalApiUrl || !finalAssistantId) {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center p-4">
        <ThemeToggle className="absolute top-4 right-4 z-10" />
        <div className="animate-in fade-in-0 zoom-in-95 bg-background flex max-w-3xl flex-col rounded-lg border shadow-lg">
          <div className="mt-14 flex flex-col gap-2 border-b p-6">
            <div className="flex flex-col items-start gap-2">
              <QuestionCrafterLogoSVG
                className="h-9"
                variant={logoVariant}
              />
              <h1 className="text-xl font-semibold tracking-tight">
                Question Crafter
              </h1>
            </div>
            <p className="text-muted-foreground">
              Welcome to Question Crafter! Before you get started, enter the
              deployment URL and the assistant / graph ID.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();

              const form = event.target as HTMLFormElement;
              const formData = new FormData(form);
              const nextApiUrl = formData.get("apiUrl") as string;
              const nextAssistantId = formData.get("assistantId") as string;
              const nextApiKey = isIapAuth
                ? ""
                : (formData.get("apiKey") as string);

              setApiUrl(nextApiUrl);
              if (!isIapAuth) {
                setApiKey(nextApiKey);
              }
              setAssistantId(nextAssistantId);
              form.reset();
            }}
            className="bg-muted/50 flex flex-col gap-6 p-6"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiUrl">
                Deployment URL<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the URL of your LangGraph deployment. Can be a local, or
                production deployment.
              </p>
              <Input
                id="apiUrl"
                name="apiUrl"
                className="bg-background"
                defaultValue={apiUrl || DEFAULT_API_URL}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="assistantId">
                Assistant / Graph ID<span className="text-rose-500">*</span>
              </Label>
              <p className="text-muted-foreground text-sm">
                This is the ID of the graph (can be the graph name), or
                assistant to fetch threads from, and invoke when actions are
                taken.
              </p>
              <Input
                id="assistantId"
                name="assistantId"
                className="bg-background"
                defaultValue={assistantId || DEFAULT_ASSISTANT_ID}
                required
              />
            </div>

            {!isIapAuth && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="apiKey">LangSmith API Key</Label>
                <p className="text-muted-foreground text-sm">
                  This is <strong>NOT</strong> required if using a local
                  LangGraph server. This value is stored in your browser's local
                  storage and is only used to authenticate requests sent to your
                  LangGraph server.
                </p>
                <PasswordInput
                  id="apiKey"
                  name="apiKey"
                  defaultValue={apiKey ?? ""}
                  className="bg-background"
                  placeholder="lsv2_pt_..."
                />
              </div>
            )}

            <div className="mt-2 flex justify-end">
              <Button
                type="submit"
                size="lg"
              >
                Continue
                <ArrowRight className="size-5" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <ThreadRuntimeSession
      apiKey={apiKey}
      apiUrl={finalApiUrl}
      assistantId={finalAssistantId}
      isIapAuth={isIapAuth}
    >
      {children}
    </ThreadRuntimeSession>
  );
};

export const useThreadRuntime = (): ThreadRuntimeContextType => {
  const context = useContext(ThreadRuntimeContext);
  if (context === undefined) {
    throw new Error(
      "useThreadRuntime must be used within a ThreadRuntimeProvider",
    );
  }
  return context;
};

export default ThreadRuntimeContext;
