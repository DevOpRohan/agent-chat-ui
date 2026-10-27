"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  className,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldId = useId();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn("w-full sm:w-auto", className)}
        onClick={() => void copy()}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? copiedLabel : label}
      </Button>
      <span
        aria-live="polite"
        className="sr-only"
      >
        {copied ? "Link copied to the clipboard" : ""}
      </span>
      {failed ? (
        <div className="flex w-full flex-col gap-1">
          <label
            htmlFor={fieldId}
            className="text-muted-foreground text-sm"
          >
            Copy this link:
          </label>
          <Input
            id={fieldId}
            readOnly
            value={text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      ) : null}
    </>
  );
}
