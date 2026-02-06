import { useCallback, useEffect, useState } from "react";
import {
  ensureThreadLastSeenBaseline,
  getThreadLastSeenBaselineMs,
  getThreadLastSeenMap,
  markThreadSeen,
  subscribeThreadLastSeen,
  type ThreadLastSeenMap,
} from "@/lib/thread-activity";

export function useThreadLastSeen() {
  const [lastSeenByThreadId, setLastSeenByThreadId] =
    useState<ThreadLastSeenMap>(() => getThreadLastSeenMap());
  const [baselineMs, setBaselineMs] = useState<number>(() => {
    const existing = getThreadLastSeenBaselineMs();
    if (existing && existing > 0) return existing;
    return ensureThreadLastSeenBaseline() ?? 0;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const baseline = ensureThreadLastSeenBaseline();
    if (baseline && baseline > 0) {
      setBaselineMs(baseline);
    }
    setLastSeenByThreadId(getThreadLastSeenMap());
    return subscribeThreadLastSeen(setLastSeenByThreadId);
  }, []);

  const markSeen = useCallback((threadId: string, updatedAtMs?: number) => {
    return markThreadSeen(threadId, updatedAtMs);
  }, []);

  return { lastSeenByThreadId, baselineMs, markSeen };
}
