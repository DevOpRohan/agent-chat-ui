import { parsePartialJson } from "@langchain/core/output_parsers";
import { useStreamContext } from "@/providers/Stream";
import { AIMessage, Checkpoint, Message } from "@langchain/langgraph-sdk";
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
import { useQueryState, parseAsBoolean } from "nuqs";
import { GenericInterruptView } from "./generic-interrupt";
import { useArtifact } from "../artifact";
import { useEffect, useState } from "react";

const REASONING_PREVIEW_CHARS = 500;
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
      collected
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );

  return uniqueReasoning.join("\n\n");
}

function getReasoningPreview(text: string): string {
  if (text.length <= REASONING_PREVIEW_CHARS) return text;
  return text.slice(-REASONING_PREVIEW_CHARS);
}

function isToolCallLikeType(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return (
    value === "tool_use" ||
    value === "tool_call" ||
    value.endsWith("_call")
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

function getOrderedContentParts(message: Message | undefined): OrderedContentPart[] {
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
      const textValue = readTextValue(record.text ?? record.content).join("\n\n");
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

function shouldRenderReasoningFirst(message: Message | undefined): boolean {
  if (!message) return false;
  if (!Array.isArray(message.content)) return false;

  const contentBlocks = message.content as unknown[];
  let firstReasoningIdx = Number.POSITIVE_INFINITY;
  let firstTextIdx = Number.POSITIVE_INFINITY;

  for (let idx = 0; idx < contentBlocks.length; idx += 1) {
    const block = contentBlocks[idx];
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;

    const type = record.type;
    const isTextBlock = type === "text" || type === "output_text";
    const isReasoningBlock =
      isReasoningLikeType(type) ||
      "reasoning" in record ||
      "thinking" in record ||
      "reasoning_content" in record;

    if (isReasoningBlock && firstReasoningIdx === Number.POSITIVE_INFINITY) {
      firstReasoningIdx = idx;
    }
    if (isTextBlock && firstTextIdx === Number.POSITIVE_INFINITY) {
      firstTextIdx = idx;
    }
  }

  if (firstReasoningIdx !== Number.POSITIVE_INFINITY && firstTextIdx !== Number.POSITIVE_INFINITY) {
    return firstReasoningIdx <= firstTextIdx;
  }

  return firstReasoningIdx !== Number.POSITIVE_INFINITY;
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
  const customComponents = values.ui?.filter(
    (ui) => ui.metadata?.message_id === message.id,
  );

  if (!customComponents?.length) return null;
  return (
    <Fragment key={message.id}>
      {customComponents.map((customComponent) => (
        <LoadExternalComponent
          key={customComponent.id}
          stream={thread}
          message={customComponent}
          meta={{ ui: customComponent, artifact }}
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

interface InterruptProps {
  interrupt?: unknown;
  isLastMessage: boolean;
  hasNoAIOrToolMessages: boolean;
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
  isLoading,
  handleRegenerate,
}: {
  message: Message | undefined;
  isLoading: boolean;
  handleRegenerate: (parentCheckpoint: Checkpoint | null | undefined) => void;
}) {
  const content = message?.content ?? [];
  const contentString = getContentString(content);
  const reasoningText = extractReasoningText(message);
  const reasoningPreview = getReasoningPreview(reasoningText);
  const orderedContentParts = getOrderedContentParts(message);
  const hasOrderedContentParts = orderedContentParts.length > 0;
  const hasOrderedReasoning = orderedContentParts.some(
    (part) => part.kind === "reasoning",
  );
  const hasInlineToolCalls = orderedContentParts.some(
    (part) => part.kind === "tool_calls",
  );
  const renderReasoningFirst = shouldRenderReasoningFirst(message);
  const [reasoningOrderLockedFirst, setReasoningOrderLockedFirst] = useState(false);
  const [hideToolCalls] = useQueryState(
    "hideToolCalls",
    parseAsBoolean.withDefault(false),
  );

  const thread = useStreamContext();
  const isLastMessage =
    thread.messages[thread.messages.length - 1].id === message?.id;
  const hasNoAIOrToolMessages = !thread.messages.find(
    (m) => m.type === "ai" || m.type === "tool",
  );
  const meta = message ? thread.getMessagesMetadata(message) : undefined;
  const threadInterrupt = thread.interrupt;

  const parentCheckpoint = meta?.firstSeenState?.parent_checkpoint;
  const anthropicStreamedToolCalls = Array.isArray(content)
    ? parseAnthropicStreamedToolCalls(content)
    : undefined;

  const hasToolCalls =
    message &&
    "tool_calls" in message &&
    message.tool_calls &&
    message.tool_calls.length > 0;
  const toolCallsHaveContents =
    hasToolCalls &&
    message.tool_calls?.some(
      (tc) => tc.args && Object.keys(tc.args).length > 0,
    );
  const hasAnthropicToolCalls = !!anthropicStreamedToolCalls?.length;
  const isToolResult = message?.type === "tool";

  useEffect(() => {
    if (reasoningPreview.length > 0 && contentString.length === 0) {
      setReasoningOrderLockedFirst(true);
    }
  }, [reasoningPreview, contentString]);

  if (isToolResult && hideToolCalls) {
    return null;
  }

  const shouldRenderReasoningAboveText =
    renderReasoningFirst || reasoningOrderLockedFirst;

  const reasoningPreviewPanel =
    reasoningPreview.length > 0 ? (
      <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none font-medium text-slate-700">
          Thinking (latest {REASONING_PREVIEW_CHARS} chars)
        </summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
          {reasoningPreview}
        </pre>
      </details>
    ) : null;

  return (
    <div className="group mr-auto flex w-full items-start gap-2">
      <div className="flex w-full flex-col gap-2">
        {isToolResult ? (
          <>
            <ToolResult message={message} />
            <Interrupt
              interrupt={threadInterrupt}
              isLastMessage={isLastMessage}
              hasNoAIOrToolMessages={hasNoAIOrToolMessages}
            />
          </>
        ) : (
          <>
            {hasOrderedContentParts ? (
              <>
                {orderedContentParts.map((part) => {
                  if (part.kind === "text") {
                    return (
                      <div
                        key={part.key}
                        className="py-1"
                      >
                        <MarkdownText>{part.text}</MarkdownText>
                      </div>
                    );
                  }

                  if (part.kind === "reasoning") {
                    const partReasoningPreview = getReasoningPreview(part.text);
                    return (
                      <details
                        key={part.key}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
                      >
                        <summary className="cursor-pointer select-none font-medium text-slate-700">
                          Thinking (latest {REASONING_PREVIEW_CHARS} chars)
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
                          {partReasoningPreview}
                        </pre>
                      </details>
                    );
                  }

                  return hideToolCalls ? null : (
                    <ToolCalls
                      key={part.key}
                      toolCalls={part.toolCalls}
                    />
                  );
                })}
                {!hasOrderedReasoning && reasoningPreviewPanel}
              </>
            ) : (
              <>
                {shouldRenderReasoningAboveText && reasoningPreviewPanel}
                {contentString.length > 0 && (
                  <div className="py-1">
                    <MarkdownText>{contentString}</MarkdownText>
                  </div>
                )}
                {!shouldRenderReasoningAboveText && reasoningPreviewPanel}
              </>
            )}

            {!hideToolCalls && !hasInlineToolCalls && (
              <>
                {(hasToolCalls && toolCallsHaveContents && (
                  <ToolCalls toolCalls={message.tool_calls} />
                )) ||
                  (hasAnthropicToolCalls && (
                    <ToolCalls toolCalls={anthropicStreamedToolCalls} />
                  )) ||
                  (hasToolCalls && (
                    <ToolCalls toolCalls={message.tool_calls} />
                  ))}
              </>
            )}

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
                content={contentString}
                isLoading={isLoading}
                isAiMessage={true}
                handleRegenerate={() => handleRegenerate(parentCheckpoint)}
              />
            </div>
          </>
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
