import { Button } from "@/components/ui/button";
import { THREAD_HISTORY_PAGE_SIZE, useThreads } from "@/providers/Thread";
import { Thread } from "@langchain/langgraph-sdk";
import {
  UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { THREAD_HISTORY_ENABLED } from "@/lib/constants";
import { cn } from "@/lib/utils";

import { useQueryState, parseAsBoolean } from "nuqs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Check,
  LoaderCircle,
  PanelRightOpen,
  PanelRightClose,
  Pencil,
  SquarePen,
  X,
} from "lucide-react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useThreadLastSeen } from "@/hooks/use-thread-last-seen";
import { useThreadBusy } from "@/hooks/use-thread-busy";
import {
  getThreadLabelFromMetadata,
  toMetadataRecord,
} from "@/lib/thread-metadata";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const POLL_INTERVAL_IDLE_MS = 15000;
const POLL_INTERVAL_ACTIVE_MS = 5000;
const LOAD_MORE_THRESHOLD_PX = 120;
const THREAD_TITLE_MAX_LENGTH = 120;

function getErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeMessage = (error as { message?: unknown }).message;
  return typeof maybeMessage === "string" ? maybeMessage : undefined;
}
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
  return getThreadLabelFromMetadata(thread.metadata);
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

function isThreadActiveStatus(
  status: Thread["status"] | string | null | undefined,
): boolean {
  return status === "busy";
}

function normalizeThreadStatus(
  status: Thread["status"] | string | null | undefined,
): string | null {
  if (typeof status !== "string") return null;
  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getThreadAttentionStatusKey(
  status: Thread["status"] | string | null | undefined,
): "cancelled" | "incomplete" | "timeout" | "error" | "interrupted" | null {
  // SDK thread statuses include busy|idle|interrupted|error; keep custom fallbacks for deployed backends.
  const normalizedStatus = normalizeThreadStatus(status);
  if (!normalizedStatus) return null;
  if (
    normalizedStatus.includes("cancelled") ||
    normalizedStatus.includes("canceled")
  ) {
    return "cancelled";
  }
  if (normalizedStatus.includes("incomplete")) {
    return "incomplete";
  }
  if (normalizedStatus.includes("timeout")) {
    return "timeout";
  }
  if (normalizedStatus === "error" || normalizedStatus.includes("error")) {
    return "error";
  }
  if (
    normalizedStatus === "interrupted" ||
    normalizedStatus.includes("interrupt")
  ) {
    return "interrupted";
  }
  return null;
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
  seenAttentionStatusByThreadId,
  markSeen,
  markAttentionStatusSeen,
  onThreadClick,
  hasMore,
  isLoadingMore,
  onLoadMore,
  editingThreadId,
  renameDraft,
  renameSaving,
  onRenameDraftChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
}: {
  threads: Thread[];
  currentThreadId: string | null;
  setThreadId: (value: string | null) => void;
  lastSeenByThreadId: Record<string, number>;
  baselineMs: number;
  busyByThreadId: Record<string, boolean>;
  seenAttentionStatusByThreadId: Record<string, string>;
  markSeen: (threadId: string, updatedAtMs?: number) => void;
  markAttentionStatusSeen: (threadId: string, statusKey: string | null) => void;
  onThreadClick?: (threadId: string) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  editingThreadId: string | null;
  renameDraft: string;
  renameSaving: boolean;
  onRenameDraftChange: (value: string) => void;
  onRenameStart: (thread: Thread) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (thread: Thread) => void;
}) {
  const onListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore || isLoadingMore) return;
      const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (distanceFromBottom <= LOAD_MORE_THRESHOLD_PX) {
        onLoadMore();
      }
    },
    [hasMore, isLoadingMore, onLoadMore],
  );

  return (
    <div
      className="[&::-webkit-scrollbar-thumb]:bg-border flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
      onScroll={onListScroll}
    >
      {threads.map((t) => {
        const itemText = getThreadListLabel(t);
        const updatedAtMs = getThreadUpdatedAtMs(t);
        const lastSeenMs = lastSeenByThreadId[t.thread_id] ?? baselineMs;
        const isBusy =
          busyByThreadId[t.thread_id] || isThreadActiveStatus(t.status);
        const isActive = t.thread_id === currentThreadId;
        const attentionStatusKey =
          !isBusy && !isActive ? getThreadAttentionStatusKey(t.status) : null;
        const hasAttentionStatus =
          !!attentionStatusKey &&
          seenAttentionStatusByThreadId[t.thread_id] !== attentionStatusKey;
        const attentionAriaLabel = hasAttentionStatus
          ? attentionStatusKey === "cancelled"
            ? "Run cancelled"
            : attentionStatusKey === "incomplete"
              ? "Run incomplete"
              : attentionStatusKey === "timeout"
                ? "Run timed out"
                : attentionStatusKey === "error"
                  ? "Run failed"
                  : "Run interrupted"
          : "New activity";
        const isUnseen =
          (!isBusy &&
            updatedAtMs !== null &&
            updatedAtMs > lastSeenMs &&
            !isActive) ||
          hasAttentionStatus;
        const indicator = isBusy ? (
          <span
            className="flex h-4 w-4 items-center justify-center"
            role="img"
            aria-label="Thread running"
          >
            <LoaderCircle
              className="text-muted-foreground size-3 animate-spin"
              aria-hidden="true"
            />
          </span>
        ) : isUnseen ? (
          <span
            className="flex h-4 w-4 items-center justify-center"
            role="img"
            aria-label={attentionAriaLabel}
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
            className="group relative w-full px-1"
          >
            {editingThreadId === t.thread_id ? (
              <form
                className="bg-card border-border flex w-full items-center gap-0.5 rounded-md border p-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  onRenameSubmit(t);
                }}
              >
                <Input
                  value={renameDraft}
                  onChange={(e) => onRenameDraftChange(e.target.value)}
                  maxLength={THREAD_TITLE_MAX_LENGTH}
                  placeholder="Thread name"
                  autoFocus
                  className="h-8 min-w-0 text-sm"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="Save thread name"
                  disabled={renameSaving}
                >
                  {renameSaving ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="Cancel rename"
                  disabled={renameSaving}
                  onClick={onRenameCancel}
                >
                  <X className="size-4" />
                </Button>
              </form>
            ) : (
              <>
                <Button
                  variant="ghost"
                  data-thread-id={t.thread_id}
                  data-thread-active={isActive ? "true" : "false"}
                  className={`w-full items-center justify-start gap-2 pr-9 text-left font-normal ${
                    isActive
                      ? "bg-accent text-accent-foreground hover:bg-accent"
                      : ""
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    onRenameCancel();
                    markAttentionStatusSeen(t.thread_id, attentionStatusKey);
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Rename ${itemText}`}
                  className={cn(
                    "text-muted-foreground hover:bg-accent hover:text-accent-foreground absolute top-1/2 right-2 size-7 -translate-y-1/2 rounded-sm opacity-0 transition-opacity group-hover:opacity-100",
                    isActive && "opacity-100",
                  )}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRenameStart(t);
                  }}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        );
      })}
      {isLoadingMore ? (
        <div
          className="text-muted-foreground flex w-full items-center gap-2 px-3 py-2 text-xs"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            className="size-3 animate-spin"
            aria-hidden="true"
          />
          <span>Loading more history...</span>
        </div>
      ) : null}
    </div>
  );
}

