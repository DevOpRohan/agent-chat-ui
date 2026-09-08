import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Message } from "@langchain/langgraph-sdk";
import * as Tooltip from "@radix-ui/react-tooltip";
import * as Dialog from "@radix-ui/react-dialog";
import { List, Search, X } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { getContentString } from "./utils";

type ConversationTurn = {
  key: string;
  messageIndex: number;
  prompt: string;
  response: string;
  searchText: string;
};

function plainText(message: Message) {
  return getContentString(message.content)
    .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readingIndex(scroll: HTMLElement, content: HTMLElement) {
  const readingLine = scroll.getBoundingClientRect().top + 80;
  let index = 0;
  content
    .querySelectorAll<HTMLElement>("[data-conversation-turn]")
    .forEach((anchor, anchorIndex) => {
      if (anchor.getBoundingClientRect().top <= readingLine)
        index = anchorIndex;
    });
  return index;
}

export function ConversationNavigator({
  messages,
  triggerContainer,
  isWorking,
  onRailVisibilityChange,
}: {
  messages: Message[];
  triggerContainer: HTMLElement | null;
  isWorking: boolean;
  onRailVisibilityChange: (visible: boolean) => void;
}) {
  const { scrollRef, contentRef, stopScroll } = useStickToBottomContext();
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const [layout, setLayout] = useState({ width: 0, overflow: false });
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [railEdges, setRailEdges] = useState({ top: false, bottom: false });
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const railRef = useRef<HTMLElement>(null);
  const outlineListRef = useRef<HTMLDivElement>(null);
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const turns = useMemo(() => {
    const result: ConversationTurn[] = [];
    messages.forEach((message, messageIndex) => {
      const text = plainText(message);
      if (message.type === "human") {
        result.push({
          key: message.id || `turn-${messageIndex}`,
          messageIndex,
          prompt: text.slice(0, 240) || "Attachment message",
          response: "",
          searchText: text.toLocaleLowerCase(),
        });
      } else if (message.type === "ai" && result.length > 0) {
        const turn = result[result.length - 1];
        if (!turn.response && text) {
          turn.response = text.slice(0, 240);
          turn.searchText += ` ${text.toLocaleLowerCase()}`;
        }
      }
    });
    return result;
  }, [messages]);
  const turnKey = turns
    .map((turn) => `${turn.key}:${turn.messageIndex}`)
    .join(",");
  const visible = turns.length >= 3 && layout.overflow;
  const showRail = visible && canHover && layout.width >= 640;
  const showOutlineTrigger = visible && (!showRail || turns.length >= 12);
  const currentIndex = Math.min(activeIndex, Math.max(0, turns.length - 1));
  const interactionIndex = hoveredIndex ?? keyboardIndex;

  useEffect(() => {
    onRailVisibilityChange(showRail);
  }, [onRailVisibilityChange, showRail]);
  useEffect(
    () => () => onRailVisibilityChange(false),
    [onRailVisibilityChange],
  );

  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setActiveIndex(readingIndex(scroll, content));
      const width = scroll.clientWidth;
      const overflow = scroll.scrollHeight > scroll.clientHeight + 8;
      setLayout((previous) =>
        previous.width === width && previous.overflow === overflow
          ? previous
          : { width, overflow },
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    observer.observe(content);
    scroll.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", schedule);
    };
  }, [contentRef, scrollRef, turnKey]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !showRail) return;
    const updateEdges = () =>
      setRailEdges({
        top: rail.scrollTop > 1,
        bottom: rail.scrollTop + rail.clientHeight < rail.scrollHeight - 1,
      });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(rail);
    rail.addEventListener("scroll", updateEdges, { passive: true });
    updateEdges();
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", updateEdges);
    };
  }, [showRail, turns.length]);

  // Scroll only the marker list, never its ancestors or the conversation.
  useEffect(() => {
    const rail = railRef.current;
    const marker =
      markerRefs.current[
        Math.min(focusedIndex ?? currentIndex, turns.length - 1)
      ];
    if (!rail || !marker || hoveredIndex !== null) return;
    if (marker.offsetTop < rail.scrollTop) rail.scrollTop = marker.offsetTop;
    else if (
      marker.offsetTop + marker.offsetHeight >
      rail.scrollTop + rail.clientHeight
    ) {
      rail.scrollTop =
        marker.offsetTop + marker.offsetHeight - rail.clientHeight;
    }
  }, [currentIndex, focusedIndex, hoveredIndex, showRail, turns.length]);

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
  const responsePreview = (turn: ConversationTurn, index: number) =>
    turn.response ||
    (isWorking && index === turns.length - 1 ? "Waiting for a response…" : "");
  const filteredTurns = turns
    .map((turn, index) => ({ turn, index }))
    .filter(
      ({ turn }) =>
        !query.trim() ||
        turn.searchText.includes(query.trim().toLocaleLowerCase()),
    );

  if (!visible) return null;

  return (
    <Tooltip.Provider
      delayDuration={180}
      skipDelayDuration={100}
    >
      {showRail && (
        <nav
          ref={railRef}
          aria-label="Conversation navigator"
          className="absolute top-1/2 left-0 z-20 max-h-[min(40%,24rem)] w-16 -translate-y-1/2 overflow-x-hidden overflow-y-auto overscroll-contain py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage: `linear-gradient(to bottom, ${railEdges.top ? "transparent" : "black"}, black 8px, black calc(100% - 8px), ${railEdges.bottom ? "transparent" : "black"})`,
          }}
          onPointerLeave={() => setHoveredIndex(null)}
        >
          <ol>
            {turns.map((turn, index) => {
              const distance =
                interactionIndex === null
                  ? Infinity
                  : Math.abs(index - interactionIndex);
              const tickWidth = [52, 36, 24, 16][distance] ?? 12;
              return (
                <li key={turn.key}>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <button
                        ref={(node) => {
                          markerRefs.current[index] = node;
                        }}
                        type="button"
                        aria-label={`Turn ${index + 1}: ${turn.prompt}`}
                        aria-current={
                          index === currentIndex ? "location" : undefined
                        }
                        tabIndex={
                          index ===
                          Math.min(
                            focusedIndex ?? currentIndex,
                            turns.length - 1,
                          )
                            ? 0
                            : -1
                        }
                        className="focus-visible:ring-ring flex h-6 w-full cursor-pointer items-center rounded-sm pl-2 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        onPointerEnter={() => setHoveredIndex(index)}
                        onPointerDown={() => setKeyboardIndex(null)}
                        onClick={() => jumpToTurn(index)}
                        onFocus={(event) => {
                          setFocusedIndex(index);
                          if (event.currentTarget.matches(":focus-visible"))
                            setKeyboardIndex(index);
                        }}
                        onBlur={() => {
                          setFocusedIndex(null);
                          setKeyboardIndex(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setHoveredIndex(null);
                            setKeyboardIndex(null);
                            return;
                          }
                          let next = index;
                          if (event.key === "ArrowDown") next++;
                          else if (event.key === "ArrowUp") next--;
                          else if (event.key === "PageDown") next += 10;
                          else if (event.key === "PageUp") next -= 10;
                          else if (event.key === "Home") next = 0;
                          else if (event.key === "End") next = turns.length - 1;
                          else return;
                          event.preventDefault();
                          next = Math.min(Math.max(0, next), turns.length - 1);
                          setHoveredIndex(null);
                          setKeyboardIndex(next);
                          markerRefs.current[next]?.focus({
                            preventScroll: true,
                          });
                        }}
                      >
                        <span
                          data-testid="conversation-tick"
                          aria-hidden="true"
                          style={{ width: tickWidth }}
                          className={cn(
                            "bg-muted-foreground/30 h-0.5 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none",
                            index === currentIndex && "bg-foreground/65",
                            distance === 0 && "bg-foreground",
                          )}
                        />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="right"
                        sideOffset={8}
                        collisionPadding={12}
                        onEscapeKeyDown={() => {
                          setHoveredIndex(null);
                          setKeyboardIndex(null);
                        }}
                        className="bg-popover text-popover-foreground z-50 w-80 max-w-[calc(100vw-4rem)] rounded-2xl border p-4 shadow-lg"
                      >
                        <p className="mb-1 line-clamp-2 text-sm font-medium break-words">
                          {turn.prompt}
                        </p>
                        {responsePreview(turn, index) && (
                          <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed break-words">
                            {responsePreview(turn, index)}
                          </p>
                        )}
                        <p className="text-muted-foreground/70 mt-2 text-[11px] tabular-nums">
                          {index + 1} / {turns.length}
                        </p>
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      {showOutlineTrigger &&
        triggerContainer &&
        createPortal(
          <Dialog.Root
            open={outlineOpen}
            onOpenChange={(open) => {
              if (open) {
                // Hold the reader's place while they explore the outline.
                stopScroll();
                const scroll = scrollRef.current;
                const content = contentRef.current;
                if (scroll && content)
                  setActiveIndex(readingIndex(scroll, content));
                setQuery("");
              }
              setOutlineOpen(open);
            }}
          >
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Dialog.Trigger asChild>
                  <button
                    ref={outlineTriggerRef}
                    type="button"
                    aria-label="Conversation outline"
                    className="hover:bg-accent focus-visible:ring-ring inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2"
                  >
                    <List
                      className="size-5"
                      aria-hidden="true"
                    />
                  </button>
                </Dialog.Trigger>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  sideOffset={8}
                  className="bg-popover text-popover-foreground z-50 rounded-lg border px-3 py-2 text-xs shadow-sm"
                >
                  Conversation outline
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Dialog.Portal>
              <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/30 motion-reduce:animate-none" />
              <Dialog.Content
                aria-describedby="conversation-outline-description"
                className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] max-w-xl flex-col rounded-t-2xl border shadow-xl outline-none motion-reduce:animate-none sm:bottom-6 sm:max-h-[70dvh] sm:rounded-2xl"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  const list = outlineListRef.current;
                  const row = list?.querySelector<HTMLElement>(
                    `[data-turn-index="${currentIndex}"]`,
                  );
                  if (list && row) {
                    list.scrollTop =
                      row.offsetTop - list.offsetTop - list.clientHeight / 2;
                    row.focus({ preventScroll: true });
                  }
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  outlineTriggerRef.current?.focus({ preventScroll: true });
                }}
              >
                <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
                  <div>
                    <Dialog.Title className="text-base font-semibold">
                      Conversation
                    </Dialog.Title>
                    <Dialog.Description
                      id="conversation-outline-description"
                      className="text-muted-foreground mt-1 text-xs"
                    >
                      {turns.length} turns · Choose a message to jump to it
                    </Dialog.Description>
                  </div>
                  <Dialog.Close
                    aria-label="Close conversation outline"
                    className="hover:bg-accent focus-visible:ring-ring -mt-2 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none focus-visible:ring-2"
                  >
                    <X className="size-4" />
                  </Dialog.Close>
                </div>
                {turns.length >= 12 && (
                  <label className="bg-muted/50 mx-4 mb-3 flex items-center gap-2 rounded-lg border px-3">
                    <Search
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <input
                      aria-label="Find a message"
                      placeholder="Find a message…"
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-3 text-base outline-none sm:text-sm"
                    />
                  </label>
                )}
                <div
                  ref={outlineListRef}
                  className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
                >
                  <ol>
                    {filteredTurns.map(({ turn, index }) => (
                      <li key={turn.key}>
                        <button
                          type="button"
                          data-turn-index={index}
                          aria-current={
                            index === currentIndex ? "location" : undefined
                          }
                          aria-label={`Turn ${index + 1}: ${turn.prompt}`}
                          onClick={() => {
                            jumpToTurn(index);
                            setOutlineOpen(false);
                          }}
                          className={cn(
                            "hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-xl px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
                            index === currentIndex && "bg-accent/60",
                          )}
                        >
                          <span className="text-muted-foreground mt-0.5 w-7 shrink-0 text-right text-xs tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-sm font-medium break-words">
                              {turn.prompt}
                            </span>
                            {responsePreview(turn, index) && (
                              <span className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed break-words">
                                {responsePreview(turn, index)}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {filteredTurns.length === 0 && (
                    <p
                      role="status"
                      className="text-muted-foreground px-4 py-8 text-center text-sm"
                    >
                      No matching messages. Try a different phrase.
                    </p>
                  )}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>,
          triggerContainer,
        )}
    </Tooltip.Provider>
  );
}
