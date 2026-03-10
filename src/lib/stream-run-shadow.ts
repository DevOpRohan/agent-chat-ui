type ShadowRunRecord = {
  runId: string;
  updatedAtMs: number;
};

const SDK_RUN_STORAGE_PREFIX = "lg:stream:";
const SHADOW_RUN_STORAGE_PREFIX = "lg:stream:shadow:";
const DEFAULT_SHADOW_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

function removeSessionStorage(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // no-op
  }
}

function normalizeRunId(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getSdkRunStorageKey(threadId: string) {
  return `${SDK_RUN_STORAGE_PREFIX}${threadId}`;
}

function getShadowRunStorageKey(threadId: string) {
  return `${SHADOW_RUN_STORAGE_PREFIX}${threadId}`;
}

export function readSdkRunId(threadId: string | null): string | null {
  if (!threadId) return null;
  return normalizeRunId(readSessionStorage(getSdkRunStorageKey(threadId)));
}

export function writeShadowRunId(threadId: string, runId: string) {
  const normalizedRunId = normalizeRunId(runId);
  if (!normalizedRunId) return;
  const payload: ShadowRunRecord = {
    runId: normalizedRunId,
    updatedAtMs: Date.now(),
  };
  writeSessionStorage(
    getShadowRunStorageKey(threadId),
    JSON.stringify(payload),
  );
}

export function readShadowRunId(
  threadId: string | null,
  maxAgeMs = DEFAULT_SHADOW_RUN_MAX_AGE_MS,
): string | null {
  if (!threadId) return null;
  const raw = readSessionStorage(getShadowRunStorageKey(threadId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ShadowRunRecord> | null;
    const runId = normalizeRunId(
      typeof parsed?.runId === "string" ? parsed.runId : null,
    );
    if (!runId) return null;

    const updatedAtMs =
      typeof parsed?.updatedAtMs === "number" ? parsed.updatedAtMs : Number.NaN;

    if (!Number.isFinite(updatedAtMs)) {
      return runId;
    }

    if (Date.now() - updatedAtMs > maxAgeMs) {
      removeSessionStorage(getShadowRunStorageKey(threadId));
      return null;
    }

    return runId;
  } catch {
    return null;
  }
}

export function readRecoveryRunId(threadId: string | null): string | null {
  return readSdkRunId(threadId) ?? readShadowRunId(threadId);
}

export function clearShadowRunId(threadId: string | null) {
  if (!threadId) return;
  removeSessionStorage(getShadowRunStorageKey(threadId));
}
