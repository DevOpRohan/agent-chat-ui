/**
 * Friendly progress steps from the stage in the ingest thread's metadata (`ingest_stage`: the UI
 * writes "queued" when it creates the thread, then the topic_ingest graph writes the rest):
 * queued -> reading -> checking -> (fixing -> rechecking)? -> publishing -> done.
 * The graph goes straight from checking to done when it only needs to report.
 *
 * Ported from topic-ingester (src/lib/progress.ts); the step labels are kept word for word.
 */

export type StepId = "read" | "check" | "fix" | "recheck" | "finish";
export type StepState = "done" | "active" | "pending";

export interface ProgressStep {
  id: StepId;
  label: string;
  state: StepState;
}

export interface Progress {
  steps: ProgressStep[];
  active: StepId;
  /** True once the graph has entered the fix stage: fixing can take minutes. */
  fixing: boolean;
}

export const STEP_LABELS: Record<StepId, string> = {
  read: "Reading your topic",
  check: "Checking every question",
  fix: "Fixing small formatting issues",
  recheck: "Re-checking",
  finish: "Preparing your preview",
};

const STAGE_STEP: Record<string, StepId> = {
  queued: "read",
  reading: "read",
  checking: "check",
  fixing: "fix",
  rechecking: "recheck",
  publishing: "finish",
  done: "finish",
};

const ORDER: StepId[] = ["read", "check", "fix", "recheck", "finish"];

export function isFixStage(stage: string | undefined): boolean {
  return stage === "fixing" || stage === "rechecking";
}

/**
 * @param stage the thread's `metadata.ingest_stage`
 * @param fixSeen the fix stage was seen earlier (so "publishing" keeps the fix steps as done)
 */
export function deriveProgress({
  stage,
  fixSeen = false,
}: {
  stage?: string;
  fixSeen?: boolean;
}): Progress {
  const activeId = STAGE_STEP[stage ?? ""] ?? "read";
  const fixing = fixSeen || isFixStage(stage);
  const visible = fixing
    ? ORDER
    : ORDER.filter((id) => id !== "fix" && id !== "recheck");
  const activeIndex = ORDER.indexOf(activeId);
  const steps = visible.map((id) => {
    const index = ORDER.indexOf(id);
    const state: StepState =
      index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending";
    return { id, label: STEP_LABELS[id], state };
  });
  return { steps, active: activeId, fixing };
}
