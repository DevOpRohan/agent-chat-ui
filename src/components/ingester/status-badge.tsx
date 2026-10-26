import { cn } from "@/lib/utils";

import { badgeFor, toneText } from "./ingest-helpers";

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { label, tone, icon: Icon } = badgeFor(status);
  return (
    <span
      className={cn(
        "bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneText(tone),
        className,
      )}
      data-status={status}
      data-tone={tone}
    >
      <Icon
        className="size-3.5"
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
