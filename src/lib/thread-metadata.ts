import { Metadata } from "@langchain/langgraph-sdk";

const THREAD_LABEL_METADATA_KEYS = [
  "thread_title",
  "title",
  "thread_preview",
] as const;

export function toMetadataRecord(
  metadata: Metadata | unknown,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return { ...(metadata as Record<string, unknown>) };
}

export function getThreadLabelFromMetadata(
  metadata: Metadata | unknown,
): string | null {
  const metadataRecord = toMetadataRecord(metadata);
  for (const key of THREAD_LABEL_METADATA_KEYS) {
    const rawValue = metadataRecord[key];
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}
