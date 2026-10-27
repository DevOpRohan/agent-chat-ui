"use client";

import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { APP_MODES, type AppModeId, useAppMode } from "@/lib/app-mode";
import { cn } from "@/lib/utils";

/**
 * The mode chosen in the menu, until its button has focus. Each mode's top bar renders its own
 * menu, so the button that receives the focus is usually a new one, mounted after the change.
 * Only a choice made in the menu sets it, so a page load never moves the focus.
 */
let focusAfterSwitch: AppModeId | null = null;

const OPEN_KEYS = new Set(["ArrowDown", "ArrowUp"]);

/**
 * Crafter | Ingester menu: a button naming the current mode, and a menu of radio items.
 * Keyboard: Enter, Space or the arrows open it on the current mode; arrows, Home and End move;
 * Enter or Space picks; Escape closes it and returns focus to the button; Tab or a click
 * outside closes it.
 */
export function ModeSwitch(props?: { className?: string }) {
  const { mode, setMode } = useAppMode();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const menuItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]',
      ) ?? [],
    );

  useEffect(() => {
    if (focusAfterSwitch !== mode.id) return;
    focusAfterSwitch = null;
    buttonRef.current?.focus();
  }, [mode.id]);

  useEffect(() => {
    if (!open) return;
    const items = menuItems();
    (
      items.find((item) => item.getAttribute("aria-checked") === "true") ??
      items[0]
    )?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (id: AppModeId) => {
    if (id === mode.id) {
      close(true);
      return;
    }
    setOpen(false);
    focusAfterSwitch = id;
    setMode(id);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div
      ref={rootRef}
      data-testid="mode-switch"
      className={cn("relative shrink-0", props?.className)}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <Button
        ref={buttonRef}
        id={buttonId}
        type="button"
        variant="ghost"
        data-mode={mode.id}
        className="gap-1 px-2 text-lg font-semibold tracking-tight"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (OPEN_KEYS.has(event.key) && !open) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <span className="sr-only">Mode: </span>
        {mode.label}
        <ChevronDown
          className={cn(
            "text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          className="bg-popover text-popover-foreground absolute top-full left-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border p-1 shadow-md"
          onKeyDown={onMenuKeyDown}
        >
          {APP_MODES.map((option) => {
            const selected = option.id === mode.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={-1}
                data-mode={option.id}
                className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left outline-none"
                onClick={() => choose(option.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {option.description}
                  </span>
                </span>
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    !selected && "invisible",
                  )}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
