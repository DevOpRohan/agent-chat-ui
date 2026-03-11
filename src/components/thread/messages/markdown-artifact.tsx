"use client";

import { type MouseEvent, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  LoaderCircle,
  RefreshCcw,
  Share2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useArtifact } from "../artifact";
import { MarkdownText } from "../markdown-text";
import { TooltipIconButton } from "../tooltip-icon-button";

type MarkdownArtifactProps = {
  name?: unknown;
  url?: unknown;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const TEST_IDS = {
  card: "markdown-artifact-card",
  openRaw: "markdown-artifact-action-open-raw",
  share: "markdown-artifact-action-share",
  refresh: "markdown-artifact-action-refresh",
  panelHeading: "markdown-artifact-panel-heading",
  loading: "markdown-artifact-loading",
  rendered: "markdown-artifact-rendered",
  error: "markdown-artifact-error",
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

function normalizeArtifactName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `Unable to load markdown artifact (${response.status})`;

  try {
    const text = await response.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function MarkdownArtifact(props: MarkdownArtifactProps) {
  const [ArtifactPane, artifact] = useArtifact();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [content, setContent] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const artifactName = normalizeArtifactName(props.name) ?? "Markdown Artifact";
  const markdownUrl = normalizeHttpUrl(props.url);

  const proxyUrl = useMemo(() => {
    if (!markdownUrl) return null;

    const params = new URLSearchParams({
      url: markdownUrl,
      _reload: String(refreshNonce),
    });

    return `/api/markdown-artifact?${params.toString()}`;
  }, [markdownUrl, refreshNonce]);

  useEffect(() => {
    if (!artifact.open || !proxyUrl) return;

    const controller = new AbortController();
    setLoadState("loading");
    setErrorMessage(null);

    void fetch(proxyUrl, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        return response.text();
      })
      .then((markdownText) => {
        setContent(markdownText);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;

        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unable to load markdown artifact";
        setErrorMessage(message);
        setLoadState("error");
      });

    return () => controller.abort();
  }, [artifact.open, proxyUrl]);

  const handleOpenRaw = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!markdownUrl) {
      toast("Markdown artifact URL is unavailable");
      return;
    }

    const popup = window.open(markdownUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      toast("Unable to open markdown artifact");
    }
  };

  const handleShare = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!markdownUrl) {
      toast("Markdown artifact URL is unavailable");
      return;
    }

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdownUrl);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      copied = fallbackCopyToClipboard(markdownUrl);
    }

    if (copied) {
      toast("Markdown artifact link copied to clipboard");
    } else {
      toast("Unable to copy markdown artifact link");
    }
  };

  const handleRefresh = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!markdownUrl) {
      toast("Markdown artifact URL is unavailable");
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
              {artifactName}
            </p>
            <p className="text-muted-foreground text-xs">
              Markdown + LaTeX preview
            </p>
            <p className="text-muted-foreground text-xs">
              Click to open artifact panel.
            </p>
          </div>
          <ExternalLink className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        </div>
      </button>

      {artifact.open ? (
        <ArtifactPane
          title={
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p
                className="text-foreground truncate font-semibold"
                data-testid={TEST_IDS.panelHeading}
              >
                {artifactName}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <TooltipIconButton
                  tooltip="Open raw markdown"
                  aria-label="Open raw markdown artifact"
                  onClick={handleOpenRaw}
                  data-testid={TEST_IDS.openRaw}
                >
                  <ExternalLink className="size-4" />
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip="Share markdown link"
                  aria-label="Share markdown artifact link"
                  onClick={handleShare}
                  data-testid={TEST_IDS.share}
                >
                  <Share2 className="size-4" />
                </TooltipIconButton>
                <TooltipIconButton
                  tooltip="Refresh artifact"
                  aria-label="Refresh markdown artifact"
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
            {!markdownUrl ? (
              <div
                className="bg-muted/50 flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center"
                data-testid={TEST_IDS.error}
              >
                <TriangleAlert className="text-muted-foreground mb-2 size-5" />
                <p className="text-foreground text-sm font-medium">
                  Markdown artifact is unavailable right now
                </p>
                <p className="text-muted-foreground mt-1 max-w-md text-xs">
                  Artifact URL is missing or invalid. Open/share actions will
                  work once a valid markdown URL is available.
                </p>
              </div>
            ) : loadState === "idle" || loadState === "loading" ? (
              <div
                className="bg-muted/30 flex flex-1 min-h-0 flex-col items-center justify-center gap-3 p-6 text-center"
                data-testid={TEST_IDS.loading}
              >
                <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
                <div className="space-y-1">
                  <p className="text-foreground text-sm font-medium">
                    Loading markdown artifact
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Fetching the latest markdown for preview.
                  </p>
                </div>
              </div>
            ) : loadState === "error" ? (
              <div
                className="bg-muted/50 flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center"
                data-testid={TEST_IDS.error}
              >
                <TriangleAlert className="text-muted-foreground mb-2 size-5" />
                <p className="text-foreground text-sm font-medium">
                  Markdown preview failed to load
                </p>
                <p className="text-muted-foreground mt-1 max-w-md text-xs">
                  {errorMessage ?? "Unable to load markdown artifact."}
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div
                  className="bg-card border-border min-h-full rounded-xl border p-6"
                  data-testid={TEST_IDS.rendered}
                >
                  <MarkdownText>{content}</MarkdownText>
                </div>
              </div>
            )}
          </div>
        </ArtifactPane>
      ) : null}
    </>
  );
}
