import React from "react";
import type {
  URLContentBlock,
  Base64ContentBlock,
} from "@langchain/core/messages";
import { MultimodalPreview } from "./MultimodalPreview";
import { cn } from "@/lib/utils";

interface ContentBlocksPreviewProps {
  blocks: (URLContentBlock | Base64ContentBlock)[];
  onRemove: (idx: number) => void;
  progress?: Record<string, number>;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Renders a preview of content blocks with optional remove functionality.
 * Uses cn utility for robust class merging.
 */
export const ContentBlocksPreview: React.FC<ContentBlocksPreviewProps> = ({
  blocks,
  onRemove,
  progress = {},
  size = "md",
  className,
}) => {
  if (!blocks.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2 p-3.5 pb-0", className)}>
      {blocks.map((block, idx) => {
        const name =
          block.type === "image"
            ? String(block.metadata?.name)
            : String(block.metadata?.filename);
        return (
          <MultimodalPreview
            key={idx}
            block={block}
            removable
            onRemove={() => onRemove(idx)}
            size={size}
            progress={progress[name]}
          />
        );
      })}
    </div>
  );
};
