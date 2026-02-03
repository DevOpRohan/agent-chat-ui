import { importJWK, type JWK, type KeyLike } from "jose";

const IAP_JWKS_URL = "https://www.gstatic.com/iap/verify/public_key-jwk";
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

type CachedKeys = {
  keys: Map<string, KeyLike | Uint8Array>;
  fetchedAt: number;
  maxAgeMs: number;
};

let cached: CachedKeys | null = null;
let inFlight: Promise<CachedKeys> | null = null;

function parseMaxAge(cacheControl: string | null): number {
  if (!cacheControl) return DEFAULT_MAX_AGE_MS;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return DEFAULT_MAX_AGE_MS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) return DEFAULT_MAX_AGE_MS;
  return seconds * 1000;
}

async function fetchJwks(): Promise<CachedKeys> {
  const response = await fetch(IAP_JWKS_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch IAP JWKS (${response.status})`);
  }

  const body = (await response.json()) as { keys?: JWK[] };
  if (!Array.isArray(body.keys)) {
    throw new Error("Invalid IAP JWKS response");
  }

  const keys = new Map<string, KeyLike | Uint8Array>();
  await Promise.all(
    body.keys.map(async (jwk) => {
      if (!jwk.kid) return;
      const key = await importJWK(jwk, jwk.alg ?? "ES256");
      keys.set(jwk.kid, key);
    }),
  );

  const cachedKeys: CachedKeys = {
    keys,
    fetchedAt: Date.now(),
    maxAgeMs: parseMaxAge(response.headers.get("cache-control")),
  };

  cached = cachedKeys;
  return cachedKeys;
}

async function getCachedKeys(): Promise<CachedKeys> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < cached.maxAgeMs) {
    return cached;
  }

  if (inFlight) return inFlight;

  inFlight = fetchJwks();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function getIapPublicKey(
  kid: string,
): Promise<KeyLike | Uint8Array> {
  if (!kid) {
    throw new Error("Missing key id (kid)");
  }

  if (cached?.keys.has(kid)) {
    return cached.keys.get(kid) as KeyLike | Uint8Array;
  }

  const keys = await getCachedKeys();
  const key = keys.keys.get(kid);
  if (key) return key;

  // Force refresh for key rotation
  cached = null;
  const refreshed = await getCachedKeys();
  const refreshedKey = refreshed.keys.get(kid);
  if (!refreshedKey) {
    throw new Error(`IAP public key not found for kid: ${kid}`);
  }

  return refreshedKey;
}
