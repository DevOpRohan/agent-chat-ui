import { v4 as uuidv4 } from "uuid";
import {
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DEFAULT_AGENT_RECURSION_LIMIT } from "@/lib/constants";
import { useStreamContext } from "@/providers/Stream";
import { Button } from "../ui/button";
import { Checkpoint, Message } from "@langchain/langgraph-sdk";
import { AssistantMessage, AssistantMessageLoading } from "./messages/ai";
import { HumanMessage } from "./messages/human";
import {
  DO_NOT_RENDER_ID_PREFIX,
  ensureToolCallsHaveResponses,
} from "@/lib/ensure-tool-responses";
import { QuestionCrafterLogoSVG } from "../icons/question-crafter";
import {
  ArrowDown,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  PanelRightClose,
  XIcon,
  Plus,
} from "lucide-react";
import { useQueryState, parseAsBoolean } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ContentBlocksPreview } from "./ContentBlocksPreview";
import { getOrCreateThreadTabId, markThreadSeen } from "@/lib/thread-activity";
import { useThreadBusy } from "@/hooks/use-thread-busy";
import { useStableStreamMessages } from "@/hooks/use-stable-stream-messages";
import { useStreamAutoReconnect } from "@/hooks/use-stream-auto-reconnect";
import {
  useArtifactOpen,
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
  useArtifactSurfaceMode,
} from "./artifact";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useTheme } from "next-themes";
import {
  classifyStreamError,
  getStreamErrorDetails,
} from "@/lib/stream-error-classifier";

function showThreadRunningToast() {
  toast("Thread is still running", {
    description: "Working on your query and will respond after completion.",
    closeButton: true,
  });
}

function buildThreadPreview(input: string, attachmentCount: number): string {
  const normalizedInput = input.trim().replace(/\s+/g, " ");
  if (normalizedInput) {
    const maxPreviewLength = 140;
    if (normalizedInput.length <= maxPreviewLength) {
      return normalizedInput;
    }
    return `${normalizedInput.slice(0, maxPreviewLength - 3)}...`;
  }

  if (attachmentCount > 0) {
    return attachmentCount === 1
      ? "1 attachment"
      : `${attachmentCount} attachments`;
  }

  return "New thread";
}

function isThreadActiveStatus(
  status: string | null | undefined,
): status is "busy" {
  return status === "busy";
}

function readStoredRunId(threadId: string | null): string | null {
  if (!threadId || typeof window === "undefined") return null;
  try {
    const runId = window.sessionStorage.getItem(`lg:stream:${threadId}`);
    if (!runId) return null;
    const normalized = runId.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

const DEFAULT_HISTORY_WIDTH_PX = 300;
const HISTORY_MIN_WIDTH_PX = 220;
const HISTORY_MAX_WIDTH_PX = 480;
const DEFAULT_ARTIFACT_RATIO = 0.38;
const DEFAULT_ARTIFACT_FALLBACK_WIDTH_PX = 360;
const ARTIFACT_MIN_WIDTH_PX = 320;
const ARTIFACT_MAX_RATIO = 0.62;
const CHAT_MIN_WIDTH_PX = 360;
const RESIZE_STEP_PX = 24;
const RESIZE_HANDLE_WIDTH_PX = 10;

type PaneDragState =
  | { type: "none" }
  | { type: "history"; startX: number; startHistory: number }
  | { type: "artifact"; startX: number; startArtifact: number };

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  if (max <= min) return min;
  return Math.min(max, Math.max(min, value));
}

function toBounds(min: number, max: number) {
  const safeMax = Math.max(0, max);
  const safeMin = Math.min(Math.max(0, min), safeMax);
  return { min: safeMin, max: safeMax };
}

function getHistoryBounds(
  viewportWidth: number,
  artifactWidth: number,
): { min: number; max: number } {
  const maxByChat =
    viewportWidth - CHAT_MIN_WIDTH_PX - Math.max(artifactWidth, 0);
  const max = Math.min(HISTORY_MAX_WIDTH_PX, Math.max(0, maxByChat));
  return toBounds(HISTORY_MIN_WIDTH_PX, max);
}

function getArtifactBounds(
  viewportWidth: number,
  historyWidth: number,
): { min: number; max: number } {
  const mainWidth = Math.max(0, viewportWidth - Math.max(0, historyWidth));
  const maxByChat = Math.max(0, mainWidth - CHAT_MIN_WIDTH_PX);
  const maxByRatio = Math.max(0, Math.floor(mainWidth * ARTIFACT_MAX_RATIO));
  const max = Math.min(maxByChat, maxByRatio);
  return toBounds(ARTIFACT_MIN_WIDTH_PX, max);
}

function getDefaultArtifactWidth(viewportWidth: number, historyWidth: number) {
  const bounds = getArtifactBounds(viewportWidth, historyWidth);
  const baseWidth = Math.floor(
    Math.max(0, viewportWidth - Math.max(0, historyWidth)) *
      DEFAULT_ARTIFACT_RATIO,
  );
  return Math.round(clamp(baseWidth, bounds.min, bounds.max));
}

function normalizePaneWidths(params: {
  viewportWidth: number;
  chatHistoryOpen: boolean;
  artifactOpen: boolean;
  artifactExpanded: boolean;
  historyWidth: number;
  artifactWidth: number;
}) {
  const {
    viewportWidth,
    chatHistoryOpen,
    artifactOpen,
    artifactExpanded,
    historyWidth,
    artifactWidth,
  } = params;
  const safeViewportWidth = Math.max(0, viewportWidth);
  let nextHistory = Math.max(0, historyWidth);
  let nextArtifact = Math.max(0, artifactWidth);
  let activeHistory = chatHistoryOpen ? nextHistory : 0;
  let activeArtifact = artifactOpen && !artifactExpanded ? nextArtifact : 0;

  if (chatHistoryOpen) {
    const historyBounds = getHistoryBounds(safeViewportWidth, activeArtifact);
    activeHistory = clamp(activeHistory, historyBounds.min, historyBounds.max);
  } else {
    nextHistory = clamp(
      nextHistory,
      HISTORY_MIN_WIDTH_PX,
      HISTORY_MAX_WIDTH_PX,
    );
  }

  if (artifactOpen && !artifactExpanded) {
    const artifactBounds = getArtifactBounds(safeViewportWidth, activeHistory);
    activeArtifact = clamp(
      activeArtifact,
      artifactBounds.min,
      artifactBounds.max,
    );
  }

  let chatWidth = safeViewportWidth - activeHistory - activeArtifact;
  if (chatWidth < CHAT_MIN_WIDTH_PX) {
    let overflow = CHAT_MIN_WIDTH_PX - chatWidth;
    if (activeArtifact > 0) {
      const reduceArtifactBy = Math.min(overflow, activeArtifact);
      activeArtifact -= reduceArtifactBy;
      overflow -= reduceArtifactBy;
    }
    if (overflow > 0 && activeHistory > 0) {
      const reduceHistoryBy = Math.min(overflow, activeHistory);
      activeHistory -= reduceHistoryBy;
    }
    chatWidth = safeViewportWidth - activeHistory - activeArtifact;
    if (chatWidth < CHAT_MIN_WIDTH_PX) {
      activeHistory = Math.max(
        0,
        activeHistory - (CHAT_MIN_WIDTH_PX - chatWidth),
      );
    }
  }

  if (chatHistoryOpen) {
    nextHistory = activeHistory;
  }
  if (artifactOpen && !artifactExpanded) {
    nextArtifact = activeArtifact;
  }

  nextHistory = Math.round(Math.max(0, nextHistory));
  nextArtifact = Math.round(Math.max(0, nextArtifact));

  return {
    historyWidth: nextHistory,
    artifactWidth: nextArtifact,
  };
}

function StickyToBottomContent(props: {
  content: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      data-testid="chat-scroll-container"
      style={{ width: "100%", height: "100%" }}
      className={props.className}
    >
      <div
        ref={context.contentRef}
        className={props.contentClassName}
      >
        {props.content}
      </div>

      {props.footer}
    </div>
  );
}

function ScrollToBottom(props: { className?: string }) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      className={props.className}
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      <span>Scroll to bottom</span>
    </Button>
  );
}

