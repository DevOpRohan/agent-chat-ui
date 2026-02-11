export type ThreadLastSeenMap = Record<string, number>;
export type ThreadBusyMap = Record<string, boolean>;
export type ThreadBusyOwnerMap = Record<string, string>;

const THREAD_LAST_SEEN_STORAGE_KEY = "lg:thread:lastSeenUpdatedAt";
const THREAD_LAST_SEEN_BASELINE_KEY = "lg:thread:lastSeenBaselineAt";
const THREAD_LAST_SEEN_EVENT = "lg:thread:lastSeenUpdatedAt:event";
const THREAD_BUSY_STORAGE_KEY = "lg:thread:busy";
const THREAD_BUSY_OWNER_STORAGE_KEY = "lg:thread:busy:owner";
const THREAD_BUSY_EVENT = "lg:thread:busy:event";
const THREAD_TAB_ID_STORAGE_KEY = "lg:thread:tabId";

function shallowEqualRecord<T extends Record<string, unknown>>(
  a: T,
  b: T,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function safeParseMap(raw: string | null): ThreadLastSeenMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: ThreadLastSeenMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const numberValue =
        typeof value === "number" ? value : Number.parseInt(String(value), 10);
      if (Number.isFinite(numberValue)) {
        map[key] = numberValue;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function safeParseBusyMap(raw: string | null): ThreadBusyMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: ThreadBusyMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      map[key] = value === true || value === "true" || value === 1;
    }
    return map;
  } catch {
    return {};
  }
}

function safeParseBusyOwnerMap(raw: string | null): ThreadBusyOwnerMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: ThreadBusyOwnerMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim().length > 0) {
        map[key] = value;
      }
    }
    return map;
  } catch {
    return {};
  }
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // no-op
  }
}

function readSessionStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // no-op
  }
}

export function getThreadLastSeenMap(): ThreadLastSeenMap {
  return safeParseMap(readStorage(THREAD_LAST_SEEN_STORAGE_KEY));
}

export function setThreadLastSeenMap(map: ThreadLastSeenMap) {
  writeStorage(THREAD_LAST_SEEN_STORAGE_KEY, JSON.stringify(map));
}

export function getThreadLastSeenBaselineMs(): number | null {
  const stored = readStorage(THREAD_LAST_SEEN_BASELINE_KEY);
  if (!stored) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ensureThreadLastSeenBaseline(): number | null {
  if (typeof window === "undefined") return null;
  const existing = getThreadLastSeenBaselineMs();
  if (existing && existing > 0) return existing;
  const now = Date.now();
  writeStorage(THREAD_LAST_SEEN_BASELINE_KEY, String(now));
  return now;
}

export function markThreadSeen(
  threadId: string,
  updatedAtMs?: number,
): number | null {
  if (typeof window === "undefined") return null;
  const map = getThreadLastSeenMap();
  const nextValue = Number.isFinite(updatedAtMs)
    ? (updatedAtMs as number)
    : Date.now();
  const next = Math.max(map[threadId] ?? 0, nextValue);
  map[threadId] = next;
  setThreadLastSeenMap(map);
  try {
    window.dispatchEvent(
      new CustomEvent(THREAD_LAST_SEEN_EVENT, { detail: { map } }),
    );
  } catch {
    // no-op
  }
  return next;
}

export function subscribeThreadLastSeen(
  onChange: (map: ThreadLastSeenMap) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ map?: ThreadLastSeenMap }>).detail;
    if (detail?.map) {
      onChange(detail.map);
      return;
    }
    onChange(getThreadLastSeenMap());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== THREAD_LAST_SEEN_STORAGE_KEY) return;
    onChange(getThreadLastSeenMap());
  };

  window.addEventListener(THREAD_LAST_SEEN_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(THREAD_LAST_SEEN_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorage);
  };
}

export function getThreadBusyMap(): ThreadBusyMap {
  return safeParseBusyMap(readStorage(THREAD_BUSY_STORAGE_KEY));
}

export function setThreadBusyMap(map: ThreadBusyMap) {
  writeStorage(THREAD_BUSY_STORAGE_KEY, JSON.stringify(map));
}

export function getThreadBusyOwnerMap(): ThreadBusyOwnerMap {
  return safeParseBusyOwnerMap(readStorage(THREAD_BUSY_OWNER_STORAGE_KEY));
}

export function setThreadBusyOwnerMap(map: ThreadBusyOwnerMap) {
  writeStorage(THREAD_BUSY_OWNER_STORAGE_KEY, JSON.stringify(map));
}

export function getOrCreateThreadTabId(): string | null {
  const existing = readSessionStorage(THREAD_TAB_ID_STORAGE_KEY);
  if (existing) return existing;

  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const nextId = `tab-${randomPart}`;
  writeSessionStorage(THREAD_TAB_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function markThreadBusy(
  threadId: string,
  busy: boolean,
  ownerTabId?: string,
): ThreadBusyMap {
  if (typeof window === "undefined") return {};
  const currentMap = getThreadBusyMap();
  const currentOwnerMap = getThreadBusyOwnerMap();
  const nextMap = { ...currentMap };
  const nextOwnerMap = { ...currentOwnerMap };
  if (busy) {
    nextMap[threadId] = true;
    if (ownerTabId) {
      nextOwnerMap[threadId] = ownerTabId;
    } else if (!nextOwnerMap[threadId]) {
      const currentTabId = getOrCreateThreadTabId();
      if (currentTabId) {
        nextOwnerMap[threadId] = currentTabId;
      }
    }
  } else {
    delete nextMap[threadId];
    delete nextOwnerMap[threadId];
  }

  if (
    shallowEqualRecord(currentMap, nextMap) &&
    shallowEqualRecord(currentOwnerMap, nextOwnerMap)
  ) {
    return currentMap;
  }

  setThreadBusyMap(nextMap);
  setThreadBusyOwnerMap(nextOwnerMap);
  try {
    window.dispatchEvent(
      new CustomEvent(THREAD_BUSY_EVENT, {
        detail: { map: nextMap, ownerMap: nextOwnerMap },
      }),
    );
  } catch {
    // no-op
  }
  return nextMap;
}

export function subscribeThreadBusy(
  onChange: (state: {
    map: ThreadBusyMap;
    ownerMap: ThreadBusyOwnerMap;
  }) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handleCustomEvent = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        map?: ThreadBusyMap;
        ownerMap?: ThreadBusyOwnerMap;
      }>
    ).detail;
    if (detail?.map || detail?.ownerMap) {
      onChange({
        map: detail?.map ?? getThreadBusyMap(),
        ownerMap: detail?.ownerMap ?? getThreadBusyOwnerMap(),
      });
      return;
    }
    onChange({ map: getThreadBusyMap(), ownerMap: getThreadBusyOwnerMap() });
  };

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key !== THREAD_BUSY_STORAGE_KEY &&
      event.key !== THREAD_BUSY_OWNER_STORAGE_KEY
    ) {
      return;
    }
    onChange({ map: getThreadBusyMap(), ownerMap: getThreadBusyOwnerMap() });
  };

  window.addEventListener(THREAD_BUSY_EVENT, handleCustomEvent);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(THREAD_BUSY_EVENT, handleCustomEvent);
    window.removeEventListener("storage", handleStorage);
  };
}
