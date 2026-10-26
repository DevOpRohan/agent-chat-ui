import { getApiKey } from "@/lib/api-key";
import {
  APP_MODES,
  type AppMode,
  type AppModeId,
  getAppMode,
  getThreadSearchMetadata,
} from "@/lib/app-mode";
import { THREAD_HISTORY_ENABLED } from "@/lib/constants";
import { Metadata, Thread } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useMemo,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { createClient } from "./client";

interface ThreadContextType {
  getThreads: (params?: {
    limit?: number;
    offset?: number;
  }) => Promise<Thread[]>;
  updateThread: (
    threadId: string,
    payload?: { metadata?: Metadata },
  ) => Promise<Thread>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

type ByMode<T> = Record<AppModeId, T>;

interface ThreadStoreContextType {
  /** Per mode, the metadata its history list filters on (`graph_id` or `assistant_id`). */
  listMetadataByMode: ByMode<Record<string, string>>;
  threadsByMode: ByMode<Thread[]>;
  setThreadsByMode: Dispatch<SetStateAction<ByMode<Thread[]>>>;
  loadingByMode: ByMode<boolean>;
  setLoadingByMode: Dispatch<SetStateAction<ByMode<boolean>>>;
  getThreadsForMode: (
    mode: AppMode,
    params?: { limit?: number; offset?: number },
  ) => Promise<Thread[]>;
  updateThread: ThreadContextType["updateThread"];
}

const ThreadStoreContext = createContext<ThreadStoreContextType | undefined>(
  undefined,
);
const ThreadContext = createContext<ThreadContextType | undefined>(undefined);
export const THREAD_HISTORY_PAGE_SIZE = 20;
const THREAD_HISTORY_SELECT = [
  "thread_id",
  "created_at",
  "updated_at",
  "status",
  "metadata",
] as const;

/**
 * The chat runtime (`Stream.tsx`) sits above the shell and only ever runs the
 * thread in `?threadId=`, which is a Crafter thread. Its `useThreads()` is
 * therefore always bound to Crafter's list, whatever mode is on screen.
 */
const CHAT_RUNTIME_MODE_ID: AppModeId = "crafter";

function byMode<T>(value: (mode: AppMode) => T): ByMode<T> {
  return Object.fromEntries(
    APP_MODES.map((mode) => [mode.id, value(mode)]),
  ) as ByMode<T>;
}

export function ThreadProvider({ children }: { children: ReactNode }) {
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const [apiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  // The chat runs on `?assistantId=` when the setup screen set one (see
  // Stream.tsx), so the chat mode's history filters on that id too.
  const [assistantId] = useQueryState("assistantId");
  const listMetadataByMode = useMemo(
    () =>
      byMode((mode) =>
        getThreadSearchMetadata(
          mode.pane === "chat" && assistantId
            ? { ...mode, graphId: assistantId }
            : mode,
        ),
      ),
    [assistantId],
  );
  const [threadsByMode, setThreadsByMode] = useState(() =>
    byMode<Thread[]>(() => []),
  );
  const [loadingByMode, setLoadingByMode] = useState(() =>
    byMode<boolean>(() => false),
  );

  const getThreadsForMode = useCallback(
    async (
      mode: AppMode,
      params?: { limit?: number; offset?: number },
    ): Promise<Thread[]> => {
      if (!THREAD_HISTORY_ENABLED) return [];
      const finalApiUrl = apiUrl || envApiUrl;
      if (!finalApiUrl) return [];
      const client = createClient(finalApiUrl, getApiKey() ?? undefined);

      const limit =
        typeof params?.limit === "number" && params.limit > 0
          ? params.limit
          : THREAD_HISTORY_PAGE_SIZE;
      const offset =
        typeof params?.offset === "number" && params.offset >= 0
          ? params.offset
          : 0;

      const threads = await client.threads.search({
        metadata: listMetadataByMode[mode.id],
        limit,
        offset,
        sortBy: "updated_at",
        sortOrder: "desc",
        select: [...THREAD_HISTORY_SELECT],
      });

      return threads;
    },
    [apiUrl, envApiUrl, listMetadataByMode],
  );

  const updateThread = useCallback(
    async (threadId: string, payload?: { metadata?: Metadata }) => {
      const finalApiUrl = apiUrl || envApiUrl;
      if (!finalApiUrl) {
        throw new Error("Missing API URL. Cannot update thread.");
      }
      const client = createClient(finalApiUrl, getApiKey() ?? undefined);
      return client.threads.update(threadId, payload);
    },
    [apiUrl, envApiUrl],
  );

  const store = useMemo<ThreadStoreContextType>(
    () => ({
      listMetadataByMode,
      threadsByMode,
      setThreadsByMode,
      loadingByMode,
      setLoadingByMode,
      getThreadsForMode,
      updateThread,
    }),
    [
      getThreadsForMode,
      listMetadataByMode,
      loadingByMode,
      threadsByMode,
      updateThread,
    ],
  );

  return (
    <ThreadStoreContext.Provider value={store}>
      <ThreadModeScope modeId={CHAT_RUNTIME_MODE_ID}>
        {children}
      </ThreadModeScope>
    </ThreadStoreContext.Provider>
  );
}

function useThreadStore() {
  const context = useContext(ThreadStoreContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}

/**
 * One mode's history list. Every function is bound to `modeId`, so a request
 * that finishes after the user switched mode still lands in its own list.
 */
export function useModeThreads(modeId: AppModeId): ThreadContextType {
  const {
    threadsByMode,
    setThreadsByMode,
    loadingByMode,
    setLoadingByMode,
    getThreadsForMode,
    updateThread,
  } = useThreadStore();

  const getThreads = useCallback(
    (params?: { limit?: number; offset?: number }) =>
      getThreadsForMode(getAppMode(modeId), params),
    [getThreadsForMode, modeId],
  );

  const setThreads = useCallback<Dispatch<SetStateAction<Thread[]>>>(
    (action) => {
      setThreadsByMode((previous) => {
        const current = previous[modeId];
        const next = typeof action === "function" ? action(current) : action;
        return next === current ? previous : { ...previous, [modeId]: next };
      });
    },
    [modeId, setThreadsByMode],
  );

  const setThreadsLoading = useCallback<Dispatch<SetStateAction<boolean>>>(
    (action) => {
      setLoadingByMode((previous) => {
        const current = previous[modeId];
        const next = typeof action === "function" ? action(current) : action;
        return next === current ? previous : { ...previous, [modeId]: next };
      });
    },
    [modeId, setLoadingByMode],
  );

  const threads = threadsByMode[modeId];
  const threadsLoading = loadingByMode[modeId];

  return useMemo(
    () => ({
      getThreads,
      updateThread,
      threads,
      setThreads,
      threadsLoading,
      setThreadsLoading,
    }),
    [
      getThreads,
      setThreads,
      setThreadsLoading,
      threads,
      threadsLoading,
      updateThread,
    ],
  );
}

/**
 * Makes `useThreads()` below it return `modeId`'s list. The shell wraps itself
 * in the current mode; the provider's own scope (seen by `Stream.tsx`) is the
 * chat runtime's mode.
 */
export function ThreadModeScope({
  modeId,
  children,
}: {
  modeId: AppModeId;
  children: ReactNode;
}) {
  const value = useModeThreads(modeId);
  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}

/**
 * The nearest scope's history list: inside the shell, the current mode's;
 * above it (`Stream.tsx`), Crafter's.
 */
export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}
