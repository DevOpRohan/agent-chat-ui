export function getApiKey(): string | null {
  try {
    if (typeof window === "undefined") return null;
    if (process.env.NEXT_PUBLIC_AUTH_MODE === "iap") return null;
    return window.localStorage.getItem("lg:chat:apiKey") ?? null;
  } catch {
    // no-op
  }

  return null;
}
