import { v4 as uuidv4 } from "uuid";
import {
  Component,
  type ErrorInfo,
  FormEvent,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DEFAULT_AGENT_RECURSION_LIMIT } from "@/lib/constants";
import { useThreadRuntime } from "@/providers/Stream";
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
  AlertTriangle,
  ArrowDown,
  LoaderCircle,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  PanelRightClose,
  Plus,
  XIcon,
} from "lucide-react";
import { parseAsBoolean, useQueryState } from "nuqs";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import ThreadHistory from "./history";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Label } from "../ui/label";
import { useFileUpload } from "@/hooks/use-file-upload";
import { ContentBlocksPreview } from "./ContentBlocksPreview";
import { markThreadSeen } from "@/lib/thread-activity";
import {
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
  useArtifactOpen,
  useArtifactSurfaceMode,
} from "./artifact";
import { useTheme } from "next-themes";
import { ThreadSettings } from "./thread-settings";
import { getContentString } from "./utils";

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

type ThreadStatusWarning = {
  description: string;
  kind: "cancelled" | "error" | "incomplete" | "timeout";
  statusKey: string;
  title: string;
};

function normalizeThreadStatusValue(
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  return status.trim().toLowerCase();
}

function getStatusWarning(
  status: string | null | undefined,
  source: "run" | "thread",
): ThreadStatusWarning | null {
  const normalizedStatus = normalizeThreadStatusValue(status);
  if (!normalizedStatus) return null;

  if (
    normalizedStatus.includes("cancelled") ||
    normalizedStatus.includes("canceled")
  ) {
    return {
      kind: "cancelled",
      title: "Run was cancelled",
      description:
        "Please retry once. If it still fails, raise a ticket to the engineering team.",
      statusKey: `${source}:${normalizedStatus}`,
    };
  }

  if (normalizedStatus.includes("incomplete")) {
    return {
      kind: "incomplete",
      title: "Run is incomplete",
      description:
        "Please retry once. If it remains incomplete, raise a ticket to the engineering team.",
      statusKey: `${source}:${normalizedStatus}`,
    };
  }

  if (normalizedStatus.includes("timeout")) {
    return {
      kind: "timeout",
      title: "Run timed out",
      description:
        "Please retry once. If it still times out, raise a ticket to the engineering team.",
      statusKey: `${source}:${normalizedStatus}`,
    };
  }

  if (normalizedStatus === "error" || normalizedStatus.includes("error")) {
    return {
      kind: "error",
      title: "Run failed",
      description:
        "Please retry once. If it fails again, raise a ticket to the engineering team.",
      statusKey: `${source}:${normalizedStatus}`,
    };
  }

  return null;
}

function isConflictLikeError(error: unknown) {
  const text =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("409") ||
    normalized.includes("conflict") ||
    normalized.includes("active run") ||
    normalized.includes("thread is busy")
  );
}

const DEFAULT_HISTORY_WIDTH_PX = 300;
const HISTORY_MIN_WIDTH_PX = 220;
const HISTORY_MAX_WIDTH_PX = 480;
const DEFAULT_ARTIFACT_RATIO = 0.38;
const DEFAULT_ARTIFACT_FALLBACK_WIDTH_PX = 360;
const ARTIFACT_MIN_WIDTH_PX = 320;
const ARTIFACT_MAX_RATIO = 0.62;
const CHAT_MIN_WIDTH_PX = 360;
const RESIZE_HANDLE_WIDTH_PX = 10;
const RESIZE_STEP_PX = 24;

type PaneDragState =
  | { type: "none" }
  | { type: "artifact"; startArtifact: number; startX: number }
  | { type: "history"; startHistory: number; startX: number };

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
): { max: number; min: number } {
  const maxByChat =
    viewportWidth - CHAT_MIN_WIDTH_PX - Math.max(artifactWidth, 0);
  const max = Math.min(HISTORY_MAX_WIDTH_PX, Math.max(0, maxByChat));
  return toBounds(HISTORY_MIN_WIDTH_PX, max);
}

