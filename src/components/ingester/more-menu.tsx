"use client";

import { ChevronDown, Ellipsis, type LucideIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface MoreItem {
  label: string;
  icon?: LucideIcon;
  /** A link (opens in a new tab when `external`, downloads when `download` is set). */
  href?: string;
  download?: string;
  external?: boolean;
  onSelect?: () => void;
}

const ITEM_CLASS =
  "text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm outline-none";

/**
 * A small menu for the less common actions, built from Button and a popover-coloured list.
 * Keyboard: Enter/Space/ArrowDown opens it on the first item; arrows, Home and End move;
 * Escape closes it and returns focus to the button; Tab or a click outside closes it.
 */
export function MoreMenu({
  items,
  label = "More",
}: {
  items: MoreItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const menuItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );

  useEffect(() => {
    if (!open) return;
    menuItems()[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  if (!items.length) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
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
      className="relative w-full sm:w-auto"
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
        className="w-full sm:w-auto"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        <Ellipsis aria-hidden="true" />
        {label}
        <ChevronDown
          className={cn("transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </Button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          className="bg-popover text-popover-foreground absolute right-0 left-0 z-20 mt-1 rounded-md border p-1 shadow-md sm:right-auto sm:w-72"
          data-testid="ingest-more-menu"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => {
            const Icon = item.icon;
            const content = (
              <>
                {Icon ? (
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
                <span>{item.label}</span>
              </>
            );
            return (
              <li
                key={item.label}
                role="none"
              >
                {item.href ? (
                  <a
                    role="menuitem"
                    tabIndex={-1}
                    href={item.href}
                    download={item.download}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className={ITEM_CLASS}
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </a>
                ) : (
                  <button
                    role="menuitem"
                    tabIndex={-1}
                    type="button"
                    className={ITEM_CLASS}
                    onClick={() => {
                      close(true);
                      item.onSelect?.();
                    }}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