function ThreadHistoryLoading() {
  return (
    <div className="[&::-webkit-scrollbar-thumb]:bg-border flex h-full w-full flex-col items-start justify-start gap-2 overflow-y-scroll [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
      {Array.from({ length: 30 }).map((_, i) => (
        <Skeleton
          key={`skeleton-${i}`}
          className="h-10 w-full"
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

  const {
    getThreads,
    updateThread,
    threads,
    setThreads,
    threadsLoading,
    setThreadsLoading,
  } = useThreads();
  const { lastSeenByThreadId, baselineMs, markSeen } = useThreadLastSeen();
  const { busyByThreadId, markBusy } = useThreadBusy();
  const historyDisabled = !THREAD_HISTORY_ENABLED;
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );
  const isHistoryVisible = !historyDisabled && !!chatHistoryOpen;

  const hasLoadedRef = useRef(false);
  const threadFetchLimitRef = useRef(THREAD_HISTORY_PAGE_SIZE);
  const loadMoreInFlightRef = useRef(false);
  const [threadsHasMore, setThreadsHasMore] = useState(true);
  const [threadsLoadingMore, setThreadsLoadingMore] = useState(false);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [seenAttentionStatusByThreadId, setSeenAttentionStatusByThreadId] =
    useState<Record<string, string>>({});

  const resetRename = useCallback(() => {
    setEditingThreadId(null);
    setRenameDraft("");
  }, []);

  const markAttentionStatusSeen = useCallback(
    (targetThreadId: string, statusKey: string | null) => {
      if (!statusKey) return;
      setSeenAttentionStatusByThreadId((previous) =>
        previous[targetThreadId] === statusKey
          ? previous
          : { ...previous, [targetThreadId]: statusKey },
      );
    },
    [],
  );

  const handleNewThread = useCallback(() => {
    setThreadId(null);
    resetRename();
  }, [resetRename, setThreadId]);

  const startRenameThread = useCallback((thread: Thread) => {
    setEditingThreadId(thread.thread_id);
    setRenameDraft(getThreadLabelFromMetadata(thread.metadata) ?? "");
  }, []);

  const submitRenameThread = useCallback(
    async (thread: Thread) => {
      if (renameSaving) return;
      const normalizedTitle = renameDraft
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, THREAD_TITLE_MAX_LENGTH);

      const existingMetadata = toMetadataRecord(thread.metadata);
      const existingTitle =
        typeof existingMetadata.thread_title === "string"
          ? existingMetadata.thread_title.trim()
          : "";

      if (existingTitle === normalizedTitle) {
        resetRename();
        return;
      }

      const nextMetadata = { ...existingMetadata };
      if (normalizedTitle.length > 0) {
        nextMetadata.thread_title = normalizedTitle;
        nextMetadata.title = normalizedTitle;
      } else {
        delete nextMetadata.thread_title;
        delete nextMetadata.title;
      }

      setRenameSaving(true);
      try {
        const updatedThread = await updateThread(thread.thread_id, {
          metadata: nextMetadata,
        });
        setThreads((prevThreads) =>
          prevThreads.map((currentThread) =>
            currentThread.thread_id === thread.thread_id
              ? {
                  ...currentThread,
                  metadata: updatedThread.metadata,
                  updated_at: updatedThread.updated_at,
                }
              : currentThread,
          ),
        );
        toast.success(
          normalizedTitle.length > 0
            ? "Thread name saved."
            : "Thread name cleared.",
        );
        resetRename();
      } catch (error) {
        const message =
          getErrorMessage(error) ?? "Failed to update thread name.";
        toast.error("Could not update thread name", {
          description: (
            <p>
              <strong>Error:</strong> <code>{message}</code>
            </p>
          ),
          richColors: true,
          closeButton: true,
        });
      } finally {
        setRenameSaving(false);
      }
    },
    [renameDraft, renameSaving, resetRename, setThreads, updateThread],
  );

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
    async ({
      withLoading,
      limit,
    }: {
      withLoading: boolean;
      limit?: number;
    }): Promise<boolean> => {
      if (historyDisabled) return false;
      if (typeof window === "undefined") return false;
      const fetchLimit = Math.max(
        limit ?? threadFetchLimitRef.current,
        THREAD_HISTORY_PAGE_SIZE,
      );
      if (withLoading) setThreadsLoading(true);
      try {
        const nextThreads = await getThreads({ limit: fetchLimit, offset: 0 });
        setThreads((prevThreads) =>
          areThreadListsEquivalent(prevThreads, nextThreads)
            ? prevThreads
            : nextThreads,
        );
        setThreadsHasMore(nextThreads.length >= fetchLimit);
        return true;
      } catch (error) {
        console.error(error);
        return false;
      } finally {
        if (withLoading) setThreadsLoading(false);
      }
    },
    [getThreads, historyDisabled, setThreads, setThreadsLoading],
  );

  const loadMoreThreads = useCallback(async () => {
    if (historyDisabled) return;
    if (threadsLoading) return;
    if (!threadsHasMore) return;
    if (loadMoreInFlightRef.current) return;

    const previousLimit = threadFetchLimitRef.current;
    const nextLimit = previousLimit + THREAD_HISTORY_PAGE_SIZE;
    threadFetchLimitRef.current = nextLimit;
    loadMoreInFlightRef.current = true;
    setThreadsLoadingMore(true);

    const loaded = await refreshThreads({
      withLoading: false,
      limit: nextLimit,
    });

    if (!loaded) {
      threadFetchLimitRef.current = previousLimit;
    }

    loadMoreInFlightRef.current = false;
    setThreadsLoadingMore(false);
  }, [historyDisabled, refreshThreads, threadsHasMore, threadsLoading]);

  const hasBusyThread = useMemo(
    () =>
      threads.some(
        (thread) =>
          busyByThreadId[thread.thread_id] ||
          isThreadActiveStatus(thread.status),
      ),
    [threads, busyByThreadId],
  );

  const hasUnseenThread = useMemo(() => {
    return threads.some((thread) => {
      const isBusy =
        busyByThreadId[thread.thread_id] || isThreadActiveStatus(thread.status);
      if (isBusy) return false;
      if (thread.thread_id === currentThreadId) return false;
      const attentionStatusKey = getThreadAttentionStatusKey(thread.status);
      if (
        attentionStatusKey &&
        seenAttentionStatusByThreadId[thread.thread_id] !== attentionStatusKey
      ) {
        return true;
      }
      const updatedAtMs = getThreadUpdatedAtMs(thread);
      if (updatedAtMs === null) return false;
      const lastSeenMs = lastSeenByThreadId[thread.thread_id] ?? baselineMs;
      return updatedAtMs > lastSeenMs;
    });
  }, [
    threads,
    currentThreadId,
    lastSeenByThreadId,
    baselineMs,
    busyByThreadId,
    seenAttentionStatusByThreadId,
  ]);

  useEffect(() => {
    for (const thread of threads) {
      if (
        !isThreadActiveStatus(thread.status) &&
        busyByThreadId[thread.thread_id]
      ) {
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
    refreshThreads({ withLoading: !hasLoadedRef.current });
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
      await refreshThreads({ withLoading: false });
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
    markAttentionStatusSeen(
      currentThreadId,
      getThreadAttentionStatusKey(currentThread.status),
    );
    const updatedAtMs = getThreadUpdatedAtMs(currentThread);
    if (updatedAtMs === null) return;
    const lastSeenMs = lastSeenByThreadId[currentThreadId] ?? baselineMs;
    if (updatedAtMs > lastSeenMs) {
      markSeen(currentThreadId, updatedAtMs);
    }
  }, [
    baselineMs,
    currentThreadId,
    lastSeenByThreadId,
    markAttentionStatusSeen,
    markSeen,
    threads,
  ]);

  useEffect(() => {
    setSeenAttentionStatusByThreadId((previous) => {
      const threadIds = new Set(threads.map((thread) => thread.thread_id));
      let changed = false;
      const next: Record<string, string> = {};
      for (const [existingThreadId, statusKey] of Object.entries(previous)) {
        if (threadIds.has(existingThreadId)) {
          next[existingThreadId] = statusKey;
          continue;
        }
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [threads]);

  useEffect(() => {
    if (!editingThreadId) return;
    const stillExists = threads.some(
      (thread) => thread.thread_id === editingThreadId,
    );
    if (!stillExists) {
      resetRename();
    }
  }, [editingThreadId, threads, resetRename]);

  return (
    <>
      <div className="shadow-inner-right border-border hidden h-screen w-full shrink-0 flex-col items-start justify-start gap-6 border-r-[1px] lg:flex">
        <div className="flex w-full items-center justify-between px-4 pt-1.5">
          <h1 className="text-left text-xl font-semibold tracking-tight">
            Chat History
          </h1>
          <div className="flex items-center gap-1">
            <Button
              className="text-muted-foreground hover:text-accent-foreground hover:bg-accent h-8 gap-1.5 px-2"
              variant="ghost"
              size="sm"
              onClick={handleNewThread}
            >
              <SquarePen className="size-4" />
              <span>New</span>
            </Button>
            <Button
              className="hover:bg-accent"
              variant="ghost"
              onClick={() => setChatHistoryOpen((p) => !p)}
            >
              {chatHistoryOpen ? (
                <PanelRightOpen className="size-5" />
              ) : (
                <PanelRightClose className="size-5" />
              )}
            </Button>
          </div>
        </div>
        {historyDisabled ? (
          <div className="text-muted-foreground px-4 text-sm">
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
            seenAttentionStatusByThreadId={seenAttentionStatusByThreadId}
            markSeen={markSeen}
            markAttentionStatusSeen={markAttentionStatusSeen}
            hasMore={threadsHasMore}
            isLoadingMore={threadsLoadingMore}
            onLoadMore={loadMoreThreads}
            editingThreadId={editingThreadId}
            renameDraft={renameDraft}
            renameSaving={renameSaving}
            onRenameDraftChange={setRenameDraft}
            onRenameStart={startRenameThread}
            onRenameCancel={resetRename}
            onRenameSubmit={submitRenameThread}
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
            <SheetHeader className="space-y-0">
              <div className="flex items-center justify-between">
                <SheetTitle>Chat History</SheetTitle>
                <Button
                  className="text-muted-foreground hover:text-accent-foreground hover:bg-accent h-8 gap-1.5 px-2"
                  variant="ghost"
                  size="sm"
                  onClick={handleNewThread}
                >
                  <SquarePen className="size-4" />
                  <span>New</span>
                </Button>
              </div>
            </SheetHeader>
            {historyDisabled ? (
              <div className="text-muted-foreground px-1 text-sm">
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
                seenAttentionStatusByThreadId={seenAttentionStatusByThreadId}
                markSeen={markSeen}
                markAttentionStatusSeen={markAttentionStatusSeen}
                onThreadClick={() => setChatHistoryOpen((o) => !o)}
                hasMore={threadsHasMore}
                isLoadingMore={threadsLoadingMore}
                onLoadMore={loadMoreThreads}
                editingThreadId={editingThreadId}
                renameDraft={renameDraft}
                renameSaving={renameSaving}
                onRenameDraftChange={setRenameDraft}
                onRenameStart={startRenameThread}
                onRenameCancel={resetRename}
                onRenameSubmit={submitRenameThread}
              />
            )}
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
