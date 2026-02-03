const FALLBACK_RECURSION_LIMIT = 50;

const envRecursionLimit = Number.parseInt(
  process.env.NEXT_PUBLIC_AGENT_RECURSION_LIMIT ?? "",
  25,
);

export const DEFAULT_AGENT_RECURSION_LIMIT =
  Number.isFinite(envRecursionLimit) && envRecursionLimit > 0
    ? envRecursionLimit
    : FALLBACK_RECURSION_LIMIT;

// Thread history requires backend ownership enforcement.
export const THREAD_HISTORY_ENABLED = true;
