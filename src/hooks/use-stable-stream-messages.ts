import { Message } from "@langchain/langgraph-sdk";
import { useMemo, useRef } from "react";

const DEBUG_STABLE_STREAM_MESSAGES = false;

type TailSnapshot = {
  contextKey: string;
  messageKey: string;
  comparableText: string;
  message: Message;
};

function cloneMessage(message: Message): Message {
  return JSON.parse(JSON.stringify(message)) as Message;
}

function readTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => readTextFragments(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [record.text, record.content, record.value].flatMap((field) =>
    readTextFragments(field),
  );
}

function extractComparableAiText(message: Message | undefined): string {
  if (!message || message.type !== "ai") {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  const fragments: string[] = [];

  for (const block of message.content as unknown[]) {
    if (typeof block === "string") {
      if (block.length > 0) {
        fragments.push(block);
      }
      continue;
    }

    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    const isTextLike = type === "text" || type === "output_text";

    if (isTextLike) {
      const textFragments = readTextFragments(
        record.text ?? record.content ?? record.value,
      );
      if (textFragments.length > 0) {
        fragments.push(textFragments.join("\n"));
        continue;
      }
    }

    const fallbackText = readTextFragments(record.text ?? record.content);
    if (fallbackText.length > 0) {
      fragments.push(fallbackText.join("\n"));
      continue;
    }

    try {
      fragments.push(JSON.stringify(record));
    } catch {
      // Ignore blocks that cannot be stringified.
    }
  }

  if (fragments.length > 0) {
    return fragments.join("\n");
  }

  try {
    return JSON.stringify(message.content);
  } catch {
    return "";
  }
}

function getMessageKey(message: Message, index: number): string {
  return message.id ?? `index:${index}`;
}

function isPrefixRegression(previousText: string, incomingText: string): boolean {
  return (
    incomingText.length < previousText.length &&
    previousText.startsWith(incomingText)
  );
}

type UseStableStreamMessagesArgs = {
  messages: Message[];
  threadId: string | null | undefined;
  branch: string | null | undefined;
};

export function useStableStreamMessages({
  messages,
  threadId,
  branch,
}: UseStableStreamMessagesArgs): Message[] {
  const snapshotRef = useRef<TailSnapshot | null>(null);
  const contextKey = `${threadId ?? "no-thread"}::${branch ?? ""}`;

  return useMemo(() => {
    const previousSnapshot = snapshotRef.current;
    if (previousSnapshot && previousSnapshot.contextKey !== contextKey) {
      if (DEBUG_STABLE_STREAM_MESSAGES) {
        console.debug("[useStableStreamMessages] resetting tail snapshot", {
          from: previousSnapshot.contextKey,
          to: contextKey,
        });
      }
      snapshotRef.current = null;
    }

    let tailAiMessageIndex = -1;
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      if (messages[idx]?.type === "ai") {
        tailAiMessageIndex = idx;
        break;
      }
    }

    if (tailAiMessageIndex < 0) {
      return messages;
    }

    const tailMessage = messages[tailAiMessageIndex];
    const messageKey = getMessageKey(tailMessage, tailAiMessageIndex);
    const incomingText = extractComparableAiText(tailMessage);
    const snapshot = snapshotRef.current;

    if (
      !snapshot ||
      snapshot.contextKey !== contextKey ||
      snapshot.messageKey !== messageKey
    ) {
      snapshotRef.current = {
        contextKey,
        messageKey,
        comparableText: incomingText,
        message: cloneMessage(tailMessage),
      };
      return messages;
    }

    if (isPrefixRegression(snapshot.comparableText, incomingText)) {
      if (DEBUG_STABLE_STREAM_MESSAGES) {
        console.debug(
          "[useStableStreamMessages] patched tail AI regression during stream-to-history handoff",
          {
            messageKey,
            previousLength: snapshot.comparableText.length,
            incomingLength: incomingText.length,
          },
        );
      }

      const patchedMessages = messages.slice();
      patchedMessages[tailAiMessageIndex] = snapshot.message;
      return patchedMessages;
    }

    if (incomingText !== snapshot.comparableText) {
      snapshotRef.current = {
        contextKey,
        messageKey,
        comparableText: incomingText,
        message: cloneMessage(tailMessage),
      };
    }

    return messages;
  }, [contextKey, messages]);
}
