/**
 * Plain words for every result the topic_ingest graph can return (the same six as topic_import),
 * plus the UI-only results, and which actions each result offers.
 *
 * Creators are teachers and content writers, so nothing here mentions JSON fields, status
 * codes or tools. The wording follows the TopicCrafter skill's own description of the platform
 * (skills/topic-crafter/references/platform.md).
 *
 * Action rules: one primary action per state; at most two visible secondary actions; anything
 * else goes in a "More" menu or under Technical details.
 *
 * In agent-chat-ui the uploaded file stays on the ingest thread (`metadata.ingest_source_url`),
 * so the ingest pane renders the "try_again" and "upload_again" primary actions as "Run again":
 * the same file, as a new run on the same thread. The copy below is kept word for word from
 * topic-ingester (src/lib/status-copy.ts); only that button label is the UI's own.
 */

import { INGEST_FINAL_STATUSES, type IngestFinalStatus } from "./ingest-types";

/** The graph's six final statuses (INGEST_FINAL_STATUSES in ingest-types.ts). */
export const IMPORT_STATUSES = INGEST_FINAL_STATUSES;

export type ImportStatus = IngestFinalStatus;

export function isImportStatus(value: unknown): value is ImportStatus {
  return (
    typeof value === "string" &&
    (IMPORT_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Colour semantics: success = green (valid, fixed); attention = amber (needs attention,
 * fix step failed); retry = blue with a retry icon (couldn't finish, run failed);
 * error = red (couldn't read the file) only. Text always accompanies colour and icon.
 */
export type Tone = "success" | "attention" | "retry" | "error" | "neutral";

export type PrimaryAction =
  | "open_preview"
  | "download_report"
  | "try_again"
  | "upload_new"
  | "upload_again";

/**
 * Set by this app (not the graph) when the check couldn't be started at all: the ingest thread has
 * no run (for example, `runs.create` was refused).
 */
export const FAILED_TO_START = "failed_to_start";

/**
 * Set by this app (not the graph) when the run ended without a record (the thread is in error, or
 * its last run ended some other way). It reads exactly like validation_incomplete (the topic isn't
 * the problem; run it again).
 */
export const RUN_ERROR = "run_error";

export interface StatusCopy {
  status: ImportStatus | typeof FAILED_TO_START | typeof RUN_ERROR | "unknown";
  tone: Tone;
  /** Short label for badges in the history list. */
  badge: string;
  title: string;
  body: string;
  primaryAction: PrimaryAction;
  /** Extra line under the title (for example, why the fixer didn't help). */
  note?: string;
  /** "What to do next" box. */
  nextSteps?: string;
  /** Where the report for the assistant is offered. */
  report: "primary" | "keep_in_step" | "none";
  showPreview: boolean;
  /** The plain-language list of open issues. */
  showIssues: boolean;
  showUpdaterReport: boolean;
  updaterReportTitle: string;
}

export const REPORT_DOWNLOAD_LABEL = "Download report for your assistant";
export const REPORT_FULL_LABEL = "Show the full report (for your assistant)";

export const REPORT_INSTRUCTIONS =
  "Give this report and your topic's .md file to your assistant (TopicCrafter), ask it to fix only these issues, then upload the new .json here.";

/**
 * When the fixer changed the topic, the creator gets the changed topic as a matching .md and
 * .json pair. The graph makes the .md with the skill's parser and keeps it only when it turns
 * back into exactly that .json. A topic that the fixer didn't change offers no files: the
 * creator's own copies are still current.
 */
export const UPDATED_FILES_TITLE = "Your updated topic files";
export const UPDATED_FILES_TEXT =
  "We changed your topic, so your own .md and .json are now out of date. Download both and use them instead of your old copies. The .md is the one to read and to give your assistant next time. The .json is the one the platform takes.";
export const UPDATED_FILES_NEXT_STEPS =
  "Download the updated .md and .json below. Give the .md and this report to your assistant (TopicCrafter), ask it to fix only these issues, then upload the new .json here.";

export const PREVIEW_HINT =
  "The preview opens in a new tab. If it says it's still being prepared, wait a minute, then refresh that tab.";

/** Only when the fixer changed the topic but its matching .md couldn't be made. */
export const KEEP_IN_STEP_TITLE = "Keep your own copy in step";
export const KEEP_IN_STEP_TEXT =
  "We changed your topic here, so your own .md is now a little behind. Give this report and your .md to your assistant (TopicCrafter) and ask it to copy our fixes across. There's no need to upload again.";

const NEEDS_ATTENTION_BODY =
  "Your assistant can fix these for you. Here's what we found, in plain words.";

const COPY: Record<ImportStatus, StatusCopy> = {
  valid: {
    status: "valid",
    tone: "success",
    badge: "Ready",
    title: "Your topic is ready.",
    body: "Every question passed our checks. Have a look through the preview: try a few questions as a learner would, and check the answers, maths, pictures and hints.",
    primaryAction: "open_preview",
    report: "none",
    showPreview: true,
    showIssues: false,
    showUpdaterReport: false,
    updaterReportTitle: "What we changed",
  },
  fixed: {
    status: "fixed",
    tone: "success",
    badge: "Ready, with fixes",
    title: "We fixed a few small formatting issues. Your topic is ready.",
    body: "We only touched formatting, never the meaning or the answers. Have a look at the preview, starting with the questions we changed.",
    primaryAction: "open_preview",
    report: "keep_in_step",
    showPreview: true,
    showIssues: false,
    showUpdaterReport: true,
    updaterReportTitle: "What we changed",
  },
  needs_author_fixes: {
    status: "needs_author_fixes",
    tone: "attention",
    badge: "Needs your attention",
    title: "A few things need your attention.",
    body: NEEDS_ATTENTION_BODY,
    primaryAction: "download_report",
    nextSteps: REPORT_INSTRUCTIONS,
    report: "primary",
    showPreview: true,
    showIssues: true,
    showUpdaterReport: true,
    updaterReportTitle: "What we fixed automatically",
  },
  updater_failed: {
    status: "updater_failed",
    tone: "attention",
    badge: "Needs your attention",
    title: "A few things need your attention.",
    body: NEEDS_ATTENTION_BODY,
    note: "Our automatic fix step didn't work this time, so these are still open.",
    primaryAction: "download_report",
    nextSteps: REPORT_INSTRUCTIONS,
    report: "primary",
    showPreview: true,
    showIssues: true,
    showUpdaterReport: true,
    updaterReportTitle: "What we fixed automatically",
  },
  validation_incomplete: {
    status: "validation_incomplete",
    tone: "retry",
    badge: "Couldn't finish",
    title: "We couldn't finish checking.",
    body: "Our checking service was busy. Your topic isn't the problem. Please try again; there's no need to change anything.",
    primaryAction: "try_again",
    report: "none",
    showPreview: false,
    showIssues: false,
    showUpdaterReport: false,
    updaterReportTitle: "What we changed",
  },
  invalid_input: {
    status: "invalid_input",
    tone: "error",
    badge: "Couldn't read the file",
    title: "We couldn't read this file.",
    body: "Please check that you picked your topic's .json file.",
    primaryAction: "upload_new",
    report: "none",
    showPreview: false,
    showIssues: false,
    showUpdaterReport: false,
    updaterReportTitle: "What we changed",
  },
};

const UNKNOWN: StatusCopy = {
  status: "unknown",
  tone: "neutral",
  badge: "Finished",
  title: "We finished checking your topic.",
  body: "The result came back in a form we didn't expect. The details are below; you can also upload the file again.",
  primaryAction: "upload_new",
  report: "none",
  showPreview: true,
  showIssues: true,
  showUpdaterReport: true,
  updaterReportTitle: "What we changed",
};

const FAILED_TO_START_COPY: StatusCopy = {
  status: FAILED_TO_START,
  tone: "retry",
  badge: "Didn't start",
  title: "We couldn't start the ingestion.",
  body: "Our checking service didn't answer. Your topic isn't the problem. Please upload it again in a few minutes.",
  primaryAction: "upload_again",
  report: "none",
  showPreview: false,
  showIssues: false,
  showUpdaterReport: false,
  updaterReportTitle: "What we changed",
};

/** Statuses that end an ingest (the graph's six, plus failed_to_start and run_error from this app). */
export function isFinalStatus(status: unknown): boolean {
  return (
    isImportStatus(status) || status === FAILED_TO_START || status === RUN_ERROR
  );
}

export function statusCopy(status: unknown, message?: string): StatusCopy {
  if (status === FAILED_TO_START) {
    return message
      ? { ...FAILED_TO_START_COPY, body: message }
      : FAILED_TO_START_COPY;
  }
  if (status === RUN_ERROR) {
    return { ...COPY.validation_incomplete, status: RUN_ERROR };
  }
  if (!isImportStatus(status)) return UNKNOWN;
  const copy = COPY[status];
  if (status === "invalid_input" && message) {
    return { ...copy, body: plainInvalidInputMessage(message) };
  }
  return copy;
}

/** The backend says "Could not read the topic: <reason>"; the title already says that. */
export function plainInvalidInputMessage(message: string): string {
  const reason = message
    .replace(/^could not read the topic:\s*/i, "")
    .replace(/<topic_name>\.json/g, "the .json file")
    .trim();
  if (!reason) return COPY.invalid_input.body;
  const sentence = reason[0]!.toUpperCase() + reason.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * The ingest thread is still busy with no progress for 30 minutes (the later of the thread's
 * `updated_at` and its latest checkpoint's time; record-view.ts `lastProgressAt`).
 * Nothing is written; we only say so.
 */
export const STALL_AFTER_MS = 30 * 60 * 1000;
export const STALLED_COPY = {
  tone: "retry" as Tone,
  badge: "Taking longer",
  title: "This is taking longer than expected.",
  body: "We haven't had a result from our checking service yet. Your topic isn't the problem. You can wait a little longer, or upload it again.",
};

export const RUNNING_BADGE = "Ingesting…";

// ---------------------------------------------------------------- warnings

const WARNING_RULES: Array<[RegExp, string]> = [
  [/^preview link unavailable/i, "The preview isn't available right now."],
  [
    /^could not save the topic json/i,
    "We couldn't save a copy of your topic this time, so it can't be downloaded here.",
  ],
  [
    /^could not save the topic markdown/i,
    "We couldn't make the updated .md this time. The report below lists our fixes, so your assistant can copy them across.",
  ],
  [/^topic updater failed/i, "Our automatic fix step didn't work this time."],
  [/saved no changes/i, "Our automatic fix step didn't change anything."],
  [
    /^could not read the updated topic/i,
    "We couldn't load the fixed version of your topic.",
  ],
  [
    /matching pairs? (?:has|have) no explanation/i,
    "Some matching pairs had no explanation, so we added a blank one. Next time, ask your assistant to write a short explanation for every match.",
  ],
];

const GENERIC_WARNING =
  "Something small didn't work as expected. You'll find the details under Technical details.";

export function friendlyWarning(warning: string): string {
  for (const [pattern, text] of WARNING_RULES) {
    if (pattern.test(warning.trim())) return text;
  }
  return GENERIC_WARNING;
}

/**
 * Soft notes to show with a result: the backend's warnings in plain words, without
 * repeats or anything the status copy already says, plus a note when a preview
 * should be there but isn't.
 */
export function friendlyWarnings(input: {
  status: unknown;
  warnings: readonly string[];
  hasPreview: boolean;
}): string[] {
  const copy = statusCopy(input.status);
  const notes = input.warnings.map(friendlyWarning);
  if (
    (input.status === "valid" || input.status === "fixed") &&
    !input.hasPreview
  ) {
    notes.push("The preview isn't available right now.");
  }
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (seen.has(note)) return false;
    seen.add(note);
    if (copy.note && note === "Our automatic fix step didn't work this time.")
      return false;
    return true;
  });
}