export function Thread() {
  const { resolvedTheme } = useTheme();
  const [artifactContext, setArtifactContext] = useArtifactContext();
  const artifactSurfaceMode = useArtifactSurfaceMode();
  const [artifactOpen, closeArtifact] = useArtifactOpen();
  const [manualArtifactOpen, setManualArtifactOpen] = useState(false);

  const [threadId, _setThreadId] = useQueryState("threadId");
  const [chatHistoryOpen, setChatHistoryOpen] = useQueryState(
    "chatHistoryOpen",
    parseAsBoolean.withDefault(false),
  );
  const [input, setInput] = useState("");
  const {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    resetBlocks: _resetBlocks,
    dragOver,
    handlePaste,
    isUploading,
  } = useFileUpload();
  const [firstTokenReceived, setFirstTokenReceived] = useState(false);
  const isLargeScreen = useMediaQuery("(min-width: 1024px)");

  const stream = useStreamContext();
  const messages = stream.messages;
  const displayMessages = useStableStreamMessages({
    messages,
    threadId,
    branch: stream.branch,
  });
  const isLoading = stream.isLoading;
  const { busyByThreadId, busyOwnerByThreadId, markBusy } = useThreadBusy();
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<string | null>(null);
  const [ownedBusyThreadId, setOwnedBusyThreadId] = useState<string | null>(
    null,
  );
  const isCurrentThreadLoading =
    !!threadId &&
    isLoading &&
    (loadingThreadId === null || loadingThreadId === threadId);
  const tabId = getOrCreateThreadTabId();
  const isThreadBusyInAnyTab = !!threadId && !!busyByThreadId[threadId];
  const isThreadActiveOnServer = isThreadActiveStatus(threadStatus);
  const currentThreadBusyOwnerId = threadId
    ? busyOwnerByThreadId[threadId]
    : undefined;
  const isCurrentThreadOwnedByTab =
    !!threadId &&
    (ownedBusyThreadId === threadId ||
      currentThreadBusyOwnerId === tabId ||
      loadingThreadId === threadId);
  const isBusyElsewhereFromLocalSignal =
    isThreadBusyInAnyTab &&
    !isCurrentThreadLoading &&
    (currentThreadBusyOwnerId == null || currentThreadBusyOwnerId !== tabId);
  const isBusyElsewhereFromServerSignal =
    !isLoading &&
    !isThreadBusyInAnyTab &&
    !isCurrentThreadOwnedByTab &&
    !isCurrentThreadLoading &&
    isThreadActiveOnServer;
  const isCurrentThreadBusyElsewhere =
    isBusyElsewhereFromLocalSignal || isBusyElsewhereFromServerSignal;
  const shouldShowRunningQueryMessage = isCurrentThreadBusyElsewhere;
  const {
    isReconnecting,
    statusText: reconnectStatusText,
    activeRunId,
    stopReconnect,
  } = useStreamAutoReconnect({
    stream,
    threadId,
    threadStatus,
    isCurrentThreadBusyElsewhere,
    isCurrentThreadOwnedByTab,
  });
  const effectiveIsLoading = isCurrentThreadLoading || isReconnecting;

  const lastError = useRef<string | undefined>(undefined);
  const previouslyObservedBusyThreadId = useRef<string | null>(null);
  const pendingNewThreadOwnership = useRef<{
    pending: boolean;
    startedAtMs: number;
  }>({
    pending: false,
    startedAtMs: 0,
  });
  const [runningDotsCount, setRunningDotsCount] = useState(1);
  const [viewportWidthPx, setViewportWidthPx] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
  const [historyWidthPx, setHistoryWidthPx] = useState(
    DEFAULT_HISTORY_WIDTH_PX,
  );
  const [artifactWidthPx, setArtifactWidthPx] = useState(
    DEFAULT_ARTIFACT_FALLBACK_WIDTH_PX,
  );
  const [artifactExpanded, setArtifactExpanded] = useState(false);
  const [paneDragState, setPaneDragState] = useState<PaneDragState>({
    type: "none",
  });
  const preExpandLayoutRef = useRef<{
    historyOpen: boolean;
    historyWidth: number;
    artifactWidth: number;
  } | null>(null);
  const artifactWidthInitializedRef = useRef(false);
  const artifactPaneOpen = artifactOpen || manualArtifactOpen;
  const isIframeArtifactSurface = artifactSurfaceMode === "iframe";
  const isArtifactExpandedMode =
    isLargeScreen && artifactPaneOpen && artifactExpanded;
  const showDesktopHistoryPane =
    isLargeScreen && chatHistoryOpen && !isArtifactExpandedMode;
  const showDesktopArtifactHandle =
    isLargeScreen && artifactPaneOpen && !isArtifactExpandedMode;
  const showDesktopHistoryHandle = showDesktopHistoryPane;
  const isPaneDragActive = paneDragState.type !== "none";

  const claimThreadOwnership = useCallback(
    (targetThreadId: string) => {
      setLoadingThreadId(targetThreadId);
      setOwnedBusyThreadId(targetThreadId);
      markBusy(targetThreadId, true, tabId ?? undefined);
    },
    [markBusy, tabId],
  );
  const restoreLayoutFromExpand = useCallback(() => {
    const preExpandLayout = preExpandLayoutRef.current;
    if (!preExpandLayout) return;
    setHistoryWidthPx(preExpandLayout.historyWidth);
    setArtifactWidthPx(preExpandLayout.artifactWidth);
    setChatHistoryOpen(preExpandLayout.historyOpen);
    preExpandLayoutRef.current = null;
  }, [setChatHistoryOpen]);

  const handleArtifactClose = useCallback(() => {
    setPaneDragState({ type: "none" });
    setManualArtifactOpen(false);
    if (isArtifactExpandedMode) {
      restoreLayoutFromExpand();
    }
    setArtifactExpanded(false);
    closeArtifact();
  }, [closeArtifact, isArtifactExpandedMode, restoreLayoutFromExpand]);

  const setThreadId = useCallback(
    (id: string | null) => {
      _setThreadId(id);

      // close artifact and reset artifact context
      handleArtifactClose();
      setArtifactContext({});
    },
    [_setThreadId, handleArtifactClose, setArtifactContext],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewportWidth = () => {
      setViewportWidthPx(window.innerWidth);
    };
    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    return () => {
      window.removeEventListener("resize", syncViewportWidth);
    };
  }, []);

  useEffect(() => {
    if (!isLargeScreen) {
      setArtifactExpanded(false);
      preExpandLayoutRef.current = null;
      setPaneDragState({ type: "none" });
      return;
    }

    if (!artifactPaneOpen) {
      setArtifactExpanded(false);
      preExpandLayoutRef.current = null;
      setPaneDragState({ type: "none" });
    }
  }, [artifactPaneOpen, isLargeScreen]);

  useEffect(() => {
    if (!isLargeScreen) return;
    if (artifactWidthInitializedRef.current) return;
    const historyForDefault = chatHistoryOpen ? historyWidthPx : 0;
    setArtifactWidthPx(
      getDefaultArtifactWidth(viewportWidthPx, historyForDefault),
    );
    artifactWidthInitializedRef.current = true;
  }, [chatHistoryOpen, historyWidthPx, isLargeScreen, viewportWidthPx]);

  useEffect(() => {
    if (!isLargeScreen) return;
    const normalized = normalizePaneWidths({
      viewportWidth: viewportWidthPx,
      chatHistoryOpen,
      artifactOpen: artifactPaneOpen,
      artifactExpanded,
      historyWidth: historyWidthPx,
      artifactWidth: artifactWidthPx,
    });
    if (normalized.historyWidth !== historyWidthPx) {
      setHistoryWidthPx(normalized.historyWidth);
    }
    if (normalized.artifactWidth !== artifactWidthPx) {
      setArtifactWidthPx(normalized.artifactWidth);
    }
  }, [
    artifactExpanded,
    artifactPaneOpen,
    artifactWidthPx,
    chatHistoryOpen,
    historyWidthPx,
    isLargeScreen,
    viewportWidthPx,
  ]);

  useEffect(() => {
    if (!isPaneDragActive || typeof document === "undefined") return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [isPaneDragActive]);

  useEffect(() => {
    if (!isLargeScreen || paneDragState.type === "none") return;

    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (paneDragState.type === "history") {
        const artifactWidthForBounds =
          artifactPaneOpen && !isArtifactExpandedMode ? artifactWidthPx : 0;
        const bounds = getHistoryBounds(
          viewportWidthPx,
          artifactWidthForBounds,
        );
        const deltaX = event.clientX - paneDragState.startX;
        const nextHistory = clamp(
          paneDragState.startHistory + deltaX,
          bounds.min,
          bounds.max,
        );
        setHistoryWidthPx(Math.round(nextHistory));
        return;
      }

      const historyWidthForBounds = showDesktopHistoryPane ? historyWidthPx : 0;
      const bounds = getArtifactBounds(viewportWidthPx, historyWidthForBounds);
      const deltaX = event.clientX - paneDragState.startX;
      const nextArtifact = clamp(
        paneDragState.startArtifact - deltaX,
        bounds.min,
        bounds.max,
      );
      setArtifactWidthPx(Math.round(nextArtifact));
    };

    const stopDragging = () => setPaneDragState({ type: "none" });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [
    artifactPaneOpen,
    artifactWidthPx,
    historyWidthPx,
    isArtifactExpandedMode,
    isLargeScreen,
    paneDragState,
    showDesktopHistoryPane,
    viewportWidthPx,
  ]);

  useEffect(() => {
    if (
      pendingNewThreadOwnership.current.pending &&
      !threadId &&
      !isLoading &&
      Date.now() - pendingNewThreadOwnership.current.startedAtMs > 60_000
    ) {
      pendingNewThreadOwnership.current.pending = false;
      pendingNewThreadOwnership.current.startedAtMs = 0;
    }
  }, [threadId, isLoading]);

  useEffect(() => {
    if (!threadId) return;
    if (!pendingNewThreadOwnership.current.pending) return;

    claimThreadOwnership(threadId);
    pendingNewThreadOwnership.current.pending = false;
    pendingNewThreadOwnership.current.startedAtMs = 0;
  }, [threadId, claimThreadOwnership]);

  useEffect(() => {
    if (!threadId) {
      setThreadStatus(null);
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollThreadStatus = async () => {
      try {
        const currentThread = await stream.client.threads.get(threadId);
        if (cancelled) return;
        setThreadStatus((prev) =>
          prev === currentThread.status ? prev : currentThread.status,
        );
        const shouldPollFast =
          isThreadActiveStatus(currentThread.status) ||
          effectiveIsLoading ||
          isThreadBusyInAnyTab;
        timeoutId = window.setTimeout(
          pollThreadStatus,
          shouldPollFast ? 2500 : 15000,
        );
      } catch {
        if (cancelled) return;
        timeoutId = window.setTimeout(pollThreadStatus, 5000);
      }
    };

    void pollThreadStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    threadId,
    stream.client,
    effectiveIsLoading,
    isThreadBusyInAnyTab,
    isCurrentThreadOwnedByTab,
  ]);

  useEffect(() => {
    if (!threadId) {
      previouslyObservedBusyThreadId.current = null;
      return;
    }

    if (
      previouslyObservedBusyThreadId.current &&
      previouslyObservedBusyThreadId.current !== threadId
    ) {
      previouslyObservedBusyThreadId.current = null;
    }

    if (isCurrentThreadBusyElsewhere) {
      previouslyObservedBusyThreadId.current = threadId;
      return;
    }

    if (
      previouslyObservedBusyThreadId.current === threadId &&
      !effectiveIsLoading &&
      threadStatus !== null &&
      !isThreadActiveStatus(threadStatus)
    ) {
      previouslyObservedBusyThreadId.current = null;
    }
  }, [
    threadId,
    isCurrentThreadBusyElsewhere,
    threadStatus,
    effectiveIsLoading,
  ]);

  useEffect(() => {
    if (!shouldShowRunningQueryMessage) {
      setRunningDotsCount(1);
      return;
    }

    const intervalId = window.setInterval(() => {
      setRunningDotsCount((prev) => (prev % 3) + 1);
    }, 350);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldShowRunningQueryMessage]);

  useEffect(() => {
    if (!effectiveIsLoading) {
      if (loadingThreadId) {
        if (loadingThreadId !== threadId) {
          setLoadingThreadId(null);
          return;
        }

        if (
          loadingThreadId === threadId &&
          threadStatus !== null &&
          isThreadActiveStatus(threadStatus)
        ) {
          return;
        }

        markBusy(loadingThreadId, false);
        setLoadingThreadId(null);
      }
      return;
    }

    if (!loadingThreadId && threadId && effectiveIsLoading) {
      const ownerTabId = busyOwnerByThreadId[threadId];
      if (!ownerTabId || ownerTabId === tabId) {
        setLoadingThreadId(threadId);
        setOwnedBusyThreadId(threadId);
        markBusy(threadId, true, tabId ?? undefined);
      }
    }
  }, [
    effectiveIsLoading,
    loadingThreadId,
    markBusy,
    threadId,
    threadStatus,
    busyOwnerByThreadId,
    tabId,
  ]);

  useEffect(() => {
    if (!threadId || !effectiveIsLoading) return;
    if (ownedBusyThreadId === threadId) return;

    const ownerTabId = busyOwnerByThreadId[threadId];
    if (ownerTabId === tabId || loadingThreadId === threadId) {
      setOwnedBusyThreadId(threadId);
    }
  }, [
    threadId,
    effectiveIsLoading,
    ownedBusyThreadId,
    busyOwnerByThreadId,
    tabId,
    loadingThreadId,
  ]);

  useEffect(() => {
    if (!threadId) return;
    if (!busyByThreadId[threadId]) return;
    if (effectiveIsLoading) return;
    if (threadStatus === null || threadStatus === "busy") return;

    markBusy(threadId, false);
    setLoadingThreadId((prev) => (prev === threadId ? null : prev));
    setOwnedBusyThreadId((prev) => (prev === threadId ? null : prev));
  }, [threadId, busyByThreadId, effectiveIsLoading, threadStatus, markBusy]);

  useEffect(() => {
    if (
      threadId &&
      ownedBusyThreadId === threadId &&
      !effectiveIsLoading &&
      threadStatus !== null &&
      !isThreadActiveStatus(threadStatus)
    ) {
      setOwnedBusyThreadId(null);
    }
  }, [threadId, ownedBusyThreadId, effectiveIsLoading, threadStatus]);

  useEffect(() => {
    if (!ownedBusyThreadId) return;
    if (busyByThreadId[ownedBusyThreadId]) return;
    setOwnedBusyThreadId((prev) => (prev === ownedBusyThreadId ? null : prev));
  }, [ownedBusyThreadId, busyByThreadId]);

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const { name, message } = getStreamErrorDetails(stream.error);
      const errorKey = `${threadId ?? "no-thread"}::${name ?? ""}::${message ?? ""}`;
      if (lastError.current === errorKey) {
        return;
      }
      lastError.current = errorKey;

      const classification = classifyStreamError(stream.error, {
        hasInterrupt: !!stream.interrupt,
      });

      if (classification === "benign_react_185") {
        console.warn(
          "Ignoring benign React #185 stream error",
          message ?? name ?? stream.error,
        );
        return;
      }

      if (classification === "expected_interrupt_or_breakpoint") {
        console.info("Ignoring expected interrupt/breakpoint stream error", {
          name,
          message,
        });
        return;
      }

      if (classification === "conflict") {
        toast("Thread already has an active run", {
          description:
            "Your message was not sent. Please retry after the current run completes.",
          closeButton: true,
        });
        return;
      }

      if (classification === "recoverable_disconnect") {
        console.info("Recoverable disconnect detected; reconnecting stream", {
          name,
          message,
          threadId,
        });
        return;
      }

      const detailMessage = message ?? name ?? "Unknown stream error";
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{detailMessage}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error, stream.interrupt, threadId]);

  // TODO: this should be part of the useStream hook
  const prevMessageLength = useRef(0);
  useEffect(() => {
    if (
      messages.length !== prevMessageLength.current &&
      messages?.length &&
      messages[messages.length - 1].type === "ai"
    ) {
      setFirstTokenReceived(true);
    }

    if (threadId && messages.length !== prevMessageLength.current) {
      markThreadSeen(threadId, Date.now());
    }

    prevMessageLength.current = messages.length;
  }, [messages, threadId]);

  useEffect(() => {
    if (!threadId) return;
    markThreadSeen(threadId, Date.now());
  }, [threadId]);

  const shouldBlockWhileCurrentThreadBusy = async (
    source: "submit" | "regenerate",
  ): Promise<boolean> => {
    if (isCurrentThreadBusyElsewhere) {
      showThreadRunningToast();
      return true;
    }

    if (effectiveIsLoading) {
      showThreadRunningToast();
      return true;
    }

    if (!threadId) return false;

    try {
      const currentThread = await stream.client.threads.get(threadId);
      if (isThreadActiveStatus(currentThread.status)) {
        showThreadRunningToast();
        return true;
      }
    } catch (error) {
      console.error(
        `Failed to preflight thread status before ${source}`,
        error,
      );
    }

    return false;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (input.trim().length === 0 && contentBlocks.length === 0) return;
    if (await shouldBlockWhileCurrentThreadBusy("submit")) {
      return;
    }

    const threadPreview = buildThreadPreview(input, contentBlocks.length);
    setFirstTokenReceived(false);

    const attachmentLines = contentBlocks
      .map((b, i) => {
        const name =
          b.type === "image"
            ? String(b.metadata?.name)
            : String(b.metadata?.filename);
        const preferredUrl =
          (b as any).url ||
          (b.metadata as any)?.httpsUrl ||
          (b.metadata as any)?.publicUrl ||
          (b.metadata as any)?.gsUrl ||
          (b.metadata as any)?.gcsUrl ||
          "";
        const url = String(preferredUrl);
        return `${i + 1}. FILE_NAME="${name}", FILE_URL="${url}", MIME_TYPE="${b.mime_type}"`;
      })
      .join("\n");

    const metadataText =
      attachmentLines.length > 0
        ? `ATTACHMENTS_INFO:\n${attachmentLines}`
        : undefined;

    const newHumanMessage: Message = {
      id: uuidv4(),
      type: "human",
      content: [
        ...(input.trim().length > 0 ? [{ type: "text", text: input }] : []),
        ...contentBlocks,
        ...(metadataText ? [{ type: "text", text: metadataText }] : []),
      ] as Message["content"],
    };

    const toolMessages = ensureToolCallsHaveResponses(stream.messages);

    const context =
      Object.keys(artifactContext).length > 0 ? artifactContext : undefined;
    const submitMetadata = !threadId
      ? { thread_preview: threadPreview }
      : undefined;

    if (threadId) {
      claimThreadOwnership(threadId);
    } else {
      pendingNewThreadOwnership.current.pending = true;
      pendingNewThreadOwnership.current.startedAtMs = Date.now();
    }

    void stream.submit(
      { messages: [...toolMessages, newHumanMessage], context },
      {
        config: {
          recursion_limit: DEFAULT_AGENT_RECURSION_LIMIT,
        },
        metadata: submitMetadata,
        multitaskStrategy: "reject",
        onDisconnect: "continue",
        streamMode: ["values"],
        streamSubgraphs: true,
        streamResumable: true,
        optimisticValues: (prev) => ({
          ...prev,
          context,
          messages: [
            ...(prev.messages ?? []),
            ...toolMessages,
            newHumanMessage,
          ],
        }),
      },
    );

    setInput("");
    setContentBlocks([]);
  };

  const handleRegenerate = async (
    parentCheckpoint: Checkpoint | null | undefined,
  ) => {
    if (await shouldBlockWhileCurrentThreadBusy("regenerate")) {
      return;
    }

    // Do this so the loading state is correct
    prevMessageLength.current = prevMessageLength.current - 1;
    setFirstTokenReceived(false);
    if (threadId) {
      claimThreadOwnership(threadId);
    } else {
      pendingNewThreadOwnership.current.pending = true;
      pendingNewThreadOwnership.current.startedAtMs = Date.now();
    }
    void stream.submit(undefined, {
      config: {
        recursion_limit: DEFAULT_AGENT_RECURSION_LIMIT,
      },
      checkpoint: parentCheckpoint,
      multitaskStrategy: "reject",
      onDisconnect: "continue",
      streamMode: ["values"],
      streamSubgraphs: true,
      streamResumable: true,
    });
  };

  const handleCancel = async () => {
    const activeThreadId = threadId;
    const runIdForCancel = activeRunId ?? readStoredRunId(activeThreadId);

    try {
      await stream.stop();
    } catch (error) {
      console.error("Failed to stop active stream", error);
    }

    if (activeThreadId && runIdForCancel) {
      try {
        await stream.client.runs.cancel(activeThreadId, runIdForCancel);
      } catch (error) {
        console.warn("Best-effort backend cancel failed", error);
      }
    }

    stopReconnect();
    pendingNewThreadOwnership.current.pending = false;
    pendingNewThreadOwnership.current.startedAtMs = 0;

    if (activeThreadId) {
      markBusy(activeThreadId, false);
      setLoadingThreadId((prev) => (prev === activeThreadId ? null : prev));
      setOwnedBusyThreadId((prev) => (prev === activeThreadId ? null : prev));
    }
  };

  const handleHistoryResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !showDesktopHistoryHandle) return;
      event.preventDefault();
      setPaneDragState({
        type: "history",
        startX: event.clientX,
        startHistory: historyWidthPx,
      });
    },
    [historyWidthPx, isLargeScreen, showDesktopHistoryHandle],
  );

  const handleArtifactResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !showDesktopArtifactHandle) return;
      event.preventDefault();
      setPaneDragState({
        type: "artifact",
        startX: event.clientX,
        startArtifact: artifactWidthPx,
      });
    },
    [artifactWidthPx, isLargeScreen, showDesktopArtifactHandle],
  );

  const handleHistoryResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !showDesktopHistoryHandle) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const artifactWidthForBounds =
        artifactPaneOpen && !isArtifactExpandedMode ? artifactWidthPx : 0;
      const bounds = getHistoryBounds(viewportWidthPx, artifactWidthForBounds);
      const delta =
        event.key === "ArrowRight" ? RESIZE_STEP_PX : -RESIZE_STEP_PX;
      const nextHistory = clamp(historyWidthPx + delta, bounds.min, bounds.max);
      setHistoryWidthPx(Math.round(nextHistory));
    },
    [
      artifactPaneOpen,
      artifactWidthPx,
      historyWidthPx,
      isArtifactExpandedMode,
      isLargeScreen,
      showDesktopHistoryHandle,
      viewportWidthPx,
    ],
  );

  const handleArtifactResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !showDesktopArtifactHandle) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const historyWidthForBounds = showDesktopHistoryPane ? historyWidthPx : 0;
      const bounds = getArtifactBounds(viewportWidthPx, historyWidthForBounds);
      const delta =
        event.key === "ArrowLeft" ? RESIZE_STEP_PX : -RESIZE_STEP_PX;
      const nextArtifact = clamp(
        artifactWidthPx + delta,
        bounds.min,
        bounds.max,
      );
      setArtifactWidthPx(Math.round(nextArtifact));
    },
    [
      artifactWidthPx,
      historyWidthPx,
      isLargeScreen,
      showDesktopArtifactHandle,
      showDesktopHistoryPane,
      viewportWidthPx,
    ],
  );

  const toggleArtifactExpanded = useCallback(() => {
    if (!isLargeScreen || !artifactPaneOpen) return;

    if (!artifactExpanded) {
      preExpandLayoutRef.current = {
        historyOpen: chatHistoryOpen,
        historyWidth: historyWidthPx,
        artifactWidth: artifactWidthPx,
      };
      setPaneDragState({ type: "none" });
      setArtifactExpanded(true);
      if (chatHistoryOpen) {
        setChatHistoryOpen(false);
      }
      return;
    }

    restoreLayoutFromExpand();
    setArtifactExpanded(false);
  }, [
    artifactExpanded,
    artifactPaneOpen,
    artifactWidthPx,
    chatHistoryOpen,
    historyWidthPx,
    isLargeScreen,
    restoreLayoutFromExpand,
    setChatHistoryOpen,
  ]);

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !displayMessages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const logoVariant = resolvedTheme === "dark" ? "dark" : "light";
  const desktopHistoryWidth = showDesktopHistoryPane ? historyWidthPx : 0;
  const desktopMainGridTemplate = isLargeScreen
    ? isArtifactExpandedMode
      ? "0px 0px minmax(0,1fr)"
      : artifactPaneOpen
        ? `minmax(0,1fr) ${RESIZE_HANDLE_WIDTH_PX}px ${artifactWidthPx}px`
        : "minmax(0,1fr) 0px 0px"
    : undefined;
  const mobileMainGridClasses = cn(
    "grid-cols-[1fr_0fr] transition-all duration-500",
    artifactPaneOpen && "grid-cols-[3fr_2fr]",
  );

  return (
    <div
      className={cn(
        "flex h-screen w-full overflow-hidden",
        isPaneDragActive && "cursor-col-resize",
      )}
    >
      <div
        data-testid="pane-history"
        className="relative hidden shrink-0 overflow-hidden border-r lg:flex"
        style={{
          width: desktopHistoryWidth,
          transition: isPaneDragActive ? "none" : "width 200ms ease",
        }}
      >
        <div className="relative h-full w-full min-w-0">
          <ThreadHistory />
        </div>
      </div>

      <div
        data-testid="resize-handle-history-chat"
        className={cn(
          "group relative hidden touch-none items-stretch justify-center select-none lg:flex",
          showDesktopHistoryHandle
            ? "cursor-col-resize"
            : "pointer-events-none opacity-0",
        )}
        style={{ width: showDesktopHistoryHandle ? RESIZE_HANDLE_WIDTH_PX : 0 }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize history and chat panes"
        aria-hidden={showDesktopHistoryHandle ? undefined : "true"}
        tabIndex={showDesktopHistoryHandle ? 0 : -1}
        onPointerDown={handleHistoryResizePointerDown}
        onKeyDown={handleHistoryResizeKeyDown}
      >
        <span
          className={cn(
            "bg-border pointer-events-none my-auto h-20 w-px rounded-full transition-colors",
            paneDragState.type === "history"
              ? "bg-primary"
              : "group-hover:bg-foreground/40",
          )}
        />
      </div>

      <button
        type="button"
        data-testid="open-artifact-panel-test-control"
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 h-px w-px opacity-0"
        onClick={() => setManualArtifactOpen(true)}
      >
        Open artifact panel
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "grid h-full w-full",
            !isLargeScreen && mobileMainGridClasses,
          )}
          style={
            isLargeScreen
              ? { gridTemplateColumns: desktopMainGridTemplate }
              : undefined
          }
        >
          <div
            data-testid="pane-chat"
            className={cn(
              "relative flex min-w-0 flex-col overflow-hidden",
              !chatStarted && "grid-rows-[1fr]",
              isArtifactExpandedMode && "pointer-events-none opacity-0",
            )}
            aria-hidden={isArtifactExpandedMode ? "true" : undefined}
          >
            {!chatStarted && (
              <div className="absolute top-0 left-0 z-10 flex w-full items-center justify-between gap-3 p-2 pl-4">
                <div>
                  {(!chatHistoryOpen || !isLargeScreen) && (
                    <Button
                      data-testid="chat-history-toggle"
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
                  )}
                </div>
                <ThemeToggle />
              </div>
            )}
            {chatStarted && (
              <div className="relative z-10 flex items-center gap-3 p-2">
                <div className="relative flex items-center justify-start gap-2">
                  <div className="absolute left-0 z-10">
                    {(!chatHistoryOpen || !isLargeScreen) && (
                      <Button
                        data-testid="chat-history-toggle"
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
                    )}
                  </div>
                  <motion.button
                    className="flex cursor-pointer items-center gap-2"
                    onClick={() => setThreadId(null)}
                    animate={{
                      marginLeft: !chatHistoryOpen ? 48 : 0,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                  >
                    <QuestionCrafterLogoSVG
                      width={40}
                      height={40}
                      variant={logoVariant}
                    />
                    <span className="text-xl font-semibold tracking-tight">
                      Question Crafter
                    </span>
                  </motion.button>
                </div>
                <div className="ml-auto">
                  <ThemeToggle />
                </div>

                <div className="from-background to-background/0 absolute inset-x-0 top-full h-5 bg-gradient-to-b" />
              </div>
            )}

            <StickToBottom className="relative flex-1 overflow-hidden">
              <StickyToBottomContent
                className={cn(
                  "[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50 absolute inset-0 overflow-x-hidden overflow-y-scroll px-4 [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                  !chatStarted && "mt-[25vh] flex flex-col items-stretch",
                  chatStarted && "grid grid-rows-[1fr_auto]",
                )}
                contentClassName="pt-8 pb-16 max-w-3xl min-w-0 mx-auto flex w-full flex-col gap-4"
                content={
                  <>
                    {displayMessages
                      .filter((m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
                      .map((message, index) =>
                        message.type === "human" ? (
                          <HumanMessage
                            key={message.id || `${message.type}-${index}`}
                            message={message}
                            isLoading={effectiveIsLoading}
                          />
                        ) : (
                          <AssistantMessage
                            key={message.id || `${message.type}-${index}`}
                            message={message}
                            allMessages={displayMessages}
                            isLoading={effectiveIsLoading}
                            isReconnecting={isReconnecting}
                            handleRegenerate={handleRegenerate}
                          />
                        ),
                      )}
                    {/* Special rendering case where there are no AI/tool messages, but there is an interrupt.
                      We need to render it outside of the messages list, since there are no messages to render */}
                    {hasNoAIOrToolMessages && !!stream.interrupt && (
                      <AssistantMessage
                        key="interrupt-msg"
                        message={undefined}
                        allMessages={displayMessages}
                        isLoading={effectiveIsLoading}
                        isReconnecting={isReconnecting}
                        handleRegenerate={handleRegenerate}
                      />
                    )}
                    {effectiveIsLoading && !firstTokenReceived && (
                      <AssistantMessageLoading />
                    )}
                  </>
                }
                footer={
                  <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 flex flex-col items-center gap-8 backdrop-blur">
                    {!chatStarted && (
                      <div className="flex items-center gap-3">
                        <QuestionCrafterLogoSVG
                          className="h-10 flex-shrink-0"
                          variant={logoVariant}
                        />
                        <h1 className="text-2xl font-semibold tracking-tight">
                          Question Crafter
                        </h1>
                      </div>
                    )}

                    <ScrollToBottom className="animate-in fade-in-0 zoom-in-95 absolute bottom-full left-1/2 mb-4 -translate-x-1/2" />

                    {shouldShowRunningQueryMessage ? (
                      <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end px-1">
                        <p
                          className="bg-muted/70 text-muted-foreground inline-flex items-center rounded-full border px-3 py-1 text-xs"
                          aria-live="polite"
                        >
                          Working on your query
                          <span
                            className="ml-1 inline-block w-4 text-left"
                            aria-hidden="true"
                          >
                            {".".repeat(runningDotsCount)}
                          </span>
                        </p>
                      </div>
                    ) : null}
                    {isReconnecting ? (
                      <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end px-1">
                        <p
                          data-testid="stream-reconnect-status"
                          className="bg-muted/70 text-muted-foreground inline-flex items-center rounded-full border px-3 py-1 text-xs"
                          aria-live="polite"
                        >
                          <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                          {reconnectStatusText ?? "Reconnecting stream..."}
                        </p>
                      </div>
                    ) : null}
                    <div
                      ref={dropRef}
                      className={cn(
                        "bg-muted relative z-10 mx-auto mb-8 w-full max-w-3xl rounded-2xl shadow-xs transition-all",
                        dragOver
                          ? "border-primary border-2 border-dotted"
                          : "border border-solid",
                      )}
                    >
                      <form
                        onSubmit={handleSubmit}
                        className="mx-auto grid max-w-3xl grid-rows-[1fr_auto] gap-2"
                      >
                        <ContentBlocksPreview
                          blocks={contentBlocks}
                          onRemove={removeBlock}
                        />
                        <textarea
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onPaste={handlePaste}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.shiftKey &&
                              !e.metaKey &&
                              !e.nativeEvent.isComposing
                            ) {
                              e.preventDefault();
                              const el = e.target as HTMLElement | undefined;
                              const form = el?.closest("form");
                              form?.requestSubmit();
                            }
                          }}
                          placeholder="Type your message..."
                          className="field-sizing-content max-h-[40vh] resize-none overflow-y-auto border-none bg-transparent p-3.5 pb-0 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none"
                        />

                        <div className="flex items-center gap-6 p-2 pt-4">
                          <Label
                            htmlFor="file-input"
                            className={cn(
                              "flex items-center gap-2",
                              isUploading ? "cursor-wait" : "cursor-pointer",
                            )}
                            aria-disabled={isUploading}
                          >
                            <Plus className="text-muted-foreground size-5" />
                            <span className="text-muted-foreground text-sm">
                              Upload PDF or Image
                            </span>
                            {isUploading && (
                              <span className="text-muted-foreground ml-2 flex items-center gap-2 text-sm">
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                                Uploading...
                              </span>
                            )}
                          </Label>
                          <input
                            id="file-input"
                            type="file"
                            onChange={handleFileUpload}
                            multiple
                            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                            className="hidden"
                            disabled={isUploading}
                          />
                          {effectiveIsLoading ? (
                            <Button
                              type="button"
                              key="stop"
                              onClick={() => void handleCancel()}
                              className="ml-auto"
                            >
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              type="submit"
                              className="ml-auto shadow-md transition-all"
                              disabled={
                                effectiveIsLoading ||
                                isCurrentThreadBusyElsewhere ||
                                isUploading ||
                                (!input.trim() && contentBlocks.length === 0)
                              }
                            >
                              Send
                            </Button>
                          )}
                        </div>
                      </form>
                    </div>
                  </div>
                }
              />
            </StickToBottom>
          </div>

          {isLargeScreen ? (
            <div
              data-testid="resize-handle-chat-artifact"
              className={cn(
                "group relative hidden touch-none items-stretch justify-center select-none lg:flex",
                showDesktopArtifactHandle
                  ? "cursor-col-resize"
                  : "pointer-events-none opacity-0",
              )}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat and artifact panes"
              aria-hidden={showDesktopArtifactHandle ? undefined : "true"}
              tabIndex={showDesktopArtifactHandle ? 0 : -1}
              onPointerDown={handleArtifactResizePointerDown}
              onKeyDown={handleArtifactResizeKeyDown}
            >
              <span
                className={cn(
                  "bg-border pointer-events-none my-auto h-20 w-px rounded-full transition-colors",
                  paneDragState.type === "artifact"
                    ? "bg-primary"
                    : "group-hover:bg-foreground/40",
                )}
              />
            </div>
          ) : null}

          <div
            data-testid="pane-artifact"
            className={cn(
              "relative flex min-w-0 flex-col border-l",
              !artifactPaneOpen && "pointer-events-none",
            )}
          >
            <div className="absolute inset-0 flex min-w-0 flex-col overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b p-4">
                <ArtifactTitle className="min-w-0 overflow-hidden" />
                {isLargeScreen ? (
                  <button
                    type="button"
                    data-testid="artifact-expand-toggle"
                    aria-label={
                      isArtifactExpandedMode
                        ? "Restore pane layout"
                        : "Expand artifact panel"
                    }
                    onClick={toggleArtifactExpanded}
                    className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                  >
                    {isArtifactExpandedMode ? (
                      <Minimize2 className="size-5" />
                    ) : (
                      <Maximize2 className="size-5" />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleArtifactClose}
                  className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                >
                  <XIcon className="size-5" />
                </button>
              </div>
              <ArtifactContent
                data-testid="artifact-content"
                className={cn(
                  "relative flex-grow min-h-0",
                  isIframeArtifactSurface
                    ? "overflow-hidden pr-0 [scrollbar-gutter:auto]"
                    : "[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50 overflow-y-scroll pr-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                )}
              />
              {manualArtifactOpen && !artifactOpen ? (
                <div className="text-muted-foreground p-4 text-sm">
                  Artifact panel
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
