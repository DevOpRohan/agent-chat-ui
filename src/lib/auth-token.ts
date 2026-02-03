const REFRESH_BUFFER_MS = 2 * 60 * 1000;

type TokenCache = {
  token: string;
  expiresAtMs: number;
};

let cachedToken: TokenCache | null = null;
let inFlight: Promise<string> | null = null;

export function isIapAuthMode(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MODE === "iap";
}

export function getCachedAuthHeader(): string | undefined {
  if (!cachedToken) return undefined;
  return `Bearer ${cachedToken.token}`;
}

export function clearAuthTokenCache() {
  cachedToken = null;
  inFlight = null;
}

function shouldRefreshToken(now: number, expiresAtMs: number) {
  return expiresAtMs - now < REFRESH_BUFFER_MS;
}

export async function getAuthToken(options?: {
  forceRefresh?: boolean;
}): Promise<string | null> {
  if (!isIapAuthMode()) return null;
  if (typeof window === "undefined") return null;

  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cachedToken &&
    !shouldRefreshToken(now, cachedToken.expiresAtMs)
  ) {
    return cachedToken.token;
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    const response = await fetch("/api/auth/token", {
      method: "GET",
      headers: { "Cache-Control": "no-store" },
    });

    if (!response.ok) {
      clearAuthTokenCache();
      throw new Error(`Failed to fetch auth token (${response.status})`);
    }

    const data = (await response.json()) as {
      token?: string;
      expiresAt?: number | string;
    };

    const token = data.token;
    if (!token || !data.expiresAt) {
      clearAuthTokenCache();
      throw new Error("Invalid auth token response");
    }

    const expiresAtMs =
      typeof data.expiresAt === "number"
        ? data.expiresAt * 1000
        : Date.parse(data.expiresAt);

    if (!Number.isFinite(expiresAtMs)) {
      clearAuthTokenCache();
      throw new Error("Invalid auth token expiry");
    }

    cachedToken = { token, expiresAtMs };
    return token;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function getAuthHeaderValue(): Promise<string | null> {
  const token = await getAuthToken();
  return token ? `Bearer ${token}` : null;
}

export function createAuthFetch() {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!isIapAuthMode()) return fetch(input, init);

    const headers = new Headers(init.headers ?? {});

    try {
      const token = await getAuthToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch (error) {
      console.error("Failed to load auth token", error);
    }

    const response = await fetch(input, { ...init, headers });

    if (response.status === 401 || response.status === 403) {
      clearAuthTokenCache();
      void getAuthToken({ forceRefresh: true }).catch(() => undefined);
    }

    return response;
  };
}
