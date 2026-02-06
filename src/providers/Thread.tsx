import { getApiKey } from "@/lib/api-key";
import { THREAD_HISTORY_ENABLED } from "@/lib/constants";
import { Metadata, Thread } from "@langchain/langgraph-sdk";
import { useQueryState } from "nuqs";
import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useState,
  Dispatch,
  SetStateAction,
} from "react";
import { createClient } from "./client";

interface ThreadContextType {
  getThreads: (params?: { limit?: number; offset?: number }) => Promise<Thread[]>;
  updateThread: (
    threadId: string,
    payload?: { metadata?: Metadata },
  ) => Promise<Thread>;
  threads: Thread[];
  setThreads: Dispatch<SetStateAction<Thread[]>>;
  threadsLoading: boolean;
  setThreadsLoading: Dispatch<SetStateAction<boolean>>;
}

const ThreadContext = createContext<ThreadContextType | undefined>(undefined);
export const THREAD_HISTORY_PAGE_SIZE = 20;
const THREAD_HISTORY_SELECT = [
  "thread_id",
  "created_at",
  "updated_at",
  "status",
  "metadata",
] as const;

export function ThreadProvider({ children }: { children: ReactNode }) {
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const [apiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);

  const getThreads = useCallback(
    async (params?: { limit?: number; offset?: number }): Promise<Thread[]> => {
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
        limit,
        offset,
        sortBy: "updated_at",
        sortOrder: "desc",
        select: [...THREAD_HISTORY_SELECT],
      });

      return threads;
    },
    [apiUrl, envApiUrl],
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

  const value = {
    getThreads,
    updateThread,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  };

  return (
    <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
  );
}

export function useThreads() {
  const context = useContext(ThreadContext);
  if (context === undefined) {
    throw new Error("useThreads must be used within a ThreadProvider");
  }
  return context;
}
