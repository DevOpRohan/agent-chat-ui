import { useEffect, useState } from "react";
import { z } from "zod";
import { useThreadRuntime } from "@/providers/Stream";

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
  return (
    <div
      data-testid="daily-budget"
      role="status"
      title="Updates about once a minute"
      className="text-muted-foreground mx-auto mb-2 flex w-full max-w-3xl items-center gap-2.5 px-1 text-xs"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 36 36"
        className="size-9 shrink-0 -rotate-90"
      >
        <circle
          cx="18"
          cy="18"
          r="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="opacity-15"
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
          className={
            budget
              ? fraction > 0.2
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
              : "opacity-40"
          }
        />
      </svg>
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">
          {budget
            ? `${dollars(budget.remaining_microusd)} left of ${dollars(budget.limit_microusd)} today`
            : status === "unavailable"
              ? "Daily budget temporarily unavailable"
              : "Updating daily budget…"}
        </p>
        <p>
          {budget
            ? `Resets at midnight IST${budget.extra_credit_microusd ? ` · Includes ${dollars(budget.extra_credit_microusd)} extra credits` : ""}`
            : "Your balance will update automatically."}
        </p>
      </div>
    </div>
  );
}
