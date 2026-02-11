import { parsePartialJson } from "@langchain/core/output_parsers";
import { useStreamContext } from "@/providers/Stream";
import {
  AIMessage,
  Checkpoint,
  Message,
  ToolMessage,
} from "@langchain/langgraph-sdk";
import { getContentString } from "../utils";
import { BranchSwitcher, CommandBar } from "./shared";
import { MarkdownText } from "../markdown-text";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { cn } from "@/lib/utils";
import { ToolCalls, ToolResult } from "./tool-calls";
import { MessageContentComplex } from "@langchain/core/messages";
import { Fragment } from "react/jsx-runtime";
import { isAgentInboxInterruptSchema } from "@/lib/agent-inbox-interrupt";
import { ThreadView } from "../agent-inbox";
import { GenericInterruptView } from "./generic-interrupt";
import { useArtifact } from "../artifact";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { DO_NOT_RENDER_ID_PREFIX } from "@/lib/ensure-tool-responses";
import { TopicPreviewArtifact } from "./topic-preview-artifact";

const REASONING_PREVIEW_CHARS = 500;
const LOCAL_UI_COMPONENTS = {
  topic_preview_artifact: TopicPreviewArtifact,
};
type OrderedContentPart =
  | {
      kind: "text";
      key: string;
      text: string;
    }
  | {
      kind: "reasoning";
      key: string;
      text: string;
    }
  | {
      kind: "tool_calls";
      key: string;
      toolCalls: NonNullable<AIMessage["tool_calls"]>;
    }
  | {
      kind: "tool_result";
      key: string;
      toolResult: ToolMessage;
    };
type IntermediateContentPart = Exclude<OrderedContentPart, { kind: "text" }>;
type OrderedRenderSegment =
  | {
      kind: "text";
      key: string;
      text: string;
    }
  | {
      kind: "intermediate";
      key: string;
      parts: IntermediateContentPart[];
    };

function isReasoningLikeType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized.includes("reasoning") || normalized.includes("thinking");
}

function extractReasoningTextFromThinkTags(text: string): string[] {
  const matches: string[] = [];
  const patterns = [
    /<think>([\s\S]*?)<\/think>/gi,
    /<thinking>([\s\S]*?)<\/thinking>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1]?.trim();
      if (candidate) {
        matches.push(candidate);
      }
    }
  }

  return matches;
}

function readTextValue(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => readTextValue(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const fieldsToCheck = [record.text, record.content, record.value];
  return fieldsToCheck.flatMap((field) => readTextValue(field));
}

function readReasoningValue(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => readReasoningValue(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const fieldsToCheck = [
    record.reasoning,
    record.thinking,
    record.summary,
    record.summary_text,
    record.text,
    record.content,
    record.reasoning_content,
    record.reasoning_details,
    record.reasoning_blocks,
    record.value,
  ];

  return fieldsToCheck.flatMap((field) => readReasoningValue(field));
}

function extractReasoningText(message: Message | undefined): string {
  if (!message) return "";

  const collected: string[] = [];

  if (Array.isArray(message.content)) {
    const contentBlocks = message.content as unknown[];
    for (const block of contentBlocks) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      const hasReasoningField =
        "reasoning" in record ||
        "thinking" in record ||
        "reasoning_content" in record;
      if (isReasoningLikeType(record.type) || hasReasoningField) {
        collected.push(...readReasoningValue(record));
      }
    }
  }

  const contentText = getContentString(message.content);
  if (contentText) {
    collected.push(...extractReasoningTextFromThinkTags(contentText));
  }

  collected.push(
    ...readReasoningValue(message.additional_kwargs?.reasoning),
    ...readReasoningValue(message.additional_kwargs?.reasoning_content),
    ...readReasoningValue(message.additional_kwargs?.thinking),
    ...readReasoningValue(message.response_metadata?.reasoning),
    ...readReasoningValue(message.response_metadata?.reasoning_content),
  );

  const uniqueReasoning = Array.from(
    new Set(
      collected.map((item) => item.trim()).filter((item) => item.length > 0),
    ),
  );

  return uniqueReasoning.join("\n\n");
}

function getReasoningPreview(text: string): string {
  if (text.length <= REASONING_PREVIEW_CHARS) return text;
  return text.slice(-REASONING_PREVIEW_CHARS);
}

function ThinkingPanel({ text }: { text: string }) {
  const previewText = getReasoningPreview(text);
  const contentRef = useRef<HTMLPreElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);

  const scrollToBottom = () => {
    const el = contentRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (!isOpen || !stickToBottom) return;
    scrollToBottom();
  }, [previewText, isOpen, stickToBottom]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceToBottom <= 20);
  };

  return (
    <details
      className="bg-muted/50 text-muted-foreground border-border rounded-md border px-3 py-2 text-xs"
      onToggle={(event) => {
        const opened = (event.currentTarget as HTMLDetailsElement).open;
        setIsOpen(opened);
        if (opened) {
          setStickToBottom(true);
          window.requestAnimationFrame(scrollToBottom);
        }
      }}
    >
      <summary className="text-foreground cursor-pointer font-medium select-none">
        Thinking (latest {REASONING_PREVIEW_CHARS} chars)
      </summary>
      <pre
        ref={contentRef}
        onScroll={handleScroll}
        className="[&::-webkit-scrollbar-thumb]:bg-border mt-2 max-h-48 overflow-y-auto pr-2 text-xs leading-relaxed break-words whitespace-pre-wrap [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent"
      >
        {previewText}
      </pre>
    </details>
  );
}

