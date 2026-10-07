import { useEffect, useState } from "react";
import { z } from "zod";
import { useThreadRuntime } from "@/providers/Stream";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const money = z.number().int().nonnegative().safe();
const budgetSchema = z.object({
  timezone: z.literal("Asia/Kolkata"),
  currency: z.literal("USD"),
  spent_microusd: money,
  base_limit_microusd: money,
  extra_credit_microusd: money,
  limit_microusd: money,
  remaining_microusd: money,
  resets_at: z.string(),
});
type Budget = z.infer<typeof budgetSchema>;
const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

export function DailyBudget() {
  const { fetchDailyBudget, isWorking } = useThreadRuntime();
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "unavailable" | "unsupported"
  >("loading");

  useEffect(() => {
    setBudget(null);
    setStatus("loading");
  }, [fetchDailyBudget]);

  useEffect(() => {
    if (!budget) return;
    // Run-state refreshes must not postpone clearing the old IST day's balance.
    const timer = setTimeout(
      () => {
        setBudget(null);
        setStatus("loading");
      },
      Math.max(0, Date.parse(budget.resets_at) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [budget]);

  useEffect(() => {
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      let delay = 60_000;
      try {
        const response = await fetchDailyBudget();
        if (canceled) return;
        if (response.status === 404) {
          setBudget(null);
          setStatus("unsupported");
          return;
        }
        if (!response.ok) throw new Error("Budget check unavailable");
        const next = budgetSchema.parse(await response.json());
        const reset = Date.parse(next.resets_at);
        if (
          !Number.isFinite(reset) ||
          reset <= Date.now() ||
          next.limit_microusd !==
            next.base_limit_microusd + next.extra_credit_microusd ||
          next.remaining_microusd !==
            Math.max(0, next.limit_microusd - next.spent_microusd)
        ) {
          throw new Error("Invalid daily budget");
        }
        if (canceled) return;
        setBudget(next);
        setStatus("ready");
        delay = Math.min(delay, reset - Date.now());
      } catch {
        if (canceled) return;
        setBudget(null);
        setStatus("unavailable");
      }
      if (!canceled)
        timer = setTimeout(
          () => {
            // Never show yesterday's balance while the new IST day is loading.
            setBudget((current) => {
              if (current && Date.parse(current.resets_at) <= Date.now())
                return null;
              return current;
            });
            void refresh();
          },
          Math.max(1, delay),
        );
    };
    void refresh();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [fetchDailyBudget, isWorking]);

  if (status === "unsupported") return null;
  const fraction = budget?.limit_microusd
    ? budget.remaining_microusd / budget.limit_microusd
    : 0;
  const used = budget
    ? budget.limit_microusd
      ? budget.spent_microusd / budget.limit_microusd
      : 1
    : 0;
  const ringColor = !budget
    ? "text-muted-foreground"
    : used >= 0.75
      ? "text-red-600 dark:text-red-400"
      : used >= 0.5
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-600 dark:text-green-400";
  const summary = budget
    ? `${dollars(budget.remaining_microusd)} left of ${dollars(budget.limit_microusd)} today`
    : status === "unavailable"
      ? "Daily budget temporarily unavailable"
      : "Updating daily budget…";
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="daily-budget"
          aria-label={`Daily budget: ${summary}`}
          aria-expanded={open}
          className="text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            setOpen((value) => !value);
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 36 36"
            className={`size-6 -rotate-90 ${ringColor}`}
          >
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className={budget && fraction === 0 ? "opacity-70" : "opacity-20"}
            />
            <circle
              cx="18"
              cy="18"
              r="14"
              pathLength="100"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={budget ? `${fraction * 100} 100` : "3 7"}
              strokeLinecap="round"
              className="opacity-70"
            />
          </svg>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        sideOffset={8}
        className="max-w-[calc(100vw-2rem)] text-left text-wrap"
      >
        <div data-testid="daily-budget-details" className="space-y-1 py-1">
          <p className="font-semibold">{summary}</p>
          {budget ? (
            <>
              <p>{Math.floor(used * 100)}% used</p>
              <p>Spent today: {dollars(budget.spent_microusd)}</p>
              <p>
                Daily limit: {dollars(budget.base_limit_microusd)} · Extra
                credits: {dollars(budget.extra_credit_microusd)}
              </p>
              <p>Resets at midnight IST</p>
            </>
          ) : (
            <p>Your balance will update automatically.</p>
          )}
          <p className="opacity-75">Updates about once a minute</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
