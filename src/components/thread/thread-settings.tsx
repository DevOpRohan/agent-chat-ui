"use client";

import { useMemo, useState } from "react";
import { Check, Cog } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type ThemeOption = "light" | "dark" | "system";

const themeOptions: Array<{ value: ThemeOption; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThreadSettings({
  enterToSend,
  onEnterToSendChange,
}: {
  enterToSend: boolean;
  onEnterToSendChange: (checked: boolean) => void;
}) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const activeTheme = useMemo<ThemeOption>(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      return theme;
    }

    return resolvedTheme === "dark" ? "dark" : "light";
  }, [resolvedTheme, theme]);

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Open settings"
          title="Settings"
        >
          <Cog className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Customize chat behavior. More preferences can be added here later.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-4">
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Theme</h3>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map((option) => {
                const isActive = activeTheme === option.value;

                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    className={cn("justify-between", isActive && "pr-2")}
                    onClick={() => setTheme(option.value)}
                    aria-pressed={isActive}
                  >
                    {option.label}
                    {isActive ? <Check className="size-4" /> : null}
                  </Button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Message composer</h3>
            <div className="border-border bg-muted/30 flex items-center justify-between rounded-lg border px-3 py-3">
              <div className="space-y-1 pr-3">
                <p className="text-sm font-medium">Press Enter to send</p>
                <p className="text-muted-foreground text-xs">
                  {enterToSend
                    ? "Enter sends, Shift+Enter inserts a new line."
                    : "Enter inserts a new line. Use Ctrl/Cmd+Enter to send."}
                </p>
              </div>
              <Switch
                checked={enterToSend}
                onCheckedChange={onEnterToSendChange}
                aria-label="Toggle Enter to send"
              />
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
