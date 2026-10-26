"use client";

import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Info,
  LoaderCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { MarkdownText } from "@/components/thread/markdown-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { IngestLimitNotice } from "@/hooks/use-ingest-thread";
import {
  downloadTextFile,
  reportFileName,
  topicFileHref,
} from "@/lib/ingest/file-links";
import type { IngestResult, IngestTopicInfo } from "@/lib/ingest/ingest-types";
import { SET_KEY_MARKER } from "@/lib/ingest/plain-issues";
import {
  friendlyWarnings,
  KEEP_IN_STEP_TEXT,
  KEEP_IN_STEP_TITLE,
  PREVIEW_HINT,
  REPORT_DOWNLOAD_LABEL,
  REPORT_FULL_LABEL,
  statusCopy,
  UPDATED_FILES_NEXT_STEPS,
  UPDATED_FILES_TEXT,
  UPDATED_FILES_TITLE,
  type Tone,
} from "@/lib/ingest/status-copy";
import { cn } from "@/lib/utils";

import { CopyButton } from "./copy-button";
import { issueSummary, TONE_ICONS, toneText } from "./ingest-helpers";
import { IssueList } from "./issue-list";
import { MoreMenu, type MoreItem } from "./more-menu";
import { TechnicalDetails } from "./technical-details";

const ACTION = "w-full sm:w-auto";

/**
 * Reports name sets "Set N `set-key:<ct key>`" (plain-issues' labelSetsInMarkdown); the chat's
 * Markdown renderer has no special case for that marker, so the key shows as plain inline code.
 */
function reportMarkdown(markdown: string): string {
  return markdown.split("`" + SET_KEY_MARKER).join("`");
}

export function StatusBanner({
  tone,
  title,
  body,
  note,
  children,
  hint,
  status,
}: {
  tone: Tone;
  title: string;
  body?: ReactNode;
  note?: string;
  children?: ReactNode;
  /** One line under the actions, for example how the preview opens. */
  hint?: string;
  status?: ReactNode;
}) {
  const Icon = TONE_ICONS[tone];
  const headingId = useId();
  return (
    <Card
      aria-labelledby={headingId}
      role="region"
      className="gap-0 px-5 py-5 sm:px-6"
      data-testid="ingest-status-banner"
      data-tone={tone}
    >
      <div className="flex gap-4">
        <span
          className={cn(
            "bg-muted flex size-10 shrink-0 items-center justify-center rounded-full",
            toneText(tone),
          )}
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className="text-xl font-semibold tracking-tight"
          >
            {title}
          </h2>
          {body ? <p className="mt-2 leading-relaxed">{body}</p> : null}
          {note ? (
            <p
              className={cn(
                "bg-muted mt-3 rounded-md px-3 py-2 text-sm",
                toneText(tone),
              )}
              data-testid="ingest-result-note"
            >
              {note}
            </p>
          ) : null}
        </div>
      </div>
      {children ? (
        <div
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          data-testid="ingest-actions"
        >
          {children}
        </div>
      ) : null}
      {hint ? (
        <p
          className="text-muted-foreground mt-3 text-sm"
          data-testid="ingest-result-hint"
        >
          {hint}
        </p>
      ) : null}
      {status}
    </Card>
  );
}

