import { AIMessage, ToolMessage } from "@langchain/langgraph-sdk";
import { parsePartialJson } from "@langchain/core/output_parsers";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";

function isComplexValue(value: any): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  if (!value) return {};

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = parsePartialJson(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to raw input shape.
    }
    return { input: value };
  }

  if (Array.isArray(value)) {
    return { value };
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return { value };
}

function getToolCallRenderKey(
  toolCall: NonNullable<AIMessage["tool_calls"]>[number],
  idx: number,
): string {
  if (typeof toolCall.id === "string" && toolCall.id.trim().length > 0) {
    return toolCall.id.trim();
  }

  if (typeof toolCall.name === "string" && toolCall.name.trim().length > 0) {
    return `${toolCall.name.trim()}-${idx}`;
  }

  return `tool-call-${idx}`;
}

function isInputOnlyArgs(args: Record<string, unknown>): boolean {
  const keys = Object.keys(args);
  return keys.length === 1 && keys[0] === "input";
}

export function ToolCalls({
  toolCalls,
}: {
  toolCalls: AIMessage["tool_calls"];
}) {
  const argsCacheRef = useRef<Record<string, Record<string, unknown>>>({});
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="mx-auto grid max-w-3xl grid-rows-[1fr_auto] gap-2">
      {toolCalls.map((tc, idx) => {
        const toolCallKey = getToolCallRenderKey(tc, idx);
        const incomingArgs = normalizeToolArgs(tc.args);
        const cachedArgs = argsCacheRef.current[toolCallKey];
        const shouldUseCachedArgs =
          !!cachedArgs &&
          Object.keys(cachedArgs).length > 0 &&
          (Object.keys(incomingArgs).length === 0 ||
            isInputOnlyArgs(incomingArgs));
        const args = shouldUseCachedArgs ? cachedArgs : incomingArgs;

        if (Object.keys(args).length > 0) {
          argsCacheRef.current[toolCallKey] = args;
        }
        const hasArgs = Object.keys(args).length > 0;
        return (
          <div
            key={toolCallKey}
            className="border-border overflow-hidden rounded-lg border"
          >
            <div className="bg-muted/50 border-border border-b px-4 py-2">
              <h3 className="text-foreground font-medium">
                {tc.name}
                {tc.id && (
                  <code className="bg-muted ml-2 rounded px-2 py-1 text-sm">
                    {tc.id}
                  </code>
                )}
              </h3>
            </div>
            {hasArgs ? (
              <table className="divide-border min-w-full divide-y">
                <tbody className="divide-border divide-y">
                  {Object.entries(args).map(([argKey, value]) => (
                    <tr key={argKey}>
                      <td className="text-foreground px-4 py-2 text-sm font-medium whitespace-nowrap">
                        {argKey}
                      </td>
                      <td className="text-muted-foreground px-4 py-2 text-sm">
                        <pre className="bg-card text-card-foreground border-border max-h-[320px] overflow-auto rounded border px-3 py-2 font-mono text-sm break-words whitespace-pre-wrap">
                          {isComplexValue(value)
                            ? JSON.stringify(value, null, 4)
                            : String(value)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <code className="block p-3 text-sm">{"{}"}</code>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ToolResult({ message }: { message: ToolMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);

  let parsedContent: any;
  let isJsonContent = false;

  try {
    if (typeof message.content === "string") {
      parsedContent = JSON.parse(message.content);
      isJsonContent = isComplexValue(parsedContent);
    }
  } catch {
    // Content is not JSON, use as is
    parsedContent = message.content;
  }

  const contentStr = isJsonContent
    ? JSON.stringify(parsedContent, null, 4)
    : String(message.content);
  const contentLines = contentStr.split("\n");
  const shouldTruncate = contentLines.length > 4 || contentStr.length > 500;
  const displayedContent =
    shouldTruncate && !isExpanded
      ? contentStr.length > 500
        ? contentStr.slice(0, 500) + "..."
        : contentLines.slice(0, 4).join("\n") + "\n..."
      : contentStr;

  return (
    <div className="mx-auto grid max-w-3xl grid-rows-[1fr_auto] gap-2">
      <div className="border-border overflow-hidden rounded-lg border">
        <div className="bg-muted/50 border-border border-b px-4 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {message.name ? (
              <h3 className="text-foreground font-medium">
                Tool Result:{" "}
                <code className="bg-muted rounded px-2 py-1">
                  {message.name}
                </code>
              </h3>
            ) : (
              <h3 className="text-foreground font-medium">Tool Result</h3>
            )}
            {message.tool_call_id && (
              <code className="bg-muted ml-2 rounded px-2 py-1 text-sm">
                {message.tool_call_id}
              </code>
            )}
          </div>
        </div>
        <motion.div
          className="bg-muted/50 min-w-full"
          initial={false}
          animate={{ height: "auto" }}
          transition={{ duration: 0.3 }}
        >
          <div className="p-3">
            <AnimatePresence
              mode="wait"
              initial={false}
            >
              <motion.div
                key={isExpanded ? "expanded" : "collapsed"}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2 }}
              >
                <pre className="bg-card text-card-foreground border-border max-h-[400px] overflow-auto rounded border px-3 py-2 font-mono text-sm break-words whitespace-pre-wrap">
                  {displayedContent}
                </pre>
              </motion.div>
            </AnimatePresence>
          </div>
          {shouldTruncate && (
            <motion.button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-muted-foreground hover:text-foreground border-border hover:bg-muted flex w-full cursor-pointer items-center justify-center border-t-[1px] py-2 transition-all duration-200 ease-in-out"
              initial={{ scale: 1 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isExpanded ? <ChevronUp /> : <ChevronDown />}
            </motion.button>
          )}
        </motion.div>
      </div>
    </div>
  );
}
