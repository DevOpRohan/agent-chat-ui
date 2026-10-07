const messages = {
  DAILY_COST_LIMIT_EXCEEDED: {
    title: "Daily limit reached",
    description:
      "You’ve reached your daily limit. It resets at midnight IST. To get more credits, please contact your reporting manager.",
  },
  USAGE_UNAVAILABLE: {
    title: "Usage check temporarily unavailable",
    description:
      "We couldn’t check your daily usage. Please try again in a moment.",
  },
} as const;

type LimitCode = keyof typeof messages;

function isCode(value: unknown): value is LimitCode {
  return typeof value === "string" && Object.hasOwn(messages, value);
}

export class UserLimitError extends Error {
  constructor(public readonly code: LimitCode) {
    super(messages[code].description);
    this.name = "UserLimitError";
  }
}

export function getUserLimitNotice(error: unknown) {
  if (error instanceof UserLimitError) return messages[error.code];
  if (!error || typeof error !== "object") return undefined;
  const value = error as {
    code?: unknown;
    detail?: unknown;
    text?: unknown;
    message?: unknown;
  };
  if (isCode(value.code)) return messages[value.code];
  if (isCode(value.detail)) return messages[value.detail];
  const raw = value.text ?? value.message;
  if (typeof raw !== "string") return undefined;
  try {
    const body = JSON.parse(raw.replace(/^HTTP \d+: /, ""));
    const code = body.code ?? body.detail ?? body.message;
    return isCode(code) ? messages[code] : undefined;
  } catch {
    return undefined;
  }
}

export function getUserLimitMessage(error: unknown): string | undefined {
  return getUserLimitNotice(error)?.description;
}

export async function stopUserLimitRetries(
  response?: Response,
): Promise<boolean> {
  // The SDK has already consumed the response body here. The backend exposes
  // this header through CORS. Throwing from this hook stops p-retry immediately.
  const code = response?.headers.get("X-User-Limit-Code");
  if (isCode(code)) throw new UserLimitError(code);
  return true;
}
