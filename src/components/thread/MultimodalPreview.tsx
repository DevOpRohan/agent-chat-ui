import React from "react";
import { File, X as XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { ExtendedContentBlock } from "@/lib/multimodal-utils";

export interface MultimodalPreviewProps {
  block: ExtendedContentBlock;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export const MultimodalPreview: React.FC<MultimodalPreviewProps> = ({
  block,
  removable = false,
  onRemove,
  className,
  size = "md",
}) => {
  // Image block (base64 or url)
  if (block.type === "image") {
    // Get mime type (supports both SDK 1.0 mimeType and custom mime_type)
    const mimeType = (block as any).mimeType || (block as any).mime_type;
    if (typeof mimeType === "string" && mimeType.startsWith("image/")) {
      // Determine URL based on source type
      let url: string | undefined;
      const sourceType = (block as any).source_type;

      if (sourceType === "base64" || (!sourceType && (block as any).data)) {
        // Base64 encoded image (SDK 1.0 format)
        url = `data:${mimeType};base64,${(block as any).data}`;
      } else if (sourceType === "url" || (block as any).url) {
        // URL-based image (custom GCS upload)
        url = String((block as any).url);
      }

      if (url) {
        let imgClass: string = "rounded-md object-cover h-16 w-16 text-lg";
        if (size === "sm")
          imgClass = "rounded-md object-cover h-10 w-10 text-base";
        if (size === "lg")
          imgClass = "rounded-md object-cover h-24 w-24 text-xl";
        return (
          <div className={cn("relative inline-block", className)}>
            <Image
              src={url}
              alt={String((block as any).metadata?.name || "uploaded image")}
              className={imgClass}
              width={size === "sm" ? 16 : size === "md" ? 32 : 48}
              height={size === "sm" ? 16 : size === "md" ? 32 : 48}
            />
            {removable && (
              <button
                type="button"
                className="bg-foreground/80 text-background hover:bg-foreground absolute top-1 right-1 z-10 rounded-full transition-colors"
                onClick={onRemove}
                aria-label="Remove image"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      }
    }
  }

  // PDF block
  const fileMimeType = (block as any).mimeType || (block as any).mime_type;
  if (block.type === "file" && fileMimeType === "application/pdf") {
    const filename =
      (block as any).metadata?.filename ||
      (block as any).metadata?.name ||
      "PDF file";
    return (
      <div
        className={cn(
          "bg-muted relative flex items-start gap-2 rounded-md border px-3 py-2",
          className,
        )}
      >
        <div className="flex flex-shrink-0 flex-col items-start justify-start">
          <File
            className={cn(
              "text-primary",
              size === "sm" ? "h-5 w-5" : "h-7 w-7",
            )}
          />
        </div>
        <span
          className={cn("text-foreground min-w-0 flex-1 text-sm break-all")}
          style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
        >
          {String(filename)}
        </span>
        {removable && (
          <button
            type="button"
            className="text-primary bg-background border-border hover:bg-accent ml-2 self-start rounded-full border p-1 transition-colors"
            onClick={onRemove}
            aria-label="Remove PDF"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div
      className={cn(
        "text-muted-foreground bg-muted flex items-center gap-2 rounded-md border px-3 py-2",
        className,
      )}
    >
      <File className="h-5 w-5 flex-shrink-0" />
      <span className="truncate text-xs">Unsupported file type</span>
      {removable && (
        <button
          type="button"
          className="text-muted-foreground bg-background border-border hover:bg-accent hover:text-foreground ml-2 rounded-full border p-1 transition-colors"
          onClick={onRemove}
          aria-label="Remove file"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
