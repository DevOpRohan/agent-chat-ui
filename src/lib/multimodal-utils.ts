import type {
  URLContentBlock,
  Base64ContentBlock,
} from "@langchain/core/messages";
import { toast } from "sonner";

async function uploadToGCS(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onerror = () => {
      toast.error("Failed to upload file");
      reject(new Error("Failed to upload file"));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText) as { url: string };
          resolve(data.url);
        } catch {
          reject(new Error("Invalid upload response"));
        }
      } else {
        toast.error("Failed to upload file");
        reject(new Error("Failed to upload file"));
      }
    };
    xhr.send(formData);
  });
}

// Returns a Promise of a typed multimodal block for images or PDFs
export async function fileToContentBlock(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<URLContentBlock & { filename?: string }> {
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

  const gcsUrl = await uploadToGCS(file, onProgress);

  if (supportedImageTypes.includes(file.type)) {
    return {
      type: "image",
      source_type: "url",
      mime_type: file.type,
      url: gcsUrl,
      metadata: { name: file.name, gcsUrl },
    };
  }

  // PDF
  return {
    type: "file",
    source_type: "url",
    mime_type: "application/pdf",
    url: gcsUrl,
    filename: file.name,
    metadata: { filename: file.name, gcsUrl },
  };
}

// Helper to convert File to base64 string
export async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove the data:...;base64, prefix
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Type guard for Base64ContentBlock
export function isBase64ContentBlock(
  block: unknown,
): block is Base64ContentBlock {
  if (typeof block !== "object" || block === null || !("type" in block))
    return false;
  // file type (legacy)
  if (
    (block as { type: unknown }).type === "file" &&
    "source_type" in block &&
    (block as { source_type: unknown }).source_type === "base64" &&
    "mime_type" in block &&
    typeof (block as { mime_type?: unknown }).mime_type === "string" &&
    ((block as { mime_type: string }).mime_type.startsWith("image/") ||
      (block as { mime_type: string }).mime_type === "application/pdf")
  ) {
    return true;
  }
  // image type (new)
  if (
    (block as { type: unknown }).type === "image" &&
    "source_type" in block &&
    (block as { source_type: unknown }).source_type === "base64" &&
    "mime_type" in block &&
    typeof (block as { mime_type?: unknown }).mime_type === "string" &&
    (block as { mime_type: string }).mime_type.startsWith("image/")
  ) {
    return true;
  }
  return false;
}

export function isURLContentBlock(block: unknown): block is URLContentBlock {
  if (typeof block !== "object" || block === null || !("type" in block))
    return false;
  if (
    ((block as { type: unknown }).type === "image" ||
      (block as { type: unknown }).type === "audio" ||
      (block as { type: unknown }).type === "file") &&
    "source_type" in block &&
    (block as { source_type: unknown }).source_type === "url" &&
    "mime_type" in block &&
    typeof (block as { mime_type?: unknown }).mime_type === "string" &&
    "url" in block &&
    typeof (block as { url?: unknown }).url === "string"
  ) {
    return true;
  }
  return false;
}
