import { useCallback, useEffect, useState } from "react";
import {
  getThreadBusyMap,
  markThreadBusy,
  subscribeThreadBusy,
  type ThreadBusyMap,
} from "@/lib/thread-activity";

export function useThreadBusy() {
  const [busyByThreadId, setBusyByThreadId] = useState<ThreadBusyMap>(() =>
    getThreadBusyMap(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBusyByThreadId(getThreadBusyMap());
    return subscribeThreadBusy(setBusyByThreadId);
  }, []);

  const markBusy = useCallback((threadId: string, busy: boolean) => {
    return markThreadBusy(threadId, busy);
  }, []);

  return { busyByThreadId, markBusy };
}
