import React from "react";
import { File, Image as ImageIcon, X as XIcon } from "lucide-react";
import type {
  URLContentBlock,
  Base64ContentBlock,
} from "@langchain/core/messages";
import { cn } from "@/lib/utils";
import Image from "next/image";
export interface MultimodalPreviewProps {
  block: URLContentBlock | Base64ContentBlock;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  progress?: number;
}

export const MultimodalPreview: React.FC<MultimodalPreviewProps> = ({
  block,
  removable = false,
  onRemove,
  className,
  size = "md",
  progress,
}) => {
  // Image block
  if (
    block.type === "image" &&
    (block.source_type === "base64" || block.source_type === "url") &&
    typeof block.mime_type === "string" &&
    block.mime_type.startsWith("image/")
  ) {
    const url =
      block.source_type === "base64"
        ? `data:${block.mime_type};base64,${(block as Base64ContentBlock).data}`
        : (block as URLContentBlock).url;
    let imgClass: string = "rounded-md object-cover h-16 w-16 text-lg";
    if (size === "sm") imgClass = "rounded-md object-cover h-10 w-10 text-base";
    if (size === "lg") imgClass = "rounded-md object-cover h-24 w-24 text-xl";
    return (
      <div className={cn("relative inline-block", className)}>
        <Image
          src={url}
          alt={String(block.metadata?.name || "uploaded image")}
          className={imgClass}
          width={size === "sm" ? 16 : size === "md" ? 32 : 48}
          height={size === "sm" ? 16 : size === "md" ? 32 : 48}
        />
        {progress !== undefined && progress < 1 && (
          <div className="absolute inset-0 flex items-end justify-center">
            <div className="h-2 w-3/4 rounded bg-gray-200">
              <div
                className="h-full rounded bg-teal-600"
                style={{ width: `${Math.floor(progress * 100)}%` }}
              />
            </div>
          </div>
        )}
        {removable && (
          <button
            type="button"
            className="absolute top-1 right-1 z-10 rounded-full bg-gray-500 text-white hover:bg-gray-700"
            onClick={onRemove}
            aria-label="Remove image"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // PDF block
  if (
    block.type === "file" &&
    (block.source_type === "base64" || block.source_type === "url") &&
    block.mime_type === "application/pdf"
  ) {
    const filename =
      block.metadata?.filename || block.metadata?.name || "PDF file";
    return (
      <div
        className={cn(
          "relative flex items-start gap-2 rounded-md border bg-gray-100 px-3 py-2",
          className,
        )}
      >
        <div className="flex flex-shrink-0 flex-col items-start justify-start">
          <File
            className={cn(
              "text-teal-700",
              size === "sm" ? "h-5 w-5" : "h-7 w-7",
            )}
          />
        </div>
        <span
          className={cn("min-w-0 flex-1 text-sm break-all text-gray-800")}
          style={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
        >
          {String(filename)}
        </span>
        {progress !== undefined && progress < 1 && (
          <div className="absolute right-0 bottom-0 left-0 mx-3 mb-1 h-1 rounded bg-gray-200">
            <div
              className="h-full rounded bg-teal-600"
              style={{ width: `${Math.floor(progress * 100)}%` }}
            />
          </div>
        )}
        {removable && (
          <button
            type="button"
            className="ml-2 self-start rounded-full bg-gray-200 p-1 text-teal-700 hover:bg-gray-300"
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
        "flex items-center gap-2 rounded-md border bg-gray-100 px-3 py-2 text-gray-500",
        className,
      )}
    >
      <File className="h-5 w-5 flex-shrink-0" />
      <span className="truncate text-xs">Unsupported file type</span>
      {removable && (
        <button
          type="button"
          className="ml-2 rounded-full bg-gray-200 p-1 text-gray-500 hover:bg-gray-300"
          onClick={onRemove}
          aria-label="Remove file"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
