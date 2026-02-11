import { useCallback, useEffect, useState } from "react";
import {
  getThreadBusyMap,
  getThreadBusyOwnerMap,
  markThreadBusy,
  subscribeThreadBusy,
  type ThreadBusyMap,
  type ThreadBusyOwnerMap,
} from "@/lib/thread-activity";

function shallowEqualBusyMap(a: ThreadBusyMap, b: ThreadBusyMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function shallowEqualBusyOwnerMap(
  a: ThreadBusyOwnerMap,
  b: ThreadBusyOwnerMap,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export function useThreadBusy() {
  const [busyByThreadId, setBusyByThreadId] = useState<ThreadBusyMap>(() =>
    getThreadBusyMap(),
  );
  const [busyOwnerByThreadId, setBusyOwnerByThreadId] =
    useState<ThreadBusyOwnerMap>(() => getThreadBusyOwnerMap());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentMap = getThreadBusyMap();
    const currentOwnerMap = getThreadBusyOwnerMap();
    setBusyByThreadId((prev) =>
      shallowEqualBusyMap(prev, currentMap) ? prev : currentMap,
    );
    setBusyOwnerByThreadId((prev) =>
      shallowEqualBusyOwnerMap(prev, currentOwnerMap) ? prev : currentOwnerMap,
    );

    return subscribeThreadBusy(({ map, ownerMap }) => {
      setBusyByThreadId((prev) =>
        shallowEqualBusyMap(prev, map) ? prev : map,
      );
      setBusyOwnerByThreadId((prev) =>
        shallowEqualBusyOwnerMap(prev, ownerMap) ? prev : ownerMap,
      );
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
