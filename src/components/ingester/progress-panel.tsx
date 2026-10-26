"use client";

import { Circle, CircleCheck, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { formatElapsed } from "@/lib/ingest/format";
import { deriveProgress } from "@/lib/ingest/progress";
import { cn } from "@/lib/utils";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function ProgressPanel({
  stage,
  queued,
  fixSeen,
  startedAt,
}: {
  stage: string;
  queued: boolean;
  /** The fix stage was seen on an earlier poll, so its steps stay listed as done. */
  fixSeen: boolean;
  /** When this tab started the run; the elapsed time shows only when it is known. */
  startedAt?: number | null;
}) {
  const progress = deriveProgress({ stage, fixSeen });
  const active = progress.steps.find((step) => step.state === "active");
  const now = useNow(typeof startedAt === "number");
  return (
    <Card
      aria-labelledby="ingest-progress-heading"
      className="gap-0 px-5 py-5 sm:px-6"
      data-testid="ingest-progress"
      role="region"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="ingest-progress-heading"
          className="text-lg font-semibold"
        >
          Ingesting your topic…
        </h2>
        {typeof startedAt === "number" ? (
          <p className="text-muted-foreground text-sm tabular-nums">
            Elapsed:{" "}
            <span data-testid="ingest-elapsed">
              {formatElapsed(Math.max(0, now - startedAt))}
            </span>
          </p>
        ) : null}
      </div>
      {queued ? (
        <p className="text-muted-foreground mt-2 text-sm">
          Waiting for the ingestion to start…
        </p>
      ) : null}

      <ol className="mt-5 space-y-4">
        {progress.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-3"
            aria-current={step.state === "active" ? "step" : undefined}
            data-step={step.id}
            data-step-state={step.state}
          >
            {step.state === "done" ? (
              <CircleCheck
                className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400"
                aria-hidden="true"
              />
            ) : step.state === "active" ? (
              <LoaderCircle
                className="text-foreground mt-0.5 size-5 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Circle
                className="text-muted-foreground mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
            )}
            <div>
              <span
                className={cn(
                  step.state === "pending" && "text-muted-foreground",
                  step.state === "active" && "font-semibold",
                )}
              >
                {step.label}
              </span>
              <span className="sr-only">
                {step.state === "done"
                  ? " (done)"
                  : step.state === "active"
                    ? " (in progress)"
                    : " (to do)"}
              </span>
              {step.state === "active" && step.id === "fix" ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  This step can take a few minutes.
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div
        className="mt-5 space-y-1.5 border-t pt-4 text-sm leading-relaxed"
        data-testid="ingest-progress-note"
      >
        <p className="text-muted-foreground">
          This usually takes under a minute, or a few minutes if we fix things.
        </p>
        <p>
          You can close this tab. We&apos;ll keep going, and you&apos;ll find
          the result in History.
        </p>
      </div>
      <p
        aria-live="polite"
        className="sr-only"
      >
        {active ? `${active.label}…` : ""}
      </p>
    </Card>
  );
}
