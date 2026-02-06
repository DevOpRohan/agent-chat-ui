import { Button } from "@/components/ui/button";
import { useThreads } from "@/providers/Thread";
import { Thread } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { THREAD_HISTORY_ENABLED } from "@/lib/constants";

import { useQueryState, parseAsBoolean } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { LoaderCircle, PanelRightOpen, PanelRightClose } from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useThreadLastSeen } from "@/hooks/use-thread-last-seen";
import { useThreadBusy } from "@/hooks/use-thread-busy";

const POLL_INTERVAL_IDLE_MS = 15000;
const POLL_INTERVAL_ACTIVE_MS = 5000;
const THREAD_PREVIEW_METADATA_KEYS = [
  "thread_preview",
  "thread_title",
  "title",
] as const;

function getThreadUpdatedAtMs(thread: Thread): number | null {
  const updatedAt = (
    thread as Thread & { updated_at?: string | number | Date | null }
  ).updated_at;
  if (!updatedAt) return null;
  if (typeof updatedAt === "number") {
    return Number.isFinite(updatedAt) ? updatedAt : null;
  }
  if (Object.prototype.toString.call(updatedAt) === "[object Date]") {
    return (updatedAt as Date).getTime();
  }
  if (typeof updatedAt === "string") {
    const parsed = Date.parse(updatedAt);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function getThreadPreviewFromMetadata(thread: Thread): string | null {
  const metadata = thread.metadata;
  if (!metadata || typeof metadata !== "object") return null;

  for (const key of THREAD_PREVIEW_METADATA_KEYS) {
    const rawValue = (metadata as Record<string, unknown>)[key];
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return null;
}

function getThreadListLabel(thread: Thread): string {
  return getThreadPreviewFromMetadata(thread) ?? thread.thread_id;
}

function getThreadSignature(thread: Thread): string {
  const updatedAtMs = getThreadUpdatedAtMs(thread);
  return [
    thread.thread_id,
    thread.status,
    updatedAtMs ?? "none",
    getThreadListLabel(thread),
  ].join("|");
}

function areThreadListsEquivalent(prev: Thread[], next: Thread[]): boolean {
  if (prev.length !== next.length) return false;
  for (let idx = 0; idx < prev.length; idx += 1) {
    if (getThreadSignature(prev[idx]) !== getThreadSignature(next[idx])) {
      return false;
    }
  }
  return true;
}

function ThreadList({
  threads,
  currentThreadId,
  setThreadId,
  lastSeenByThreadId,
  baselineMs,
  busyByThreadId,
  markSeen,
  onThreadClick,
}: {
  threads: Thread[];
  currentThreadId: string | null;
  setThreadId: (value: string | null) => void;
  lastSeenByThreadId: Record<string, number>;
  baselineMs: number;
  busyByThreadId: Record<string, boolean>;
  markSeen: (threadId: string, updatedAtMs?: number) => void;
  onThreadClick?: (threadId: string) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {threads.map((t) => {
        const itemText = getThreadListLabel(t);
        const updatedAtMs = getThreadUpdatedAtMs(t);
        const lastSeenMs = lastSeenByThreadId[t.thread_id] ?? baselineMs;
        const isBusy = busyByThreadId[t.thread_id] || t.status === "busy";
        const isActive = t.thread_id === currentThreadId;
        const isUnseen =
          !isBusy &&
          updatedAtMs !== null &&
          updatedAtMs > lastSeenMs &&
          !isActive;
        const indicator = isBusy ? (
          <span
            className="flex h-4 w-4 items-center justify-center"
            role="img"
            aria-label="Thread running"
          >
            <LoaderCircle
              className="size-3 animate-spin text-slate-500"
              aria-hidden="true"
            />
          </span>
        ) : isUnseen ? (
          <span
            className="flex h-4 w-4 items-center justify-center"
            role="img"
            aria-label="New activity"
          >
            <span className="size-2 rounded-full bg-emerald-500" />
          </span>
        ) : (
          <span
            className="flex h-4 w-4 items-center justify-center"
            aria-hidden="true"
          />
        );
        return (
          <div
            key={t.thread_id}
            className="w-full px-1"
          >
            <Button
              variant="ghost"
              data-thread-id={t.thread_id}
              data-thread-active={isActive ? "true" : "false"}
              className={`w-[280px] items-center justify-start gap-2 text-left font-normal ${
                isActive ? "bg-slate-200 text-slate-900 hover:bg-slate-200" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                markSeen(t.thread_id, updatedAtMs ?? undefined);
                onThreadClick?.(t.thread_id);
                if (t.thread_id === currentThreadId) return;
                setThreadId(t.thread_id);
              }}
            >
              {indicator}
              <p className="min-w-0 flex-1 truncate text-ellipsis">
                {itemText}
              </p>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
      {Array.from({ length: 30 }).map((_, i) => (
        <Skeleton
          key={`skeleton-${i}`}
          className="h-10 w-[280px]"
        />
      ))}
    </div>
  );
}

export default function ThreadHistory() {
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const [threadId, setThreadId] = useQueryState("threadId");
  const currentThreadId = threadId ?? null;
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );

  const { getThreads, threads, setThreads, threadsLoading, setThreadsLoading } =
    useThreads();
  const { lastSeenByThreadId, baselineMs, markSeen } = useThreadLastSeen();
  const { busyByThreadId, markBusy } = useThreadBusy();
  const historyDisabled = !THREAD_HISTORY_ENABLED;
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );
  const isHistoryVisible = !historyDisabled && !!chatHistoryOpen;

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const refreshThreads = useCallback(
    async (withLoading: boolean) => {
      if (historyDisabled) return;
      if (typeof window === "undefined") return;
      if (withLoading) setThreadsLoading(true);
      try {
        const nextThreads = await getThreads();
        setThreads((prevThreads) =>
          areThreadListsEquivalent(prevThreads, nextThreads)
            ? prevThreads
            : nextThreads,
        );
      } catch (error) {
        console.error(error);
      } finally {
        if (withLoading) setThreadsLoading(false);
      }
    },
    [getThreads, historyDisabled, setThreads, setThreadsLoading],
  );

  const hasBusyThread = useMemo(
    () =>
      threads.some(
        (thread) => busyByThreadId[thread.thread_id] || thread.status === "busy",
      ),
    [threads, busyByThreadId],
  );

  const hasUnseenThread = useMemo(() => {
    return threads.some((thread) => {
      const isBusy = busyByThreadId[thread.thread_id] || thread.status === "busy";
      if (isBusy) return false;
      if (thread.thread_id === currentThreadId) return false;
      const updatedAtMs = getThreadUpdatedAtMs(thread);
      if (updatedAtMs === null) return false;
      const lastSeenMs =
        lastSeenByThreadId[thread.thread_id] ?? baselineMs;
      return updatedAtMs > lastSeenMs;
    });
  }, [threads, currentThreadId, lastSeenByThreadId, baselineMs, busyByThreadId]);

  useEffect(() => {
    for (const thread of threads) {
      if (thread.status !== "busy" && busyByThreadId[thread.thread_id]) {
        markBusy(thread.thread_id, false);
      }
    }
  }, [threads, busyByThreadId, markBusy]);

  const pollIntervalMs = useMemo(
    () =>
      hasBusyThread || hasUnseenThread
        ? POLL_INTERVAL_ACTIVE_MS
        : POLL_INTERVAL_IDLE_MS,
    [hasBusyThread, hasUnseenThread],
  );

  useEffect(() => {
    if (!isHistoryVisible || !isPageVisible) return;
    refreshThreads(!hasLoadedRef.current);
    hasLoadedRef.current = true;
  }, [isHistoryVisible, isPageVisible, refreshThreads]);

  useEffect(() => {
    if (!isHistoryVisible) return;
    if (historyDisabled) return;
    if (!isPageVisible) return;
    let cancelled = false;
    let timeoutId: number | null = null;

    const tick = async () => {
      if (cancelled) return;
      await refreshThreads(false);
      if (cancelled) return;
      timeoutId = window.setTimeout(tick, pollIntervalMs);
    };

    timeoutId = window.setTimeout(tick, pollIntervalMs);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    historyDisabled,
    isHistoryVisible,
    isPageVisible,
    pollIntervalMs,
    refreshThreads,
  ]);

  useEffect(() => {
    if (!currentThreadId) return;
    const currentThread = threads.find(
      (thread) => thread.thread_id === currentThreadId,
    );
    if (!currentThread) return;
    const updatedAtMs = getThreadUpdatedAtMs(currentThread);
    if (updatedAtMs === null) return;
    const lastSeenMs = lastSeenByThreadId[currentThreadId] ?? baselineMs;
    if (updatedAtMs > lastSeenMs) {
      markSeen(currentThreadId, updatedAtMs);
    }
  }, [currentThreadId, threads, lastSeenByThreadId, baselineMs, markSeen]);

  return (
    <>
      <div className="shadow-inner-right hidden h-screen w-[300px] shrink-0 flex-col items-start justify-start gap-6 border-r-[1px] border-slate-300 lg:flex">
        <div className="flex w-full items-center justify-between px-4 pt-1.5">
          <Button
            className="hover:bg-gray-100"
            variant="ghost"
            onClick={() => setChatHistoryOpen((p) => !p)}
          >
            {chatHistoryOpen ? (
              <PanelRightOpen className="size-5" />
            ) : (
              <PanelRightClose className="size-5" />
            )}
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            Chat History
          </h1>
        </div>
        {historyDisabled ? (
          <div className="px-4 text-sm text-slate-500">
            Thread history is disabled.
          </div>
        ) : threadsLoading ? (
          <ThreadHistoryLoading />
        ) : (
          <ThreadList
            threads={threads}
            currentThreadId={currentThreadId}
            setThreadId={setThreadId}
            lastSeenByThreadId={lastSeenByThreadId}
            baselineMs={baselineMs}
            busyByThreadId={busyByThreadId}
            markSeen={markSeen}
          />
        )}
      </div>
      <div className="lg:hidden">
        <Sheet
          open={!!chatHistoryOpen && !isLargeScreen}
          onOpenChange={(open) => {
            if (isLargeScreen) return;
            setChatHistoryOpen(open);
          }}
        >
          <SheetContent
            side="left"
            className="flex lg:hidden"
          >
            <SheetHeader>
              <SheetTitle>Chat History</SheetTitle>
            </SheetHeader>
            {historyDisabled ? (
              <div className="px-1 text-sm text-slate-500">
                Thread history is disabled.
              </div>
            ) : (
              <ThreadList
                threads={threads}
                currentThreadId={currentThreadId}
                setThreadId={setThreadId}
                lastSeenByThreadId={lastSeenByThreadId}
                baselineMs={baselineMs}
                busyByThreadId={busyByThreadId}
                markSeen={markSeen}
                onThreadClick={() => setChatHistoryOpen((o) => !o)}
              />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
