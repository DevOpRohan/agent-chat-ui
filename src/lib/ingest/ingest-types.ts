/**
 * Ingester mode's shared contract.
 *
 * Each ingest is one LangGraph thread on the `topic_ingest` graph. The thread's metadata carries
 * small, flat progress keys (polled with `threads.search({ ids, select })`); its state carries the
 * final `record` (read once with `threads.getState` after the run ends). Backend field names are
 * kept exactly (snake_case); the view types below are what the ingest pane renders.
 */

import type { IssueGroup } from "./plain-issues";

export const INGEST_GRAPH_ID = "topic_ingest";

// ---------------------------------------------------------------- backend contract

/** Stages in `metadata.ingest_stage`: the UI writes "queued"; the graph writes the rest. */
export const INGEST_STAGES = [
  "queued",
  "reading",
  "checking",
  "fixing",
  "rechecking",
  "publishing",
  "done",
] as const;
export type IngestStage = (typeof INGEST_STAGES)[number];

/** The six final statuses the graph returns (same as topic_import). */
export const INGEST_FINAL_STATUSES = [
  "valid",
  "fixed",
  "needs_author_fixes",
  "validation_incomplete",
  "updater_failed",
  "invalid_input",
] as const;
export type IngestFinalStatus = (typeof INGEST_FINAL_STATUSES)[number];

/** `metadata.ingest_status`: "queued" (UI), "processing" (graph), then a final status. */
export type IngestRunStatus = "queued" | "processing" | IngestFinalStatus;

/** LangGraph thread status. */
export type IngestThreadStatus = "idle" | "busy" | "interrupted" | "error";

/**
 * Thread metadata of an ingest. At `threads.create` the UI writes `graph_id`, `thread_title`,
 * `ingest_file_name`, `ingest_source_url`, and `ingest_stage`/`ingest_status` = "queued".
 * The graph writes `ingest_stage`, `ingest_status`, `topic_name`, `question_sets`, `questions`.
 * The server and auth.py write `graph_id`, `assistant_id`, `owner_id`.
 * "Run again" first sets `ingest_stage`/`ingest_status` back to "queued" (`threads.update`), then
 * starts the run: a final status left by the last run would otherwise read as "already finished".
 */
export interface IngestThreadMetadata {
  graph_id?: string;
  assistant_id?: string;
  owner_id?: string;
  thread_title?: string;
  ingest_file_name?: string;
  /** The uploaded file's GCS link; "Run again" reuses it. */
  ingest_source_url?: string;
  ingest_stage?: IngestStage | string;
  ingest_status?: IngestRunStatus | string;
  topic_name?: string;
  question_sets?: number;
  questions?: number;
}

/** What one poll returns: `threads.search({ ids: [id], select: INGEST_POLL_SELECT })`. */
export const INGEST_POLL_SELECT = [
  "thread_id",
  "status",
  "metadata",
  "updated_at",
] as const;

export interface IngestThreadSnapshot {
  thread_id: string;
  status: IngestThreadStatus | string;
  metadata?: IngestThreadMetadata | Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

/** The graph's input (`runs.create(threadId, INGEST_GRAPH_ID, { input })`). */
export interface IngestRunInput {
  source_url: string;
  file_name: string;
  title?: string;
}

/** One finding as the record stores it (topic_import/records.py `compact_findings`). */
export interface IngestRecordFinding {
  severity?: string;
  code?: string;
  ct_key?: string;
  question_no?: number;
  field?: string;
  message?: string;
  infrastructure?: boolean;
}

/**
 * `values.record` in the thread state: the same object topic_import writes to Firestore at the end
 * of a run (topic_import/graph.py `_finish`). Report capped at 600,000 characters, up to 300
 * findings. The topic summary keys are absent when the file could not be read.
 */
export interface IngestRecord {
  status?: string;
  stage?: string;
  message?: string;
  result?: {
    preview_link?: string | null;
    topic_json_url?: string | null;
    source_topic_json_url?: string | null;
    topic_md_url?: string | null;
    issue_report_md?: string;
    updater_report?: string;
    warnings?: string[];
    validation?: {
      questions?: number | null;
      error_count?: number | null;
      warning_count?: number | null;
      infrastructure_failures?: number | null;
    };
    findings?: IngestRecordFinding[];
  };
  cost?: { updater_ran?: boolean; updater_cost_usd?: number | null };
  topic_id?: string | null;
  topic_name?: string | null;
  cts?: number;
  questions?: number;
  ct_keys?: string[];
}

/** What `threads.getState(id)` returns in `values` (only the keys the UI reads). */
export interface IngestStateValues {
  record?: IngestRecord | null;
  source_url?: string;
  file_name?: string;
}

// ---------------------------------------------------------------- app routes

/** POST /api/ingest/upload (multipart, field "file"): .json only, up to 10 MB, no OpenAI path. */
export interface IngestUploadResponse {
  /** https://storage.googleapis.com/<bucket>/topic-ingest/<uuid>.json */
  url: string;
  fileName: string;
  size: number;
}

/** Error body of the app's own routes. */
export interface ApiError {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------- view (what the pane renders)

export interface IngestTopicInfo {
  name: string;
  fileName?: string;
  questionSets?: number;
  questions?: number;
  /** Base name for downloads: `<slug>.json`, `<slug>_report.md`. */
  downloadName: string;
}

export interface ValidationSummary {
  questions?: number;
  errorCount?: number;
  warningCount?: number;
  infrastructureFailures?: number;
}

export interface Finding {
  severity: string;
  code?: string;
  ctKey?: string;
  questionNo?: number;
  field?: string;
  message: string;
  /** A check that couldn't run (service outage), not a problem in the topic. */
  infrastructure?: boolean;
}

export interface IngestCost {
  /** Whether the automatic fixer (topic updater) ran. */
  updaterRan: boolean;
  /** Its own cost total in US dollars, when it reported one. */
  updaterCostUsd?: number;
}

export interface IngestResult {
  /** A final status, or the UI-only "failed_to_start" | "run_error" | "unknown". */
  status: string;
  message: string;
  /** The report for the creator's assistant (open issues + the platform's fixes), as Markdown. */
  issueReportMd?: string;
  /** The fixer's report, with CT keys replaced by "Set N, variant M" labels. */
  updaterReport?: string;
  previewLink?: string;
  /** Allow-listed https link of the checked/updated topic .json (downloaded via /api/topic-file). */
  topicJsonUrl?: string;
  /** Allow-listed https link of the matching .md; only when the fixer changed the topic. */
  topicMdUrl?: string;
  /** Open issues in plain words, grouped by set and variant. */
  issues: IssueGroup[];
  warnings: string[];
  technical: {
    validation?: ValidationSummary;
    findings: Finding[];
    cost?: IngestCost;
    threadId?: string;
  };
}

/**
 * running: queued or the thread is busy; done: the run ended (with a record, or with a UI-only
 * status when it ended without one); stalled: still running with no progress for 30 minutes.
 */
export type IngestPhase = "running" | "done" | "stalled";

export interface IngestView {
  threadId: string;
  createdAt?: string;
  updatedAt?: string;
  phase: IngestPhase;
  topic: IngestTopicInfo;
  /** The uploaded file's link; "Run again" starts a new run with it. */
  sourceUrl?: string;
  /** While running: the current stage, and whether the fix stage was seen in this run. */
  progress?: { stage: string; queued: boolean; fixSeen: boolean };
  /** When done. */
  result?: IngestResult;
  /** The thread is busy: Ingest topic and Run again stay disabled. */
  busy: boolean;
}
