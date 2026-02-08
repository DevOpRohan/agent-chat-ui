export type StreamErrorClassification =
  | "benign_react_185"
  | "conflict"
  | "expected_interrupt_or_breakpoint"
  | "recoverable_disconnect"
  | "fatal";

type StreamErrorDetails = {
  name?: string;
  message?: string;
};

function readStringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readErrorObject(value: unknown): StreamErrorDetails {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    name: readStringField(record.name) ?? readStringField(record.error),
    message: readStringField(record.message),
  };
}

export function getStreamErrorDetails(error: unknown): StreamErrorDetails {
  if (typeof error === "string") {
    return { message: readStringField(error) };
  }

  const objectDetails = readErrorObject(error);
  if (objectDetails.name || objectDetails.message) {
    return objectDetails;
  }

  if (error instanceof Error) {
    return {
      name: readStringField(error.name),
      message: readStringField(error.message),
    };
  }

  return {};
}

function isReact185Error(text: string): boolean {
  return (
    text.includes("minified react error #185") || text.includes("/errors/185")
  );
}

function isConflictError(text: string): boolean {
  return (
    text.includes("409") ||
    text.includes("conflict") ||
    text.includes("busy") ||
    text.includes("inflight")
  );
}

function isExpectedInterruptError(text: string): boolean {
  return (
    text.includes("human breakpoint") ||
    text.includes("breakpoint") ||
    text.includes("graphinterrupt") ||
    text.includes("nodeinterrupt") ||
    text.includes("cancellederror") ||
    text.includes("cancelederror") ||
    text.includes("cancelled") ||
    text.includes("canceled") ||
    text.includes("aborterror") ||
    text.includes("aborted")
  );
}

function isRecoverableDisconnectError(text: string): boolean {
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("network request failed") ||
    text.includes("load failed") ||
    text.includes("internet disconnected") ||
    text.includes("err_internet_disconnected") ||
    text.includes("err_network_changed") ||
    text.includes("addressunreachable") ||
    text.includes("connection reset") ||
    text.includes("connection was reset") ||
    text.includes("connection was lost") ||
    text.includes("timed out") ||
    text.includes("timeout")
  );
}

export function classifyStreamError(
  error: unknown,
  options?: { hasInterrupt?: boolean },
): StreamErrorClassification {
  const details = getStreamErrorDetails(error);
  const text = `${details.name ?? ""} ${details.message ?? ""}`.toLowerCase();

  if (isReact185Error(text)) {
    return "benign_react_185";
  }

  if (isConflictError(text)) {
    return "conflict";
  }

  if (options?.hasInterrupt || isExpectedInterruptError(text)) {
    return "expected_interrupt_or_breakpoint";
  }

  if (isRecoverableDisconnectError(text)) {
    return "recoverable_disconnect";
  }

  return "fatal";
}
