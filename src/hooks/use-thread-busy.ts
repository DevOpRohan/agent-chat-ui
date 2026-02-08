import { useCallback, useEffect, useState } from "react";
import {
  getThreadBusyMap,
  getThreadBusyOwnerMap,
  markThreadBusy,
  subscribeThreadBusy,
  type ThreadBusyMap,
  type ThreadBusyOwnerMap,
} from "@/lib/thread-activity";

export function useThreadBusy() {
  const [busyByThreadId, setBusyByThreadId] = useState<ThreadBusyMap>(() =>
    getThreadBusyMap(),
  );
  const [busyOwnerByThreadId, setBusyOwnerByThreadId] =
    useState<ThreadBusyOwnerMap>(() => getThreadBusyOwnerMap());

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBusyByThreadId(getThreadBusyMap());
    setBusyOwnerByThreadId(getThreadBusyOwnerMap());

    return subscribeThreadBusy(({ map, ownerMap }) => {
      setBusyByThreadId(map);
      setBusyOwnerByThreadId(ownerMap);
    });
  }, []);

  const markBusy = useCallback(
    (threadId: string, busy: boolean, ownerTabId?: string) => {
      return markThreadBusy(threadId, busy, ownerTabId);
    },
    [],
  );

  return { busyByThreadId, busyOwnerByThreadId, markBusy };
}