function getArtifactBounds(
  viewportWidth: number,
  historyWidth: number,
): { max: number; min: number } {
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
  artifactExpanded: boolean;
  artifactOpen: boolean;
  artifactWidth: number;
  chatHistoryOpen: boolean;
  historyWidth: number;
  viewportWidth: number;
}) {
  const {
    artifactExpanded,
    artifactOpen,
    artifactWidth,
    chatHistoryOpen,
    historyWidth,
    viewportWidth,
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

  return {
    artifactWidth: Math.round(Math.max(0, nextArtifact)),
    historyWidth: Math.round(Math.max(0, nextHistory)),
  };
}

function StickyToBottomContent(props: {
  className?: string;
  content: ReactNode;
  contentClassName?: string;
  footer?: ReactNode;
}) {
  const context = useStickToBottomContext();
  return (
    <div
      ref={context.scrollRef}
      data-testid="chat-scroll-container"
      style={{ height: "100%", width: "100%" }}
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

type MessageRenderBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  resetKey: string;
};

type MessageRenderBoundaryState = {
  hasError: boolean;
};

class MessageRenderBoundary extends Component<
  MessageRenderBoundaryProps,
  MessageRenderBoundaryState
> {
  state: MessageRenderBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MessageRenderBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo) {
    console.error("Message render failed", error);
  }

  componentDidUpdate(previousProps: MessageRenderBoundaryProps) {
    if (
      previousProps.resetKey !== this.props.resetKey &&
      this.state.hasError
    ) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}

function getSafeMessagePreview(message: Message): string {
  const text = getContentString(message.content).trim();
  if (text.length > 0) {
    return text;
  }

  if (Array.isArray(message.content)) {
    const blockTypes = message.content
      .map((block) => String(block?.type ?? "content"))
      .join(", ");
    return blockTypes || "Multimodal message";
  }

  if (message.content == null) {
    return "";
  }

  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
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

const ENTER_TO_SEND_STORAGE_KEY = "lg:chat:enterToSend";

export function Thread() {
  const runtime = useThreadRuntime();
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
  const [enterToSend, setEnterToSend] = useState(true);
  const {
    contentBlocks,
    setContentBlocks,
    handleFileUpload,
    dropRef,
    removeBlock,
    dragOver,
    handlePaste,
    isUploading,
  } = useFileUpload();
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
  const [pendingSubmittedMessage, setPendingSubmittedMessage] =
    useState<Message | null>(null);

  const preExpandLayoutRef = useRef<{
    artifactWidth: number;
    historyOpen: boolean;
    historyWidth: number;
  } | null>(null);
  const artifactWidthInitializedRef = useRef(false);
  const previousMessageLengthRef = useRef(0);
  const lastWarnedThreadStatusKey = useRef<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(ENTER_TO_SEND_STORAGE_KEY);
    if (stored === "false") {
      setEnterToSend(false);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ENTER_TO_SEND_STORAGE_KEY, String(enterToSend));
  }, [enterToSend]);

  const isLargeScreen = useMediaQuery("(min-width: 1024px)");
  const effectiveIsLoading = runtime.isWorking;
  const displayMessages = useMemo(() => {
    if (!pendingSubmittedMessage) {
      return runtime.messages;
    }

    if (
      runtime.messages.some(
        (message) => message.id === pendingSubmittedMessage.id,
      )
    ) {
      return runtime.messages;
    }

    return [...runtime.messages, pendingSubmittedMessage];
  }, [pendingSubmittedMessage, runtime.messages]);
  const statusWarning = useMemo(() => {
    const threadWarning = getStatusWarning(runtime.threadStatus, "thread");
    const runWarning = getStatusWarning(runtime.latestRunStatus, "run");

    if (
      threadWarning &&
      (threadWarning.kind === "cancelled" ||
        threadWarning.kind === "incomplete")
    ) {
      return threadWarning;
    }

    return runWarning ?? threadWarning;
  }, [runtime.latestRunStatus, runtime.threadStatus]);
  const visibleStatusWarning = useMemo(
    () =>
      isThreadActiveStatus(runtime.threadStatus) || effectiveIsLoading
        ? null
        : statusWarning,
    [effectiveIsLoading, runtime.threadStatus, statusWarning],
  );
  const uiMessageIdsByMessageId = useMemo(() => {
    const ids = new Set<string>();
    for (const uiMessage of runtime.values.ui ?? []) {
      const messageId = uiMessage.metadata?.message_id;
      if (typeof messageId === "string" && messageId.length > 0) {
        ids.add(messageId);
      }
    }
    return ids;
  }, [runtime.values.ui]);
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

  useEffect(() => {
    if (threadId && displayMessages.length !== previousMessageLengthRef.current) {
      markThreadSeen(threadId, Date.now());
    }

    previousMessageLengthRef.current = displayMessages.length;
  }, [displayMessages.length, threadId]);

  useEffect(() => {
    if (!pendingSubmittedMessage) return;
    if (
      runtime.messages.some(
        (message) => message.id === pendingSubmittedMessage.id,
      )
    ) {
      setPendingSubmittedMessage(null);
      return;
    }

    if (!runtime.isWorking) {
      setPendingSubmittedMessage(null);
    }
  }, [pendingSubmittedMessage, runtime.isWorking, runtime.messages]);

  useEffect(() => {
    if (!pendingSubmittedMessage) return;
    if (!threadId || !runtime.threadId) return;
    if (threadId !== runtime.threadId) {
      setPendingSubmittedMessage(null);
    }
  }, [pendingSubmittedMessage, runtime.threadId, threadId]);

  useEffect(() => {
    if (!threadId) return;
    markThreadSeen(threadId, Date.now());
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      lastWarnedThreadStatusKey.current = null;
      return;
    }

    if (isThreadActiveStatus(runtime.threadStatus) || effectiveIsLoading) {
      lastWarnedThreadStatusKey.current = null;
      return;
    }

    if (!visibleStatusWarning) return;

    const statusKey = `${threadId}:${visibleStatusWarning.statusKey}`;
    if (lastWarnedThreadStatusKey.current === statusKey) {
      return;
    }
    lastWarnedThreadStatusKey.current = statusKey;

    toast(visibleStatusWarning.title, {
      description: visibleStatusWarning.description,
      closeButton: true,
      duration: 12000,
    });
  }, [
    effectiveIsLoading,
    runtime.threadStatus,
    threadId,
    visibleStatusWarning,
  ]);

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
    (value: string | null) => {
      _setThreadId(value);
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
      artifactExpanded,
      artifactOpen: artifactPaneOpen,
      artifactWidth: artifactWidthPx,
      chatHistoryOpen,
      historyWidth: historyWidthPx,
      viewportWidth: viewportWidthPx,
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
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
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

  const shouldBlockWhileCurrentThreadBusy = useCallback(
    (_source: "regenerate" | "submit") => {
      if (effectiveIsLoading || isThreadActiveStatus(runtime.threadStatus)) {
        showThreadRunningToast();
        return true;
      }
      return false;
    },
    [effectiveIsLoading, runtime.threadStatus],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (input.trim().length === 0 && contentBlocks.length === 0) return;
    if (shouldBlockWhileCurrentThreadBusy("submit")) {
      return;
    }

    const threadPreview = buildThreadPreview(input, contentBlocks.length);
    const attachmentLines = contentBlocks
      .map((block, index) => {
        const name =
          block.type === "image"
            ? String(block.metadata?.name)
            : String(block.metadata?.filename);
        const preferredUrl =
          (block as { url?: string }).url ||
          (block.metadata as { httpsUrl?: string })?.httpsUrl ||
          (block.metadata as { publicUrl?: string })?.publicUrl ||
          (block.metadata as { gsUrl?: string })?.gsUrl ||
          (block.metadata as { gcsUrl?: string })?.gcsUrl ||
          "";
        const url = String(preferredUrl);
        return `${index + 1}. FILE_NAME="${name}", FILE_URL="${url}", MIME_TYPE="${block.mime_type}"`;
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
    const toolMessages = ensureToolCallsHaveResponses(runtime.messages);
    const context =
      Object.keys(artifactContext).length > 0 ? artifactContext : undefined;
    const submitMetadata = !threadId
      ? { thread_preview: threadPreview }
      : undefined;
    const previousInput = input;
    const previousContentBlocks = [...contentBlocks];
    setPendingSubmittedMessage(newHumanMessage);
    setInput("");
    setContentBlocks([]);

    try {
      await runtime.submit(
        { context, messages: [...toolMessages, newHumanMessage] },
        {
          config: {
            recursion_limit: DEFAULT_AGENT_RECURSION_LIMIT,
          },
          context,
          metadata: submitMetadata,
          multitaskStrategy: "reject",
          onDisconnect: "continue",
          optimisticValues: (previous) => ({
            ...previous,
            context,
            messages: [
              ...(previous.messages ?? []),
              ...toolMessages,
              newHumanMessage,
            ],
          }),
        },
      );
    } catch (error) {
      setPendingSubmittedMessage(null);
      setInput(previousInput);
      setContentBlocks(previousContentBlocks);
      if (isConflictLikeError(error)) {
        showThreadRunningToast();
        return;
      }

      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong>{" "}
            <code>
              {String(
                typeof error === "object" && error && "message" in error
                  ? (error as { message?: unknown }).message ?? error
                  : error,
              )}
            </code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    }
  };

  const handleRegenerate = useCallback(
    async (parentCheckpoint: Checkpoint | null | undefined) => {
      if (shouldBlockWhileCurrentThreadBusy("regenerate")) {
        return;
      }

      try {
        await runtime.submit(undefined, {
          config: {
            recursion_limit: DEFAULT_AGENT_RECURSION_LIMIT,
          },
          checkpoint: parentCheckpoint,
          multitaskStrategy: "reject",
          onDisconnect: "continue",
        });
      } catch (error) {
        if (isConflictLikeError(error)) {
          showThreadRunningToast();
        }
      }
    },
    [runtime, shouldBlockWhileCurrentThreadBusy],
  );

  const handleCancel = useCallback(async () => {
    try {
      await runtime.cancel();
    } catch {
      toast.error("Failed to cancel the active run.", {
        closeButton: true,
      });
    }
  }, [runtime]);

  const handleHistoryResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !showDesktopHistoryHandle) return;
      event.preventDefault();
      setPaneDragState({
        type: "history",
        startHistory: historyWidthPx,
        startX: event.clientX,
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
        startArtifact: artifactWidthPx,
        startX: event.clientX,
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
        artifactWidth: artifactWidthPx,
        historyOpen: chatHistoryOpen,
        historyWidth: historyWidthPx,
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

  const chatStarted = !!threadId || !!displayMessages.length;
  const hasNoAIOrToolMessages = !displayMessages.find(
    (message) => message.type === "ai" || message.type === "tool",
  );
  const visibleMessages = displayMessages.filter(
    (message) =>
      typeof message.id !== "string" ||
      !message.id.startsWith(DO_NOT_RENDER_ID_PREFIX),
  );
  const messageRenderResetKey = `${threadId ?? "new"}:${visibleMessages
    .map((message, index) => String(message.id ?? `${message.type}-${index}`))
    .join("|")}`;
  const messageRenderFallback = (
    <div className="flex flex-col gap-3">
      {visibleMessages.map((message, index) => {
        const preview = getSafeMessagePreview(message);
        return (
          <div
            key={String(message.id ?? `${message.type}-${index}`)}
            className={cn(
              "max-w-[min(100%,72ch)] rounded-2xl border px-4 py-3 text-sm whitespace-pre-wrap",
              message.type === "human"
                ? "bg-muted ml-auto"
                : "bg-background mr-auto",
            )}
          >
            {preview || `${message.type} message`}
          </div>
        );
      })}
      {visibleMessages.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Unable to render message content for this thread.
        </p>
      ) : null}
    </div>
  );
  const showWorkingBadge = effectiveIsLoading || isThreadActiveStatus(runtime.threadStatus);
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
          transition: isPaneDragActive ? "none" : "width 200ms ease",
          width: desktopHistoryWidth,
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
                      onClick={() => setChatHistoryOpen((previous) => !previous)}
                    >
                      {chatHistoryOpen ? (
                        <PanelRightOpen className="size-5" />
                      ) : (
                        <PanelRightClose className="size-5" />
                      )}
                    </Button>
                  )}
                </div>
                <ThreadSettings
                  enterToSend={enterToSend}
                  onEnterToSendChange={setEnterToSend}
                />
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
                        onClick={() => setChatHistoryOpen((previous) => !previous)}
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
                      damping: 30,
                      stiffness: 300,
                      type: "spring",
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
                  <ThreadSettings
                    enterToSend={enterToSend}
                    onEnterToSendChange={setEnterToSend}
                  />
                </div>

                <div className="from-background to-background/0 absolute inset-x-0 top-full h-5 bg-gradient-to-b" />
              </div>
            )}

            <StickToBottom className="relative flex-1 overflow-hidden">
              <StickyToBottomContent
                className={cn(
                  "[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50 absolute inset-0 overflow-x-hidden overflow-y-scroll px-4 [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                  !chatStarted &&
                    "mt-[clamp(4rem,20vh,25vh)] flex flex-col items-stretch",
                  chatStarted && "grid grid-rows-[1fr_auto]",
                )}
                contentClassName="pt-8 pb-16 max-w-3xl min-w-0 mx-auto flex w-full flex-col gap-4"
                content={
                  <MessageRenderBoundary
                    resetKey={messageRenderResetKey}
                    fallback={messageRenderFallback}
                  >
                    <>
                      {visibleMessages.map((message, index) =>
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
                            handleRegenerate={handleRegenerate}
                            interrupt={runtime.interrupt}
                            getMessagesMetadata={runtime.getMessagesMetadata}
                            onSelectBranch={runtime.setBranch}
                            hasCustomComponentsForMessage={
                              !!message.id && uiMessageIdsByMessageId.has(message.id)
                            }
                          />
                        ),
                      )}
                      {hasNoAIOrToolMessages && !!runtime.interrupt && (
                        <AssistantMessage
                          key="interrupt-msg"
                          message={undefined}
                          allMessages={displayMessages}
                          isLoading={effectiveIsLoading}
                          handleRegenerate={handleRegenerate}
                          interrupt={runtime.interrupt}
                          getMessagesMetadata={runtime.getMessagesMetadata}
                          onSelectBranch={runtime.setBranch}
                          hasCustomComponentsForMessage={false}
                        />
                      )}
                      {showWorkingBadge && hasNoAIOrToolMessages ? (
                        <AssistantMessageLoading />
                      ) : null}
                    </>
                  </MessageRenderBoundary>
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

                    {showWorkingBadge ? (
                      <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end px-1">
                        <p
                          data-testid="thread-working-status"
                          className="bg-muted/70 text-muted-foreground inline-flex items-center rounded-full border px-3 py-1 text-xs"
                          aria-live="polite"
                        >
                          <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />
                          Working on your query...
                        </p>
                      </div>
                    ) : null}
                    {visibleStatusWarning ? (
                      <div className="mx-auto mb-2 flex w-full max-w-3xl justify-end px-1">
                        <p
                          data-testid="thread-status-warning"
                          className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
                          aria-live="polite"
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="whitespace-normal">
                            <strong>{visibleStatusWarning.title}:</strong>{" "}
                            {visibleStatusWarning.description}
                          </span>
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
                        className="mx-auto flex max-h-[min(55vh,34rem)] max-w-3xl flex-col gap-2 overflow-hidden"
                      >
                        <div className="min-h-0 overflow-y-auto">
                          <ContentBlocksPreview
                            blocks={contentBlocks}
                            onRemove={removeBlock}
                          />
                          <textarea
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onPaste={handlePaste}
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.nativeEvent.isComposing &&
                                ((!event.shiftKey && enterToSend) ||
                                  ((event.metaKey || event.ctrlKey) &&
                                    !enterToSend))
                              ) {
                                event.preventDefault();
                                const element = event.target as HTMLElement | undefined;
                                const form = element?.closest("form");
                                form?.requestSubmit();
                              }
                            }}
                            placeholder="Type your message..."
                            className="field-sizing-content max-h-[40vh] min-h-[3.5rem] w-full resize-none overflow-y-auto border-none bg-transparent p-3.5 pb-0 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none"
                          />
                        </div>

                        <div className="flex shrink-0 items-center gap-6 p-2 pt-4">
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
                          {showWorkingBadge ? (
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
                                showWorkingBadge ||
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
                  "relative min-h-0 flex-grow",
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
