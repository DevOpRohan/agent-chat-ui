"use client";

import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { APP_MODES, type AppModeId, useAppMode } from "@/lib/app-mode";
import { cn } from "@/lib/utils";

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * The mode chosen on the switch (keyboard or click), until its radio has focus. Each mode's top bar
 * renders its own switch, so the one that receives the focus is usually a new one, mounted after
 * the change. Only a choice made on the switch sets it, so a page load never moves the focus.
 */
let focusAfterSwitch: AppModeId | null = null;

/** Crafter | Ingester switch: a radio group with a roving tab stop. */
export function ModeSwitch(props?: { className?: string }) {
  const { mode, setMode } = useAppMode();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (focusAfterSwitch !== mode.id) return;
    focusAfterSwitch = null;
    optionRefs.current[APP_MODES.findIndex((m) => m.id === mode.id)]?.focus();
  }, [mode.id]);

  const selectAt = (index: number) => {
    const count = APP_MODES.length;
    const nextIndex = ((index % count) + count) % count;
    const next = APP_MODES[nextIndex];
    if (next.id !== mode.id) {
      focusAfterSwitch = next.id;
      setMode(next.id);
    }
    optionRefs.current[nextIndex]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (NEXT_KEYS.has(event.key)) selectAt(index + 1);
    else if (PREVIOUS_KEYS.has(event.key)) selectAt(index - 1);
    else if (event.key === "Home") selectAt(0);
    else if (event.key === "End") selectAt(APP_MODES.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      data-testid="mode-switch"
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md border p-0.5",
        props?.className,
      )}
    >
      {APP_MODES.map((option, index) => {
        const selected = option.id === mode.id;
        return (
          <Button
            key={option.id}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-mode={option.id}
            variant="ghost"
            size="sm"
            className={cn(
              "px-2 sm:px-3",
              selected
                ? "bg-accent text-accent-foreground hover:bg-accent"
                : "text-muted-foreground hover:text-accent-foreground",
            )}
            onClick={() => {
              if (selected) return;
              focusAfterSwitch = option.id;
              setMode(option.id);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