function getIntermediateRunningStatus(
  parts: IntermediateContentPart[],
  isStreaming: boolean,
  isReconnecting: boolean,
): string | null {
  if (parts.length === 0) {
    return null;
  }

  if (isReconnecting) {
    return "reconnecting...";
  }

  if (!isStreaming) {
    return null;
  }

  for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
    const part = parts[idx];
    if (part.kind === "tool_calls") {
      const toolNames = part.toolCalls
        .map((toolCall) => toolCall.name?.trim())
        .filter((name): name is string => !!name);

      if (toolNames.length === 1) {
        return `calling ${toolNames[0]}...`;
      }

      if (toolNames.length > 1) {
        return `calling ${toolNames.length} tools...`;
      }

      return "calling tool...";
    }

    if (part.kind === "reasoning") {
      return "thinking...";
    }
  }

  return "thinking...";
}

function IntermediateStepContent({
  parts,
}: {
  parts: IntermediateContentPart[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {parts.map((part) => {
        if (part.kind === "reasoning") {
          return (
            <ThinkingPanel
              key={part.key}
              text={part.text}
            />
          );
        }

        return (
          <div
            key={part.key}
            className="bg-card border-border rounded-md border p-2"
          >
            {part.kind === "tool_calls" ? (
              <>
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  Tool Calls
                </p>
                <ToolCalls toolCalls={part.toolCalls} />
              </>
            ) : (
              <>
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  Tool Result
                </p>
                <ToolResult message={part.toolResult} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function IntermediateStepsArtifactTrigger({
  parts,
  isStreaming,
  isReconnecting = false,
  isLoading,
  showActions,
  actionContent,
  handleRegenerate,
}: {
  parts: IntermediateContentPart[];
  isStreaming: boolean;
  isReconnecting?: boolean;
  isLoading: boolean;
  showActions?: boolean;
  actionContent?: string;
  handleRegenerate?: () => void;
}) {
  const [IntermediateArtifactContent, intermediateArtifact] = useArtifact();
  if (parts.length === 0) return null;

  const runningStatus = getIntermediateRunningStatus(
    parts,
    isStreaming,
    isReconnecting,
  );
  const statusLabel = runningStatus ?? "open details";

  return (
    <>
      <button
        type="button"
        onClick={() => intermediateArtifact.setOpen(true)}
        className="bg-muted/60 hover:bg-muted border-border w-full rounded-lg border px-3 py-2 text-left transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
              {runningStatus ? (
                <LoaderCircle className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
              ) : null}
              Intermediate Step
            </span>
            <span className="text-muted-foreground truncate text-xs font-medium">
              {statusLabel}
            </span>
          </div>
          <span className="text-muted-foreground shrink-0 text-xs">
            {parts.length}
          </span>
        </div>
      </button>
      {showActions ? (
        <div className="mt-2">
          <CommandBar
            content={actionContent ?? ""}
            isLoading={isLoading}
            isAiMessage={true}
            handleRegenerate={handleRegenerate}
          />
        </div>
      ) : null}

      {intermediateArtifact.open ? (
        <IntermediateArtifactContent
          title={
            <div className="text-foreground flex items-center gap-1.5 truncate font-semibold">
              {runningStatus ? (
                <LoaderCircle className="text-muted-foreground h-4 w-4 animate-spin" />
              ) : null}
              {runningStatus
                ? `Intermediate Step: ${runningStatus}`
                : "Intermediate Step"}
            </div>
          }
        >
          <div className="flex min-h-full flex-col">
            <div className="border-border border-b px-4 py-3">
              <p className="text-foreground text-base font-semibold">
                Intermediate Step
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {runningStatus
                  ? runningStatus
                  : "Reasoning, tool calls, and tool responses for this assistant turn."}
              </p>
            </div>
            <div className="p-4">
              <IntermediateStepContent parts={parts} />
            </div>
          </div>
        </IntermediateArtifactContent>
      ) : null}
    </>
  );
}

function isToolCallLikeType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    value === "tool_use" || value === "tool_call" || value.endsWith("_call")
  );
}

function parseToolCallFromContentBlock(
  record: Record<string, unknown>,
): NonNullable<AIMessage["tool_calls"]>[number] {
  const rawType =
    typeof record.type === "string" && record.type.length > 0
      ? record.type
      : "tool_call";
  const name =
    typeof record.name === "string" && record.name.length > 0
      ? record.name
      : rawType;
  const id =
    typeof record.id === "string" && record.id.length > 0
      ? record.id
      : undefined;

  const rawInput = record.input ?? record.args ?? record.arguments;
  let args: Record<string, any> = {};

  if (typeof rawInput === "string") {
    try {
      args = parsePartialJson(rawInput) ?? {};
    } catch {
      args = { input: rawInput };
    }
  } else if (rawInput && typeof rawInput === "object") {
    args = rawInput as Record<string, any>;
  } else {
    const entries = Object.entries(record).filter(
      ([key]) => !["type", "name", "id"].includes(key),
    );
    if (entries.length > 0) {
      args = Object.fromEntries(entries);
    }
  }

  return {
    name,
    id,
    args,
    type: "tool_call",
  };
}

function getOrderedContentParts(
  message: Message | undefined,
): OrderedContentPart[] {
  if (!message) return [];
  if (!Array.isArray(message.content)) return [];

  const parts: OrderedContentPart[] = [];
  const contentBlocks = message.content as unknown[];

  for (let idx = 0; idx < contentBlocks.length; idx += 1) {
    const block = contentBlocks[idx];
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const type = record.type;

    const hasReasoningField =
      "reasoning" in record ||
      "thinking" in record ||
      "reasoning_content" in record;
    const isReasoningBlock = isReasoningLikeType(type) || hasReasoningField;
    const isTextBlock = type === "text" || type === "output_text";
    const isToolCallBlock = isToolCallLikeType(type);

    if (isReasoningBlock) {
      const reasoningText = Array.from(
        new Set(
          readReasoningValue(record)
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      ).join("\n\n");
      if (reasoningText.length > 0) {
        parts.push({
          kind: "reasoning",
          key: `reasoning-${idx}`,
          text: reasoningText,
        });
      }
      continue;
    }

    if (isTextBlock) {
      const textValue = readTextValue(record.text ?? record.content).join(
        "\n\n",
      );
      if (textValue.length > 0) {
        parts.push({ kind: "text", key: `text-${idx}`, text: textValue });
      }
      continue;
    }

    if (isToolCallBlock) {
      const toolCall = parseToolCallFromContentBlock(record);
      parts.push({
        kind: "tool_calls",
        key: `tool-call-${idx}`,
        toolCalls: [toolCall],
      });
    }
  }

  return parts;
}

function groupOrderedContentParts(
  parts: OrderedContentPart[],
): OrderedRenderSegment[] {
  const segments: OrderedRenderSegment[] = [];
  let intermediateBuffer: IntermediateContentPart[] = [];

  const flushIntermediate = () => {
    if (intermediateBuffer.length === 0) return;
    segments.push({
      kind: "intermediate",
      key: `intermediate-${segments.length}`,
      parts: intermediateBuffer,
    });
    intermediateBuffer = [];
  };

  for (const part of parts) {
    if (part.kind === "text") {
      flushIntermediate();
      segments.push({
        kind: "text",
        key: part.key,
        text: part.text,
      });
      continue;
    }

    intermediateBuffer.push(part);
  }

  flushIntermediate();
  return segments;
}

function stringifyToolCall(
  toolCall: NonNullable<AIMessage["tool_calls"]>[number],
): string {
  const header = `Tool: ${toolCall.name}${toolCall.id ? ` (${toolCall.id})` : ""}`;
  const args = Object.keys(toolCall.args ?? {}).length
    ? JSON.stringify(toolCall.args, null, 2)
    : "{}";
  return `${header}\n${args}`;
}

function getIntermediateCopyText(parts: IntermediateContentPart[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.kind === "reasoning") {
      if (part.text.trim().length > 0) {
        chunks.push(part.text.trim());
      }
      continue;
    }

    if (part.kind === "tool_calls") {
      if (part.toolCalls.length > 0) {
        chunks.push(
          part.toolCalls.map((tc) => stringifyToolCall(tc)).join("\n\n"),
        );
      }
      continue;
    }

    const toolContent = part.toolResult.content;
    if (typeof toolContent === "string") {
      if (toolContent.trim().length > 0) {
        chunks.push(toolContent.trim());
      }
    } else if (Array.isArray(toolContent) && toolContent.length > 0) {
      chunks.push(JSON.stringify(toolContent, null, 2));
    }
  }

  return chunks.join("\n\n");
}

function CustomComponent({
  message,
  thread,
}: {
  message: Message;
  thread: ReturnType<typeof useStreamContext>;
}) {
  const artifact = useArtifact();
  const { values } = useStreamContext();
  const uiMessages = values.ui ?? [];
  const directMatches = uiMessages.filter(
    (ui) => ui.metadata?.message_id === message.id,
  );

  const assistantMessageIds = new Set(
    thread.messages
      .filter((candidate) => candidate.type === "ai" && !!candidate.id)
      .map((candidate) => candidate.id),
  );

  const latestAssistantMessage = [...thread.messages]
    .reverse()
    .find((candidate) => candidate.type === "ai" && !!candidate.id);

  const messageIsLatestAssistant =
    message.type === "ai" &&
    !!message.id &&
    latestAssistantMessage?.id === message.id;

  const unmatchedTopicArtifact = messageIsLatestAssistant
    ? [...uiMessages]
        .reverse()
        .find((ui) => {
          if (ui.name !== "topic_preview_artifact") return false;
          const linkedMessageId =
            typeof ui.metadata?.message_id === "string"
              ? ui.metadata.message_id
              : null;
          return !linkedMessageId || !assistantMessageIds.has(linkedMessageId);
        })
    : undefined;

  const customComponents =
    unmatchedTopicArtifact &&
    !directMatches.some((candidate) => candidate.id === unmatchedTopicArtifact.id)
      ? [...directMatches, unmatchedTopicArtifact]
      : directMatches;

  if (!customComponents?.length) return null;
  return (
    <Fragment key={message.id}>
      {customComponents.map((customComponent) => (
        <LoadExternalComponent
          key={customComponent.id}
          stream={thread}
          message={customComponent}
          meta={{ ui: customComponent, artifact }}
          components={LOCAL_UI_COMPONENTS}
        />
      ))}
    </Fragment>
  );
}

function parseAnthropicStreamedToolCalls(
  content: MessageContentComplex[],
): AIMessage["tool_calls"] {
  const toolCallContents = content.filter((c) => c.type === "tool_use" && c.id);

  return toolCallContents.map((tc) => {
    const toolCall = tc as Record<string, any>;
    let json: Record<string, any> = {};
    if (toolCall?.input) {
      try {
        json = parsePartialJson(toolCall.input) ?? {};
      } catch {
        // Pass
      }
    }
    return {
      name: toolCall.name ?? "",
      id: toolCall.id ?? "",
      args: json,
      type: "tool_call",
    };
  });
}

function isAiOrToolMessage(message: Message | undefined): boolean {
  return message?.type === "ai" || message?.type === "tool";
}

function withPartKeyPrefix(
  parts: IntermediateContentPart[],
  keyPrefix: string,
): IntermediateContentPart[] {
  return parts.map((part, idx) => ({
    ...part,
    key: `${keyPrefix}-${idx}-${part.key}`,
  }));
}

function getFallbackIntermediateParts(
  message: Message,
  keyPrefix: string,
): IntermediateContentPart[] {
  const reasoningText = extractReasoningText(message);
  const content = message.content ?? [];
  const anthropicStreamedToolCalls = Array.isArray(content)
    ? parseAnthropicStreamedToolCalls(content as MessageContentComplex[])
    : undefined;

  const aiMessage = message as AIMessage;
  const messageToolCalls = Array.isArray(aiMessage.tool_calls)
    ? aiMessage.tool_calls
    : [];
  const hasToolCalls = messageToolCalls.length > 0;
  const toolCallsHaveContents =
    hasToolCalls &&
    messageToolCalls.some((tc) => tc.args && Object.keys(tc.args).length > 0);

  const fallbackToolCalls =
    (hasToolCalls && toolCallsHaveContents && messageToolCalls) ||
    (anthropicStreamedToolCalls && anthropicStreamedToolCalls.length > 0
      ? anthropicStreamedToolCalls
      : undefined) ||
    (hasToolCalls ? messageToolCalls : undefined);

  const fallbackIntermediateParts: IntermediateContentPart[] = [];
  if (reasoningText.trim().length > 0) {
    fallbackIntermediateParts.push({
      kind: "reasoning",
      key: "fallback-reasoning",
      text: reasoningText,
    });
  }
  if (fallbackToolCalls && fallbackToolCalls.length > 0) {
    fallbackIntermediateParts.push({
      kind: "tool_calls",
      key: "fallback-tool-calls",
      toolCalls: fallbackToolCalls,
    });
  }

  return withPartKeyPrefix(fallbackIntermediateParts, keyPrefix);
}

function getIntermediatePartsFromMessage(
  message: Message | undefined,
  keyPrefix: string,
): IntermediateContentPart[] {
  if (!message) return [];

  if (message.type === "tool") {
    return withPartKeyPrefix(
      [
        {
          kind: "tool_result",
          key: `tool-result-${message.id ?? "latest"}`,
          toolResult: message as ToolMessage,
        },
      ],
      keyPrefix,
    );
  }

  if (message.type !== "ai") {
    return [];
  }

  const orderedContentParts = getOrderedContentParts(message);
  if (orderedContentParts.length > 0) {
    const orderedSegments = groupOrderedContentParts(orderedContentParts);
    const orderedIntermediateParts = orderedSegments.flatMap((segment) =>
      segment.kind === "intermediate" ? segment.parts : [],
    );
    return withPartKeyPrefix(orderedIntermediateParts, keyPrefix);
  }

  return getFallbackIntermediateParts(message, keyPrefix);
}

function messageHasRenderableText(message: Message | undefined): boolean {
  if (!message || message.type !== "ai") return false;

  const orderedContentParts = getOrderedContentParts(message);
  const hasOrderedText = orderedContentParts.some(
    (part) => part.kind === "text" && part.text.trim().length > 0,
  );
  if (hasOrderedText) return true;

  return getContentString(message.content).trim().length > 0;
}

function getRenderableMessages(messages: Message[]): Message[] {
  return messages.filter(
    (message) => !message.id?.startsWith(DO_NOT_RENDER_ID_PREFIX),
  );
}

interface InterruptProps {
  interrupt?: unknown;
  isLastMessage: boolean;
  hasNoAIOrToolMessages: boolean;
}

function containsBreakpointSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("breakpoint") ||
    normalized.includes("human interrupt") ||
    normalized.includes("graphinterrupt") ||
    normalized.includes("nodeinterrupt")
  );
}

function shouldSuppressBreakpointInterrupt(
  interrupt: unknown,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (!interrupt) return false;

  if (typeof interrupt === "string") {
    return containsBreakpointSignal(interrupt);
  }

  if (Array.isArray(interrupt)) {
    return interrupt.some((item) =>
      shouldSuppressBreakpointInterrupt(item, seen),
    );
  }

  if (typeof interrupt !== "object") {
    return false;
  }

  const record = interrupt as Record<string, unknown>;
  if (seen.has(record)) {
    return false;
  }
  seen.add(record);

  const actionRequests = record.action_requests;
  if (Array.isArray(actionRequests) && actionRequests.length > 0) {
    // Keep actionable interrupt UX for explicit review/action requests.
    return false;
  }

  const fieldsToInspect = [
    record.when,
    record.reason,
    record.type,
    record.kind,
    record.name,
    record.message,
    record.interrupt,
    record.value,
  ];

  if (
    fieldsToInspect.some((value) =>
      shouldSuppressBreakpointInterrupt(value, seen),
    )
  ) {
    return true;
  }

  try {
    return containsBreakpointSignal(JSON.stringify(record));
  } catch {
    return false;
  }
}

function Interrupt({
  interrupt,
  isLastMessage,
  hasNoAIOrToolMessages,
}: InterruptProps) {
  const fallbackValue = Array.isArray(interrupt)
    ? (interrupt as Record<string, any>[])
    : (((interrupt as { value?: unknown } | undefined)?.value ??
        interrupt) as Record<string, any>);
  const shouldSuppress = shouldSuppressBreakpointInterrupt(fallbackValue);

  if (shouldSuppress) {
    return null;
  }

  return (
    <>
      {isAgentInboxInterruptSchema(interrupt) &&
        (isLastMessage || hasNoAIOrToolMessages) && (
          <ThreadView interrupt={interrupt} />
        )}
      {interrupt &&
      !isAgentInboxInterruptSchema(interrupt) &&
      (isLastMessage || hasNoAIOrToolMessages) ? (
        <GenericInterruptView interrupt={fallbackValue} />
      ) : null}
    </>
  );
}

export function AssistantMessage({
  message,
  allMessages,
  isLoading,
  isReconnecting = false,
  handleRegenerate,
}: {
  message: Message | undefined;
  allMessages: Message[];
  isLoading: boolean;
  isReconnecting?: boolean;
  handleRegenerate: (parentCheckpoint: Checkpoint | null | undefined) => void;
}) {
  const thread = useStreamContext();
  const renderedMessages = getRenderableMessages(allMessages);
  const currentMessageIndex = message?.id
    ? renderedMessages.findIndex(
        (threadMessage) => threadMessage.id === message.id,
      )
    : -1;
  const isLastMessage =
    currentMessageIndex >= 0 &&
    currentMessageIndex === renderedMessages.length - 1;
  const hasNoAIOrToolMessages = !renderedMessages.find((m) =>
    isAiOrToolMessage(m),
  );
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;
  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;

  const content = message?.content ?? [];
  const contentString = getContentString(content);
  const orderedContentParts = getOrderedContentParts(message);
  const orderedSegments = groupOrderedContentParts(orderedContentParts);
  const isToolResult = message?.type === "tool";
  const currentMessageIntermediateParts = getIntermediatePartsFromMessage(
    message,
    message?.id ?? "current",
  );
  const fallbackCommandContent = getIntermediateCopyText(
    currentMessageIntermediateParts,
  );
  const commandContent =
    contentString.trim().length > 0 ? contentString : fallbackCommandContent;

  const textSegments: { key: string; text: string }[] =
    orderedContentParts.length > 0
      ? orderedSegments
          .filter(
            (
              segment,
            ): segment is Extract<OrderedRenderSegment, { kind: "text" }> =>
              segment.kind === "text",
          )
          .map((segment) => ({ key: segment.key, text: segment.text }))
      : contentString.trim().length > 0
        ? [{ key: "fallback-text", text: contentString }]
        : [];

  let groupStartIndex = -1;
  let groupEndIndex = -1;
  if (
    currentMessageIndex >= 0 &&
    isAiOrToolMessage(renderedMessages[currentMessageIndex])
  ) {
    groupStartIndex = currentMessageIndex;
    groupEndIndex = currentMessageIndex;
    while (
      groupStartIndex > 0 &&
      isAiOrToolMessage(renderedMessages[groupStartIndex - 1])
    ) {
      groupStartIndex -= 1;
    }
    while (
      groupEndIndex < renderedMessages.length - 1 &&
      isAiOrToolMessage(renderedMessages[groupEndIndex + 1])
    ) {
      groupEndIndex += 1;
    }
  }

  const groupedMessages =
    groupStartIndex >= 0 && groupEndIndex >= groupStartIndex
      ? renderedMessages.slice(groupStartIndex, groupEndIndex + 1)
      : [];
  const groupedMessageParts = groupedMessages.map((groupMessage, idx) => ({
    message: groupMessage,
    parts: getIntermediatePartsFromMessage(
      groupMessage,
      groupMessage.id ?? `group-${groupStartIndex + idx}`,
    ),
  }));
  const groupedIntermediateParts = groupedMessageParts.flatMap(
    (groupMessage) => groupMessage.parts,
  );
  const firstGroupMessageWithIntermediateId = groupedMessageParts.find(
    (groupMessage) => groupMessage.parts.length > 0,
  )?.message.id;
  const shouldRenderGroupIntermediateTrigger =
    !!message?.id &&
    firstGroupMessageWithIntermediateId != null &&
    message.id === firstGroupMessageWithIntermediateId;
  const isCurrentGroupAtThreadTail =
    groupEndIndex >= 0 && groupEndIndex === renderedMessages.length - 1;
  const groupHasRenderableText = groupedMessages.some((groupMessage) =>
    messageHasRenderableText(groupMessage),
  );
  const isGroupStreaming =
    (isLoading || isReconnecting) &&
    isCurrentGroupAtThreadTail &&
    groupedIntermediateParts.length > 0 &&
    !groupHasRenderableText;
  const shouldRenderInlineActionsForIntermediate =
    shouldRenderGroupIntermediateTrigger &&
    isCurrentGroupAtThreadTail &&
    !groupHasRenderableText &&
    groupedIntermediateParts.length > 0;
  const groupedIntermediateCopyContent = getIntermediateCopyText(
    groupedIntermediateParts,
  );
  const hasCustomComponentsForMessage =
    !!message &&
    !!thread.values.ui?.some((ui) => ui.metadata?.message_id === message.id);
  const shouldRenderInterrupt =
    !!threadInterrupt && (isLastMessage || hasNoAIOrToolMessages);
  const shouldUseFastStreamingMarkdown =
    message?.type === "ai" && isLoading && isLastMessage;
  const shouldHideGroupedPlaceholderMessage =
    !!message &&
    isAiOrToolMessage(message) &&
    !shouldRenderGroupIntermediateTrigger &&
    textSegments.length === 0 &&
    !hasCustomComponentsForMessage &&
    !shouldRenderInterrupt;
  const shouldRenderMessageCommandBar = textSegments.length > 0;

  if (shouldHideGroupedPlaceholderMessage) {
    return null;
  }

  return (
    <div className="group mr-auto flex w-full items-start gap-2">
      <div className="flex w-full flex-col gap-2">
        {shouldRenderGroupIntermediateTrigger ? (
          <IntermediateStepsArtifactTrigger
            parts={groupedIntermediateParts}
            isStreaming={isGroupStreaming}
            isReconnecting={isReconnecting}
            isLoading={isLoading}
            showActions={shouldRenderInlineActionsForIntermediate}
            actionContent={groupedIntermediateCopyContent}
            handleRegenerate={() => handleRegenerate(parentCheckpoint)}
          />
        ) : null}

        {!isToolResult ? (
          <>
            {textSegments.map((segment) => (
              <div
                key={segment.key}
                className="py-1"
              >
                <MarkdownText streaming={shouldUseFastStreamingMarkdown}>
                  {segment.text}
                </MarkdownText>
              </div>
            ))}

            {message && (
              <CustomComponent
                message={message}
                thread={thread}
              />
            )}

            <Interrupt
              interrupt={threadInterrupt}
              isLastMessage={isLastMessage}
              hasNoAIOrToolMessages={hasNoAIOrToolMessages}
            />

            {shouldRenderMessageCommandBar ? (
              <div
                className={cn(
                  "mr-auto flex items-center gap-2 transition-opacity",
                  "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                )}
              >
                <BranchSwitcher
                  branch={meta?.branch}
                  branchOptions={meta?.branchOptions}
                  onSelect={(branch) => thread.setBranch(branch)}
                  isLoading={isLoading}
                />
                <CommandBar
                  content={commandContent}
                  isLoading={isLoading}
                  isAiMessage={true}
                  handleRegenerate={() => handleRegenerate(parentCheckpoint)}
                />
              </div>
            ) : null}
          </>
        ) : (
          <Interrupt
            interrupt={threadInterrupt}
            isLastMessage={isLastMessage}
            hasNoAIOrToolMessages={hasNoAIOrToolMessages}
          />
        )}
      </div>
    </div>
  );
}

export function AssistantMessageLoading() {
  return (
    <div className="mr-auto flex items-start gap-2">
      <div className="bg-muted flex h-8 items-center gap-1 rounded-2xl px-4 py-2">
        <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full"></div>
        <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_0.5s_infinite] rounded-full"></div>
        <div className="bg-foreground/50 h-1.5 w-1.5 animate-[pulse_1.5s_ease-in-out_1s_infinite] rounded-full"></div>
      </div>
    </div>
  );
}
