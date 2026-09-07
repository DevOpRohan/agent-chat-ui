import { useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@langchain/langgraph-sdk";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";
import { getContentString } from "./utils";

type ConversationTurn = {
  messageIndex: number;
  prompt: string;
  response: string;
};

function previewText(message: Message) {
  return getContentString(message.content)
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function ConversationNavigator({ messages }: { messages: Message[] }) {
  const { scrollRef, contentRef, stopScroll } = useStickToBottomContext();
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const railRef = useRef<HTMLElement>(null);
  const turns = useMemo(() => {
    const result: ConversationTurn[] = [];
    messages.forEach((message, messageIndex) => {
      if (message.type === "human") {
        result.push({
          messageIndex,
          prompt: previewText(message) || "Attachment message",
          response: "",
        });
      } else if (message.type === "ai" && result.length > 0) {
        const turn = result[result.length - 1];
        if (!turn.response) turn.response = previewText(message);
      }
    });
    return result;
  }, [messages]);
  const turnKey = turns.map((turn) => turn.messageIndex).join(",");

  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content || !turnKey) return;

    let frame = 0;
    const updateActiveTurn = () => {
      frame = 0;
      const anchors = content.querySelectorAll<HTMLElement>(
        "[data-conversation-turn]",
      );
      const readingLine = scroll.getBoundingClientRect().top + 80;
      let nextIndex = 0;
      anchors.forEach((anchor, index) => {
        if (anchor.getBoundingClientRect().top <= readingLine)
          nextIndex = index;
      });
      setActiveIndex(nextIndex);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updateActiveTurn);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroll);
    observer.observe(content);
    scroll.addEventListener("scroll", scheduleUpdate, { passive: true });
    scheduleUpdate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", scheduleUpdate);
    };
  }, [contentRef, scrollRef, turnKey]);

  // Keep the current marker in the bounded rail without scrolling the chat.
  useEffect(() => {
    const rail = railRef.current;
    const marker = markerRefs.current[focusedIndex ?? activeIndex];
    if (!rail || !marker) return;
    const top = marker.offsetTop;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (top + marker.offsetHeight > rail.scrollTop + rail.clientHeight) {
      rail.scrollTop = top + marker.offsetHeight - rail.clientHeight;
    }
  }, [activeIndex, focusedIndex, turns.length]);

  if (turns.length < 3) return null;

  const jumpToTurn = (index: number) => {
    const scroll = scrollRef.current;
    const anchor = contentRef.current?.querySelector<HTMLElement>(
      `[data-conversation-turn="${turns[index].messageIndex}"]`,
    );
    if (!scroll || !anchor) return;
    stopScroll();
    scroll.scrollTo({
      top:
        scroll.scrollTop +
        anchor.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top -
        32,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  };

  return (
    <Tooltip.Provider
      delayDuration={150}
      skipDelayDuration={100}
    >
      <nav
        ref={railRef}
        aria-label="Conversation navigator"
        className="absolute top-1/2 left-0 z-20 max-h-[min(40%,20rem)] w-9 -translate-y-1/2 overflow-x-hidden overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] sm:w-12 [&::-webkit-scrollbar]:hidden"
      >
        <ol>
          {turns.map((turn, index) => (
            <li key={turn.messageIndex}>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    ref={(node) => {
                      markerRefs.current[index] = node;
                    }}
                    type="button"
                    aria-label={`Turn ${index + 1}: ${turn.prompt}`}
                    aria-current={
                      index === activeIndex ? "location" : undefined
                    }
                    tabIndex={index === (focusedIndex ?? activeIndex) ? 0 : -1}
                    className="group focus-visible:bg-accent focus-visible:ring-ring flex h-6 w-full cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    onClick={() => jumpToTurn(index)}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowDown")
                        next = Math.min(index + 1, turns.length - 1);
                      else if (event.key === "ArrowUp")
                        next = Math.max(index - 1, 0);
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = turns.length - 1;
                      else return;
                      event.preventDefault();
                      markerRefs.current[next]?.focus({ preventScroll: true });
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "bg-muted-foreground/30 group-hover:bg-foreground/70 group-focus-visible:bg-foreground/70 h-0.5 w-3 rounded-full transition-[width,background-color] motion-reduce:transition-none sm:w-4",
                        index === activeIndex && "bg-foreground w-5 sm:w-7",
                      )}
                    />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={4}
                    collisionPadding={12}
                    className="bg-popover text-popover-foreground z-50 w-72 max-w-[calc(100vw-4rem)] rounded-xl border p-3 shadow-lg"
                  >
                    <p className="text-muted-foreground mb-1 text-xs">
                      Turn {index + 1} of {turns.length}
                    </p>
                    <p className="line-clamp-2 text-sm font-medium break-words">
                      {turn.prompt}
                    </p>
                    {turn.response && (
                      <p className="text-muted-foreground mt-1 line-clamp-3 text-sm break-words">
                        {turn.response}
                      </p>
                    )}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </li>
          ))}
        </ol>
      </nav>
    </Tooltip.Provider>
  );
}
