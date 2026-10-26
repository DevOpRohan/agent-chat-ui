"use client";

import { FileJson } from "lucide-react";
import { useCallback, type DragEvent, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useIngestThread } from "@/hooks/use-ingest-thread";
import { useIngestId } from "@/lib/app-mode";
import { formatDateTime } from "@/lib/ingest/format";
import type { IngestView } from "@/lib/ingest/ingest-types";
import { STALLED_COPY } from "@/lib/ingest/status-copy";
import { plural } from "@/lib/ingest/topic-file";

import { IngestStepsPanel, OnboardingPanel } from "./onboarding-panel";
import { ProgressPanel } from "./progress-panel";
import {
  ActionMessages,
  ResultPanel,
  RunAgainButton,
  StatusBanner,
  UploadDifferentButton,
} from "./result-panel";
import { StatusBadge } from "./status-badge";
import { TechnicalDetails } from "./technical-details";
import { UploadPanel } from "./upload-panel";

/** File drops anywhere else in the pane do nothing (no browser navigation, no chat upload). */
function swallowFileDrag(event: DragEvent) {
  if (event.defaultPrevented) return;
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "none";
}

function badgeStatus(view: IngestView): string {
  if (view.phase === "done") return view.result?.status ?? "unknown";
  return view.phase;
}

function TopicHeader({ view }: { view: IngestView }) {
  const { topic } = view;
  const parts: ReactNode[] = [];
  if (topic.fileName)
    parts.push(
      <span
        key="file"
        className="inline-flex min-w-0 items-center gap-1.5"
      >
        <FileJson
          className="size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="break-all">{topic.fileName}</span>
      </span>,
    );
  if (topic.questionSets !== undefined && topic.questions !== undefined)
    parts.push(
      <span key="counts">
        {plural(topic.questionSets, "question set")},{" "}
        {plural(topic.questions, "question")}
      </span>,
    );
  const uploaded = view.createdAt ? formatDateTime(view.createdAt) : "";
  if (uploaded) parts.push(<span key="uploaded">Uploaded {uploaded}</span>);

  return (
    <header data-testid="ingest-topic-header">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm font-medium">
          Topic ingestion
        </p>
        <StatusBadge status={badgeStatus(view)} />
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight break-words">
        {topic.name}
      </h1>
      {parts.length ? (
        <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {parts.flatMap((part, index) =>
            index === 0
              ? [part]
              : [
                  <span
                    key={`dot-${index}`}
                    aria-hidden="true"
                  >
                    ·
                  </span>,
                  part,
                ],
          )}
        </p>
      ) : null}
    </header>
  );
}

function LoadingState({ error }: { error: string | null }) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="space-y-4"
      data-testid="ingest-loading"
    >
      <p className="sr-only">Loading your topic ingestion…</p>
      {error ? (
        <p
          role="status"
          className="bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div data-testid="ingest-not-found">
      <StatusBanner
        tone="neutral"
        title="We couldn't find this upload."
        body="The link may be wrong, or it may belong to a different account."
      >
        <UploadDifferentButton
          onClick={onBack}
          primary
          label="Upload a topic"
        />
      </StatusBanner>
    </div>
  );
}

/** The Ingester pane: upload, progress and result of one ingest (one LangGraph thread). */
export function IngestPane() {
  const [ingestId, setIngestId] = useIngestId();
  const ingest = useIngestThread(ingestId, setIngestId);
  const { view, error, limitNotice, starting } = ingest;
  const runAgainAsync = ingest.runAgain;
  const backToUpload = useCallback(() => setIngestId(null), [setIngestId]);
  const runAgain = useCallback(() => void runAgainAsync(), [runAgainAsync]);

  const canRunAgain =
    !!view &&
    !!view.sourceUrl &&
    !view.busy &&
    view.phase !== "running" &&
    !starting;

  let content: ReactNode;
  if (!ingestId) {
    content = (
      <>
        <UploadPanel
          starting={starting}
          error={error}
          limitNotice={limitNotice}
          onIngest={ingest.start}
        />
        <OnboardingPanel />
        <IngestStepsPanel />
      </>
    );
  } else if (ingest.notFound) {
    content = <NotFound onBack={backToUpload} />;
  } else if (!view || (view.phase === "done" && !view.result)) {
    content = <LoadingState error={error} />;
  } else if (view.phase === "done" && view.result) {
    content = (
      <>
        <TopicHeader view={view} />
        <ResultPanel
          threadId={view.threadId}
          topic={view.topic}
          result={view.result}
          canRunAgain={canRunAgain}
          starting={starting}
          onRunAgain={runAgain}
          onUploadDifferent={backToUpload}
          actionError={error}
          limitNotice={limitNotice}
        />
      </>
    );
  } else {
    const progress = view.progress ?? {
      stage: "queued",
      queued: true,
      fixSeen: false,
    };
    const stalled = view.phase === "stalled";
    content = (
      <>
        <TopicHeader view={view} />
        {error && !stalled ? (
          <p
            role="status"
            className="bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        {stalled ? (
          <div
            className="space-y-6"
            data-testid="ingest-result"
            data-status="stalled"
          >
            <StatusBanner
              tone={STALLED_COPY.tone}
              title={STALLED_COPY.title}
              body={STALLED_COPY.body}
            >
              <RunAgainButton
                disabled={!canRunAgain}
                starting={starting}
                onRunAgain={runAgain}
                secondary={!canRunAgain}
              />
              <UploadDifferentButton
                onClick={backToUpload}
                primary={!canRunAgain}
                disabled={starting}
              />
            </StatusBanner>
            <ActionMessages
              error={error}
              limitNotice={limitNotice}
            />
            <ProgressPanel
              stage={progress.stage}
              queued={progress.queued}
              fixSeen={progress.fixSeen}
              startedAt={ingest.startedAt}
            />
            <TechnicalDetails
              threadId={view.threadId}
              reason="Still waiting for the check to report back."
            />
          </div>
        ) : (
          <ProgressPanel
            stage={progress.stage}
            queued={progress.queued}
            fixSeen={progress.fixSeen}
            startedAt={ingest.startedAt}
          />
        )}
      </>
    );
  }

  return (
    <div
      data-testid="ingest-pane"
      className="min-h-0 flex-1 overflow-y-auto px-4"
      onDragOver={swallowFileDrag}
      onDrop={swallowFileDrag}
    >
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pt-8 pb-16">
        {content}
      </div>
    </div>
  );
}
