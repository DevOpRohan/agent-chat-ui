import { Client } from "@langchain/langgraph-sdk";
import {
  createAuthFetch,
  getCachedAuthHeader,
  isIapAuthMode,
} from "@/lib/auth-token";

export function createClient(apiUrl: string, apiKey: string | undefined) {
  const useIapAuth = isIapAuthMode();
  const authHeader = getCachedAuthHeader();

  return new Client({
    apiKey: useIapAuth ? undefined : apiKey,
    apiUrl,
    ...(useIapAuth
      ? {
          callerOptions: { fetch: createAuthFetch() },
          defaultHeaders: authHeader
            ? { Authorization: authHeader }
            : undefined,
        }
      : {}),
  });
}