/** The run-again / limit messages under a banner. */
export function ActionMessages({
  error,
  limitNotice,
}: {
  error?: string | null;
  limitNotice?: IngestLimitNotice | null;
}) {
  if (!error && !limitNotice) return null;
  return (
    <>
      {error ? (
        <p
          role="alert"
          className="text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}
      {limitNotice ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
          data-testid="ingest-limit-notice"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            <strong>{limitNotice.title}:</strong> {limitNotice.description}
          </span>
        </p>
      ) : null}
    </>
  );
}

/** "Run again": a new run on the same thread with the same uploaded file. */
export function RunAgainButton({
  disabled,
  starting,
  onRunAgain,
  secondary = false,
}: {
  disabled: boolean;
  starting: boolean;
  onRunAgain: () => void;
  /** Outline style, when another action leads. */
  secondary?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={secondary ? "outline" : "default"}
      className={ACTION}
      onClick={onRunAgain}
      disabled={disabled || starting}
    >
      {starting ? (
        <LoaderCircle
          className="animate-spin"
          aria-hidden="true"
        />
      ) : (
        <RotateCcw aria-hidden="true" />
      )}
      {starting ? "Starting again…" : "Run again"}
    </Button>
  );
}

export function UploadDifferentButton({
  onClick,
  primary = false,
  label = "Upload a different file",
  disabled,
}: {
  onClick: () => void;
  primary?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={primary ? "default" : "outline"}
      className={ACTION}
      onClick={onClick}
      disabled={disabled}
    >
      <Upload aria-hidden="true" />
      {label}
    </Button>
  );
}

function SoftNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <ul
      className="space-y-2"
      data-testid="ingest-warnings"
    >
      {notes.map((note) => (
        <li
          key={note}
          className="bg-muted text-muted-foreground flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm"
        >
          <Info
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionCard({
  title,
  intro,
  children,
  testId,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  const headingId = useId();
  return (
    <Card
      aria-labelledby={headingId}
      role="region"
      className="gap-0 overflow-hidden py-0"
      data-testid={testId}
    >
      <div className="border-b px-4 py-3 sm:px-6">
        <h2
          id={headingId}
          className="font-semibold"
        >
          {title}
        </h2>
        {intro ? (
          <p className="text-muted-foreground mt-1 text-sm">{intro}</p>
        ) : null}
      </div>
      <div className="min-w-0 overflow-x-auto px-4 py-4 sm:px-6">
        {children}
      </div>
    </Card>
  );
}

/** A soft box for the creator's next step (no colour of its own). */
function NoteBox({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="bg-muted rounded-xl border px-4 py-4 sm:px-6"
      data-testid={testId}
    >
      <h2
        id={headingId}
        className="font-semibold"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The changed topic as a matching pair: the .md to read and edit, the .json for the platform. */
function UpdatedFiles({
  mdUrl,
  jsonUrl,
  baseName,
}: {
  mdUrl: string;
  jsonUrl: string;
  baseName: string;
}) {
  return (
    <NoteBox
      title={UPDATED_FILES_TITLE}
      testId="ingest-updated-files"
    >
      <p className="mt-1.5 leading-relaxed">{UPDATED_FILES_TEXT}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button
          asChild
          variant="outline"
          className={ACTION}
        >
          <a
            href={topicFileHref(mdUrl, `${baseName}.md`)}
            download={`${baseName}.md`}
          >
            <FileText aria-hidden="true" />
            Download the .md
          </a>
        </Button>
        <Button
          asChild
          variant="outline"
          className={ACTION}
        >
          <a
            href={topicFileHref(jsonUrl, `${baseName}.json`)}
            download={`${baseName}.json`}
          >
            <FileJson aria-hidden="true" />
            Download the .json
          </a>
        </Button>
      </div>
    </NoteBox>
  );
}

/** The technical report, closed by default: it's written for the creator's assistant. */
function FullReport({ markdown }: { markdown: string }) {
  return (
    <details
      className="group bg-card rounded-md border"
      data-testid="ingest-full-report"
    >
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 rounded-md px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {REPORT_FULL_LABEL}
      </summary>
      <div className="min-w-0 overflow-x-auto border-t px-4 py-4">
        <MarkdownText>{reportMarkdown(markdown)}</MarkdownText>
      </div>
    </details>
  );
}

export function ResultPanel({
  threadId,
  topic,
  result,
  canRunAgain,
  starting,
  onRunAgain,
  onUploadDifferent,
  actionError,
  limitNotice,
}: {
  threadId: string;
  topic: IngestTopicInfo;
  result: IngestResult;
  /** Not busy and the uploaded file's link is known. */
  canRunAgain: boolean;
  starting: boolean;
  onRunAgain: () => void;
  /** Back to the upload panel (clears ingestId). */
  onUploadDifferent: () => void;
  actionError?: string | null;
  limitNotice?: IngestLimitNotice | null;
}) {
  const copy = statusCopy(result.status, result.message);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const preview = copy.showPreview ? result.previewLink : undefined;
  const report = copy.report !== "none" ? result.issueReportMd : undefined;
  const updaterReport = copy.showUpdaterReport
    ? result.updaterReport
    : undefined;
  const issues = copy.showIssues ? result.issues : [];
  const notes = friendlyWarnings({
    status: result.status,
    warnings: result.warnings,
    hasPreview: !!result.previewLink,
  });
  // Topic files only when the fixer changed the topic, and only as a matching pair.
  const updatedFiles =
    result.topicMdUrl && result.topicJsonUrl
      ? { mdUrl: result.topicMdUrl, jsonUrl: result.topicJsonUrl }
      : null;
  const nextSteps =
    copy.nextSteps && updatedFiles ? UPDATED_FILES_NEXT_STEPS : copy.nextSteps;
  const downloadReport = () => {
    if (report) downloadTextFile(report, reportFileName(topic.downloadName));
  };

  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setNotice(`We couldn't copy it automatically. Here it is: ${text}`);
    }
  };

  const runAgain = (
    <>
      <RunAgainButton
        disabled={!canRunAgain}
        starting={starting}
        onRunAgain={onRunAgain}
      />
      <UploadDifferentButton
        onClick={onUploadDifferent}
        disabled={starting}
      />
    </>
  );

  let actions: ReactNode;
  let hint: string | undefined;
  let uploadAnother = false;
  switch (copy.primaryAction) {
    case "open_preview": {
      if (preview) {
        // A new tab, not an embedded frame: the preview may say it is still being prepared, and
        // the creator can refresh that tab without losing this page.
        hint = PREVIEW_HINT;
        uploadAnother = true;
        actions = (
          <>
            <Button
              asChild
              className={ACTION}
            >
              <a
                href={preview}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink aria-hidden="true" />
                Open preview
              </a>
            </Button>
            <CopyButton
              text={preview}
              label="Copy preview link"
            />
          </>
        );
      } else {
        // The topic is ready but its preview link didn't come back: a new run asks for it again.
        actions = runAgain;
      }
      break;
    }
    case "download_report": {
      const more: MoreItem[] = preview
        ? [
            {
              label: "Open preview in a new tab",
              icon: ExternalLink,
              href: preview,
              external: true,
            },
            {
              label: "Copy preview link",
              icon: Copy,
              onSelect: () => void copyText(preview, "Preview link copied."),
            },
          ]
        : [];
      actions = (
        <>
          {report ? (
            <Button
              type="button"
              className={ACTION}
              onClick={downloadReport}
            >
              <Download aria-hidden="true" />
              {REPORT_DOWNLOAD_LABEL}
            </Button>
          ) : null}
          <UploadDifferentButton
            onClick={onUploadDifferent}
            primary={!report}
            label="Upload the new .json"
          />
          <MoreMenu items={more} />
        </>
      );
      break;
    }
    case "try_again":
    case "upload_again":
      // Both start a new run on the same thread with the same uploaded file.
      actions = runAgain;
      break;
    default:
      actions = (
        <UploadDifferentButton
          onClick={onUploadDifferent}
          primary
        />
      );
  }

  const summaryLine = issueSummary(issues);

  return (
    <div
      className="space-y-6"
      data-testid="ingest-result"
      data-status={result.status}
    >
      <StatusBanner
        tone={copy.tone}
        title={copy.title}
        body={copy.body}
        note={copy.note}
        hint={hint}
        status={
          <p
            role="status"
            aria-live="polite"
            className="text-muted-foreground mt-3 text-sm break-all empty:hidden"
          >
            {notice}
          </p>
        }
      >
        {actions}
      </StatusBanner>

      <ActionMessages
        error={actionError}
        limitNotice={limitNotice}
      />

      <SoftNotes notes={notes} />

      {nextSteps ? (
        <NoteBox
          title="What to do next"
          testId="ingest-next-steps"
        >
          <p className="mt-1.5 leading-relaxed">{nextSteps}</p>
        </NoteBox>
      ) : null}

      {updatedFiles ? (
        <UpdatedFiles
          mdUrl={updatedFiles.mdUrl}
          jsonUrl={updatedFiles.jsonUrl}
          baseName={topic.downloadName}
        />
      ) : null}

      {copy.showIssues && (issues.length || report) ? (
        <SectionCard
          title="What needs fixing"
          testId="ingest-issues"
          intro={summaryLine ?? undefined}
        >
          {issues.length ? <IssueList groups={issues} /> : null}
          {report ? (
            <div className={issues.length ? "mt-5" : ""}>
              <FullReport markdown={report} />
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      {copy.report === "keep_in_step" && report && !updatedFiles ? (
        <NoteBox
          title={KEEP_IN_STEP_TITLE}
          testId="ingest-keep-in-step"
        >
          <p className="mt-1.5 leading-relaxed">{KEEP_IN_STEP_TEXT}</p>
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              className={ACTION}
              onClick={downloadReport}
            >
              <Download aria-hidden="true" />
              {REPORT_DOWNLOAD_LABEL}
            </Button>
          </div>
          <div className="mt-4">
            <FullReport markdown={report} />
          </div>
        </NoteBox>
      ) : null}

      {updaterReport ? (
        <SectionCard
          title={copy.updaterReportTitle}
          testId="ingest-updater-report"
        >
          <MarkdownText>{reportMarkdown(updaterReport)}</MarkdownText>
        </SectionCard>
      ) : null}

      <TechnicalDetails
        threadId={threadId}
        result={result}
      />

      {uploadAnother ? (
        <nav
          aria-label="Other actions"
          className="border-t pt-5"
        >
          <Button
            type="button"
            variant="ghost"
            className={ACTION}
            onClick={onUploadDifferent}
          >
            <Upload aria-hidden="true" />
            Upload another topic
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
