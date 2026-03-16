export type ThreadLastSeenMap = Record<string, number>;

const THREAD_LAST_SEEN_STORAGE_KEY = "lg:thread:lastSeenUpdatedAt";
const THREAD_LAST_SEEN_BASELINE_KEY = "lg:thread:lastSeenBaselineAt";
const THREAD_LAST_SEEN_EVENT = "lg:thread:lastSeenUpdatedAt:event";

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
