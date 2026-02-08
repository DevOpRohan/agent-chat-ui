import { v4 as uuidv4 } from "uuid";
import { ReactNode, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { DEFAULT_AGENT_RECURSION_LIMIT } from "@/lib/constants";
import { useStreamContext } from "@/providers/Stream";
import { useState, FormEvent } from "react";
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
import { markThreadSeen } from "@/lib/thread-activity";
import { useThreadBusy } from "@/hooks/use-thread-busy";
import { useStableStreamMessages } from "@/hooks/use-stable-stream-messages";
import {
  useArtifactOpen,
  ArtifactContent,
  ArtifactTitle,
  useArtifactContext,
} from "./artifact";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { useTheme } from "next-themes";

function getErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeMessage = (error as { message?: unknown }).message;
  if (typeof maybeMessage === "string") return maybeMessage;
  return undefined;
}

function isThreadConflictError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("409") ||
    lowered.includes("conflict") ||
    lowered.includes("busy") ||
    lowered.includes("inflight")
  );
}

function isBenignReact185Error(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("minified react error #185") ||
    lowered.includes("/errors/185")
  );
}

function showThreadRunningToast() {
  toast("Thread is still running", {
    description:
      "Please wait for the current response to finish, then send your next message.",
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
  const [artifactOpen, closeArtifact] = useArtifactOpen();

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
  const { markBusy } = useThreadBusy();
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const isCurrentThreadLoading =
    !!threadId && isLoading && loadingThreadId === threadId;

  const lastError = useRef<string | undefined>(undefined);

  const setThreadId = (id: string | null) => {
    _setThreadId(id);

    // close artifact and reset artifact context
    closeArtifact();
    setArtifactContext({});
  };

  useEffect(() => {
    if (!isLoading) {
      if (loadingThreadId) {
        markBusy(loadingThreadId, false);
        setLoadingThreadId(null);
      }
      return;
    }

    if (!loadingThreadId && threadId) {
      setLoadingThreadId(threadId);
      markBusy(threadId, true);
    }
  }, [isLoading, loadingThreadId, markBusy, threadId]);

  useEffect(() => {
    if (!stream.error) {
      lastError.current = undefined;
      return;
    }
    try {
      const message = getErrorMessage(stream.error);
      if (!message || lastError.current === message) {
        // Message has already been logged. do not modify ref, return early.
        return;
      }

      // Message is defined, and it has not been logged yet. Save it, and send the error
      lastError.current = message;
      if (isBenignReact185Error(message)) {
        console.warn("Ignoring benign React #185 stream error", message);
        return;
      }
      if (isThreadConflictError(message)) {
        toast("Thread already has an active run", {
          description:
            "Your message was not sent. Please retry after the current run completes.",
          closeButton: true,
        });
        return;
      }
      toast.error("An error occurred. Please try again.", {
        description: (
          <p>
            <strong>Error:</strong> <code>{message}</code>
          </p>
        ),
        richColors: true,
        closeButton: true,
      });
    } catch {
      // no-op
    }
  }, [stream.error]);

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
    if (isCurrentThreadLoading) {
      showThreadRunningToast();
      return true;
    }

    if (!threadId) return false;

    try {
      const currentThread = await stream.client.threads.get(threadId);
      if (currentThread.status === "busy") {
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
      setLoadingThreadId(threadId);
      markBusy(threadId, true);
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
      setLoadingThreadId(threadId);
      markBusy(threadId, true);
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

  const chatStarted = !!threadId || !!messages.length;
  const hasNoAIOrToolMessages = !displayMessages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const logoVariant = resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <div className="relative hidden lg:flex">
        <motion.div
          className="bg-background absolute z-20 h-full overflow-hidden border-r"
          style={{ width: 300 }}
          animate={
            isLargeScreen
              ? { x: chatHistoryOpen ? 0 : -300 }
              : { x: chatHistoryOpen ? 0 : -300 }
          }
          initial={{ x: -300 }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          <div
            className="relative h-full"
            style={{ width: 300 }}
          >
            <ThreadHistory />
          </div>
        </motion.div>
      </div>

      <div
        className={cn(
          "grid w-full grid-cols-[1fr_0fr] transition-all duration-500",
          artifactOpen && "grid-cols-[3fr_2fr]",
        )}
      >
        <motion.div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col overflow-hidden",
            !chatStarted && "grid-rows-[1fr]",
          )}
          layout={isLargeScreen}
          animate={{
            marginLeft: chatHistoryOpen ? (isLargeScreen ? 300 : 0) : 0,
            width: chatHistoryOpen
              ? isLargeScreen
                ? "calc(100% - 300px)"
                : "100%"
              : "100%",
          }}
          transition={
            isLargeScreen
              ? { type: "spring", stiffness: 300, damping: 30 }
              : { duration: 0 }
          }
        >
          {!chatStarted && (
            <div className="absolute top-0 left-0 z-10 flex w-full items-center justify-between gap-3 p-2 pl-4">
              <div>
                {(!chatHistoryOpen || !isLargeScreen) && (
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
                "[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50 absolute inset-0 overflow-y-scroll px-4 [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent",
                !chatStarted && "mt-[25vh] flex flex-col items-stretch",
                chatStarted && "grid grid-rows-[1fr_auto]",
              )}
              contentClassName="pt-8 pb-16 max-w-3xl mx-auto flex flex-col gap-4 w-full"
              content={
                <>
                  {displayMessages
                    .filter((m) => !m.id?.startsWith(DO_NOT_RENDER_ID_PREFIX))
                    .map((message, index) =>
                      message.type === "human" ? (
                        <HumanMessage
                          key={message.id || `${message.type}-${index}`}
                          message={message}
                          isLoading={isLoading}
                        />
                      ) : (
                        <AssistantMessage
                          key={message.id || `${message.type}-${index}`}
                          message={message}
                          allMessages={displayMessages}
                          isLoading={isLoading}
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
                      isLoading={isLoading}
                      handleRegenerate={handleRegenerate}
                    />
                  )}
                  {isCurrentThreadLoading && !firstTokenReceived && (
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
                        className="field-sizing-content resize-none border-none bg-transparent p-3.5 pb-0 shadow-none ring-0 outline-none focus:ring-0 focus:outline-none"
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
                        {isCurrentThreadLoading ? (
                          <Button
                            key="stop"
                            onClick={() => stream.stop()}
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
                              isCurrentThreadLoading ||
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
        </motion.div>
        <div className="relative flex flex-col border-l">
          <div className="absolute inset-0 flex min-w-[30vw] flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_auto] border-b p-4">
              <ArtifactTitle className="truncate overflow-hidden" />
              <button
                onClick={closeArtifact}
                className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              >
                <XIcon className="size-5" />
              </button>
            </div>
            <ArtifactContent className="[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50 relative flex-grow overflow-y-scroll pr-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent" />
          </div>
        </div>
      </div>
    </div>
  );
}
