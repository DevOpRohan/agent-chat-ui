/** Non-component helpers shared by the ingest pane's components. */
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Hourglass,
  Info,
  RotateCcw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { IngestCost } from "@/lib/ingest/ingest-types";
import type { IssueGroup } from "@/lib/ingest/plain-issues";
import {
  RUNNING_BADGE,
  STALLED_COPY,
  statusCopy,
  type Tone,
} from "@/lib/ingest/status-copy";
import { plural } from "@/lib/ingest/topic-file";

/** Tone colours reuse class strings the app already has (daily budget ring, destructive). */
const TONE_TEXT: Record<Tone, string> = {
  success: "text-green-600 dark:text-green-400",
  attention: "text-amber-600 dark:text-amber-400",
  retry: "text-muted-foreground",
  error: "text-destructive",
  neutral: "text-muted-foreground",
};

/** Every tone has its own icon, and text always comes with it: colour is never the only signal. */
export const TONE_ICONS: Record<Tone, LucideIcon> = {
  success: CircleCheck,
  attention: TriangleAlert,
  retry: RotateCcw,
  error: CircleAlert,
  neutral: Info,
};

export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}

/** Badge label, tone and icon for a result status, or "running" | "stalled". */
export function badgeFor(status: string): {
  label: string;
  tone: Tone;
  icon: LucideIcon;
} {
  if (status === "running")
    return { label: RUNNING_BADGE, tone: "neutral", icon: Clock };
  if (status === "stalled")
    return {
      label: STALLED_COPY.badge,
      tone: STALLED_COPY.tone,
      icon: Hourglass,
    };
  const copy = statusCopy(status);
  return {
    label: copy.status === "unknown" ? "Unknown" : copy.badge,
    tone: copy.tone,
    icon: TONE_ICONS[copy.tone],
  };
}

/** "We found 3 things to fix in 2 CTs." (errors only; optional suggestions aside). */
export function issueSummary(groups: readonly IssueGroup[]): string | null {
  const errors = groups.flatMap((g) => g.issues.filter((i) => !i.optional));
  if (!errors.length) return null;
  const sets = new Set(
    groups
      .filter((g) => g.ctKey && g.issues.some((i) => !i.optional))
      .map((g) => g.ctKey),
  ).size;
  const things = plural(errors.length, "thing");
  return sets > 0
    ? `We found ${things} to fix in ${plural(sets, "CT")}.`
    : `We found ${things} to fix.`;
}

/** "Automatic fixing cost: $0.42", "not run", or "not reported" when the fixer ran but gave no total. */
export function formatFixingCost(cost?: IngestCost): string {
  if (!cost || !cost.updaterRan) return "not run";
  if (cost.updaterCostUsd === undefined) return "not reported";
  return `$${cost.updaterCostUsd.toFixed(2)}`;
}
