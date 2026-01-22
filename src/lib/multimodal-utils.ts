import { ContentBlock } from "@langchain/core/messages";
import { toast } from "sonner";

type UploadResponse = {
  gsUrl: string;
  httpsUrl: string;
  openaiFileId?: string;
  mime_type: string;
  filename: string;
  size: number;
};

async function upload(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    let message = "Failed to upload";
    try {
      const data = await res.json();
      message = data?.error || message;
    } catch (_e) {
      // ignore JSON parse errors
    }
    toast.error(message);
    throw new Error(message);
  }
  return (await res.json()) as UploadResponse;
}

// Custom content block type that extends SDK types with URL-based sources
// This supports our GCS URL-based uploads alongside base64
export type ExtendedContentBlock = ContentBlock.Multimodal.Data | {
  type: "image";
  source_type: "url";
  mime_type: string;
  url: string;
  metadata?: Record<string, unknown>;
} | {
  type: "file";
  source_type: "url" | "id";
  mime_type: string;
  url?: string;
  id?: string;
  metadata?: Record<string, unknown>;
};

// Returns a Promise of a typed multimodal block for images or PDFs
export async function fileToContentBlock(
  file: File,
): Promise<ExtendedContentBlock> {
  const supportedImageTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  const supportedFileTypes = [...supportedImageTypes, "application/pdf"];

  if (!supportedFileTypes.includes(file.type)) {
    toast.error(
      `Unsupported file type: ${file.type}. Supported types are: ${supportedFileTypes.join(", ")}`,
    );
    return Promise.reject(new Error(`Unsupported file type: ${file.type}`));
  }

  const { gsUrl, httpsUrl, openaiFileId } = await upload(file);

  const provider = (process.env.NEXT_PUBLIC_MODEL_PROVIDER || "").toUpperCase();

  if (supportedImageTypes.includes(file.type)) {
    return {
      type: "image",
      source_type: "url",
      mime_type: file.type,
      url: httpsUrl,
      metadata: { name: file.name, gsUrl, httpsUrl },
    };
  }

  // PDF
  if (provider === "OPENAI" && openaiFileId) {
    // Return ID-based file block for OpenAI
    return {
      type: "file",
      source_type: "id",
      mime_type: "application/pdf",
      id: openaiFileId,
      metadata: { filename: file.name, gsUrl, httpsUrl },
    };
  }

  // Default: send as public URL (non-OpenAI providers)
  return {
    type: "file",
    source_type: "url",
    mime_type: "application/pdf",
    url: httpsUrl,
    metadata: { filename: file.name, gsUrl, httpsUrl },
  };
}

// Helper to convert File to base64 string
// Removed legacy base64 helpers; preview remains backward-compatible.

// Type guard for previewable content blocks (image or PDF via base64, url, or id)
export function isPreviewableContentBlock(block: unknown): block is ExtendedContentBlock {
  if (typeof block !== "object" || block === null || !("type" in block))
    return false;
  const t = (block as { type?: unknown }).type;
  const st = (block as { source_type?: unknown }).source_type;
  const mt = (block as { mime_type?: unknown; mimeType?: unknown }).mime_type ||
    (block as { mimeType?: unknown }).mimeType;

  if (t === "image") {
    return (
      (st === "base64" || st === "url" || st === "id" || !st) &&
      typeof mt === "string" &&
      mt.startsWith("image/")
    );
  }
  if (t === "file") {
    return (
      (st === "base64" || st === "url" || st === "id" || st === "text" || !st) &&
      mt === "application/pdf"
    );
  }
  return false;
}

// Alias for backward compatibility with upstream code
export const isBase64ContentBlock = isPreviewableContentBlock;

// Convert gs://bucket/key to https://storage.googleapis.com/bucket/key
export function toPublicHttpUrl(gsUrl: string): string {
  if (!gsUrl) return gsUrl;
  try {
    if (gsUrl.startsWith("gs://")) {
      const withoutScheme = gsUrl.slice("gs://".length);
      const firstSlash = withoutScheme.indexOf("/");
      if (firstSlash === -1) return gsUrl;
      const bucket = withoutScheme.slice(0, firstSlash);
      const object = withoutScheme.slice(firstSlash + 1);
      return `https://storage.googleapis.com/${bucket}/${object}`;
    }
  } catch {
    // fallthrough to return original
  }
  return gsUrl;
}
