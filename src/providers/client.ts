import { Client } from "@langchain/langgraph-sdk";
import { stopUserLimitRetries } from "@/lib/user-limit-error";
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
    callerOptions: {
      onFailedResponseHook: stopUserLimitRetries,
      ...(useIapAuth ? { fetch: createAuthFetch() } : {}),
    },
    ...(useIapAuth
      ? {
          defaultHeaders: authHeader
            ? { Authorization: authHeader }
            : undefined,
        }
      : {}),
  });
}
