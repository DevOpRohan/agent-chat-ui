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

function getPdfNotice(detail: unknown) {
  if (!detail || typeof detail !== "object") return undefined;
  const value = detail as { code?: unknown; message?: unknown };
  if (typeof value.message !== "string") return undefined;
  if (value.code === "PDF_PAGE_LIMIT_EXCEEDED")
    return { title: "PDF page limit exceeded", description: value.message };
  if (value.code === "PDF_PAGE_COUNT_UNAVAILABLE")
    return {
      title: "PDF pages could not be verified",
      description: value.message,
    };
  return undefined;
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
  const pdfNotice = getPdfNotice(value.detail) || getPdfNotice(value);
  if (pdfNotice) return pdfNotice;
  if (isCode(value.code)) return messages[value.code];
  if (isCode(value.detail)) return messages[value.detail];
  const raw = value.text ?? value.message;
  if (typeof raw !== "string") return undefined;
  try {
    const body = JSON.parse(raw.replace(/^HTTP \d+: /, ""));
    const pdfNotice = getPdfNotice(body.detail) || getPdfNotice(body);
    if (pdfNotice) return pdfNotice;
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
