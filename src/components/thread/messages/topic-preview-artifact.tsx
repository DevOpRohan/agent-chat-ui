"use client";

import { type MouseEvent, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCcw, Share2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useArtifact } from "../artifact";
import { TooltipIconButton } from "../tooltip-icon-button";

type TopicPreviewArtifactProps = {
  topic_json_url?: unknown;
  preview_link?: unknown;
};

const TEST_IDS = {
  card: "topic-preview-artifact-card",
  download: "topic-preview-artifact-action-download",
  share: "topic-preview-artifact-action-share",
  refresh: "topic-preview-artifact-action-refresh",
  panelHeading: "topic-preview-artifact-panel-heading",
  iframe: "topic-preview-artifact-iframe",
};

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function fallbackCopyToClipboard(value: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

export function TopicPreviewArtifact(props: TopicPreviewArtifactProps) {
  const [ArtifactPane, artifact] = useArtifact();
  const [refreshNonce, setRefreshNonce] = useState(0);

  const topicJsonUrl = normalizeHttpUrl(props.topic_json_url);
  const previewLink = normalizeHttpUrl(props.preview_link);
  const panelTitle = "Topic Preview";

  const iframeUrl = useMemo(() => {
    if (!previewLink) return null;

    try {
      const parsed = new URL(previewLink);
      parsed.searchParams.set("_reload", String(refreshNonce));
      return parsed.toString();
    } catch {
      return null;
    }
  }, [previewLink, refreshNonce]);

  const hasPreview = iframeUrl !== null;

  const handleDownload = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!topicJsonUrl) {
      toast("Topic JSON URL is unavailable");
      return;
    }

    const popup = window.open(topicJsonUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast("Unable to open topic JSON");
    }
  };

  const handleShare = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!previewLink) {
      toast("Preview link is unavailable");
      return;
    }

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(previewLink);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = fallbackCopyToClipboard(previewLink);
    }

    if (copied) {
      toast("Preview link copied to clipboard");
    } else {
      toast("Unable to copy preview link");
    }
  };

  const handleRefresh = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!previewLink) {
      toast("Preview link is unavailable");
      return;
    }

    setRefreshNonce((current) => current + 1);
  };

  return (
    <>
      <button
        type="button"
        data-testid={TEST_IDS.card}
        onClick={() => artifact.setOpen(true)}
        className={cn(
          "bg-muted/60 hover:bg-muted border-border w-full cursor-pointer rounded-lg border p-3 text-left transition-colors",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-foreground truncate text-sm font-semibold">
              {panelTitle}
            </p>
            <p className="text-muted-foreground text-xs">
              Preview ready
            </p>
            <p className="text-muted-foreground text-xs">
              Click to open preview panel.
            </p>
          </div>
          <ExternalLink className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        </div>
      </button>

      {artifact.open ? (
        <ArtifactPane
          surfaceMode="iframe"
          title={
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p
                className="text-foreground truncate font-semibold"
                data-testid={TEST_IDS.panelHeading}
              >
                {panelTitle}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <TooltipIconButton
                  tooltip="Download JSON"
                  aria-label="Download topic JSON"
                  onClick={handleDownload}
                  data-testid={TEST_IDS.download}
                >
                  <Download className="size-4" />
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip="Share preview link"
                  aria-label="Share preview link"
                  onClick={handleShare}
                  data-testid={TEST_IDS.share}
                >
                  <Share2 className="size-4" />
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip="Refresh preview"
                  aria-label="Refresh preview iframe"
                  onClick={handleRefresh}
                  data-testid={TEST_IDS.refresh}
                >
                  <RefreshCcw className="size-4" />
                </TooltipIconButton>
              </div>
            </div>
          }
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {hasPreview ? (
              <div className="flex-1 min-h-0 bg-white pr-3">
                <iframe
                  key={iframeUrl}
                  data-testid={TEST_IDS.iframe}
                  title="Topic Preview"
                  src={iframeUrl}
                  scrolling="yes"
                  className="block h-full w-full border-0 bg-white"
                />
              </div>
            ) : (
              <div className="bg-muted/50 flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center">
                <TriangleAlert className="text-muted-foreground mb-2 size-5" />
                <p className="text-foreground text-sm font-medium">
                  Preview is unavailable right now
                </p>
                <p className="text-muted-foreground mt-1 max-w-md text-xs">
                  Preview link is missing or invalid. Use download/share once a valid preview is available.
                </p>
              </div>
            )}
          </div>
        </ArtifactPane>
      ) : null}
    </>
  );
}
