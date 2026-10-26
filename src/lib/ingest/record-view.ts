/**
 * Ingest thread -> what the ingest pane shows.
 *
 * Each ingest is one LangGraph thread on the topic_ingest graph. While the run goes, the pane
 * polls `threads.search({ ids: [id], select: INGEST_POLL_SELECT })` (status, metadata and
 * updated_at, never the state values). Once the run has ended (`isRunEnded`) it reads
 * `values.record` once with `threads.getState`, and `threadToView` turns both into an IngestView.
 *
 * The record -> result mapping is ported from topic-ingester's src/server/imports.ts (topicInfo,
 * buildResult, toFindings, summarizeValidation, costOf, ctIndexFromRecord, safeHttpUrl and the
 * stall rule), adapted to threads: the record comes from the thread state instead of Firestore,
 * progress and the topic summary from the thread metadata, and the topic files are offered as
 * allow-listed links (downloaded through /api/topic-file) instead of server-side flags.
 */
import { isTopicFileUrl } from "./file-links";
import type {
  Finding,
  IngestCost,
  IngestRecord,
  IngestResult,
  IngestStateValues,
  IngestThreadMetadata,
  IngestThreadSnapshot,
  IngestTopicInfo,
  IngestView,
  ValidationSummary,
} from "./ingest-types";
import {
  groupIssues,
  labelSetsInMarkdown,
  type RawFinding,
} from "./plain-issues";
import { isFixStage } from "./progress";
import {
  FAILED_TO_START,
  isFinalStatus,
  RUN_ERROR,
  STALL_AFTER_MS,
} from "./status-copy";
import { downloadBaseName, isRecord } from "./topic-file";

/**
 * A run created this recently may not show as busy yet: while the thread is idle without a final
 * status, it still counts as running for this long after the UI started it.
 */
export const START_GRACE_MS = 15_000;
const MAX_FINDINGS = 300;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** The value itself when it is an `https` link (the uploaded file's link), else undefined. */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- metadata

const STRING_KEYS = [
  "graph_id",
  "assistant_id",
  "owner_id",
  "thread_title",
  "ingest_file_name",
  "ingest_source_url",
  "ingest_stage",
  "ingest_status",
  "topic_name",
] as const;
const NUMBER_KEYS = ["question_sets", "questions"] as const;

/**
 * The thread's flat ingest keys, type-checked: non-empty strings and finite numbers only, so the
 * rest of the UI never has to second-guess what the server or another client wrote.
 */
export function metadataOf(
  thread: Pick<IngestThreadSnapshot, "metadata"> | null | undefined,
): IngestThreadMetadata {
  const raw: Record<string, unknown> =
    thread && isRecord(thread.metadata) ? thread.metadata : {};
  const metadata: IngestThreadMetadata = {};
  for (const key of STRING_KEYS) {
    const value = str(raw[key]);
    if (value !== undefined) metadata[key] = value;
  }
  for (const key of NUMBER_KEYS) {
    const value = num(raw[key]);
    if (value !== undefined) metadata[key] = value;
  }
  return metadata;
}

/** `values.record` when it is an object, else undefined. */
export function recordOf(
  values: IngestStateValues | null | undefined,
): IngestRecord | undefined {
  return values && isRecord(values.record)
    ? (values.record as IngestRecord)
    : undefined;
}

/**
 * The topic line: name, file, counts and the base name for downloads. The graph writes the topic's
 * name and counts into the metadata once it has read the file; before that (or when it couldn't
 * read it) the file name stands in.
 */
export function topicInfoOf(
  metadata: IngestThreadSnapshot["metadata"],
  record?: IngestRecord | null,
): IngestTopicInfo {
  const meta = metadataOf({ metadata });
  const fileName = meta.ingest_file_name;
  const name =
    meta.topic_name ??
    str(record?.topic_name) ??
    fileName ??
    meta.thread_title ??
    "Untitled topic";
  return {
    name,
    fileName,
    questionSets: meta.question_sets ?? num(record?.cts),
    questions: meta.questions ?? num(record?.questions),
    downloadName: downloadBaseName({ fileName, topicName: name }),
  };
}

// ---------------------------------------------------------------- record -> result

function summarizeValidation(value: unknown): ValidationSummary | undefined {
  if (!isRecord(value)) return undefined;
  return {
    questions: num(value.questions),
    errorCount: num(value.error_count),
    warningCount: num(value.warning_count),
    infrastructureFailures: num(value.infrastructure_failures),
  };
}

function toFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, MAX_FINDINGS)
    .map((f) => ({
      severity: str(f.severity) ?? "error",
      code: str(f.code),
      ctKey: str(f.ct_key),
      questionNo: num(f.question_no),
      field: str(f.field),
      message: (str(f.message) ?? "").slice(0, 1000),
      ...(f.infrastructure === true ? { infrastructure: true } : {}),
    }));
}

/** ct_key -> "Set N" position, from the CT keys in the record (the fixer never reorders sets). */
export function ctIndexFromRecord(
  record: Pick<IngestRecord, "ct_keys">,
): Record<string, number> {
  const index: Record<string, number> = {};
  const keys: unknown[] = Array.isArray(record.ct_keys) ? record.ct_keys : [];
  keys.forEach((key, i) => {
    if (typeof key === "string" && key && !(key in index)) index[key] = i + 1;
  });
  return index;
}

function costOf(record: IngestRecord): IngestCost | undefined {
  if (!isRecord(record.cost)) return undefined;
  const cost = num(record.cost.updater_cost_usd);
  return {
    updaterRan: record.cost.updater_ran === true,
    ...(cost !== undefined ? { updaterCostUsd: cost } : {}),
  };
}

/** The final record (`values.record`) as the result panel shows it. */
export function buildResult(
  record: IngestRecord,
  ctx: { threadId: string },
): IngestResult {
  const result: NonNullable<IngestRecord["result"]> = isRecord(record.result)
    ? record.result
    : {};
  const findings = toFindings(result.findings);
  const ctIndex = ctIndexFromRecord(record);
  const updaterReport = str(result.updater_report);
  const open: RawFinding[] = findings.filter((f) => !f.infrastructure);
  return {
    status: str(record.status) ?? "unknown",
    message: str(record.message) ?? "",
    issueReportMd: str(result.issue_report_md),
    updaterReport: updaterReport
      ? labelSetsInMarkdown(updaterReport, ctIndex)
      : undefined,
    previewLink: safeHttpUrl(result.preview_link),
    topicJsonUrl: isTopicFileUrl(result.topic_json_url)
      ? result.topic_json_url
      : undefined,
    topicMdUrl: isTopicFileUrl(result.topic_md_url)
      ? result.topic_md_url
      : undefined,
    issues: groupIssues(open, ctIndex),
    warnings: Array.isArray(result.warnings)
      ? result.warnings.filter((w): w is string => typeof w === "string")
      : [],
    technical: {
      validation: summarizeValidation(result.validation),
      findings,
      cost: costOf(record),
      threadId: ctx.threadId,
    },
  };
}

/** A result with only a status: the run ended, but there is no record to show. */
function bareResult(status: string, threadId: string): IngestResult {
  return {
    status,
    message: "",
    issues: [],
    warnings: [],
    technical: { findings: [], threadId },
  };
}

// ---------------------------------------------------------------- thread -> view

/** Still busy with no progress (no `updated_at` change) for 30 minutes. */
export function isThreadStalled(
  thread: Pick<IngestThreadSnapshot, "status" | "updated_at">,
  now = Date.now(),
): boolean {
  if (thread.status !== "busy") return false;
  const updated = Date.parse(thread.updated_at ?? "");
  return Number.isFinite(updated) && now - updated > STALL_AFTER_MS;
}

/**
 * Whether the thread's run has ended, so its state can be read once.
 *
 * error: ended; busy: not ended. Otherwise (idle or interrupted) it has ended when the metadata
 * holds a final status. Without one, a run the UI started less than START_GRACE_MS ago
 * (`startedAt`) may simply not be busy yet, so it hasn't ended; any other idle thread has (the run
 * ended without a final status, or never started).
 *
 * "Run again" must reset `ingest_status` and `ingest_stage` to "queued" in the metadata before it
 * creates the new run, or the last run's final status still reads as ended here.
 */
export function isRunEnded(
  thread: IngestThreadSnapshot,
  opts: { startedAt?: number; now?: number } = {},
): boolean {
  if (thread.status === "error") return true;
  if (thread.status === "busy") return false;
  if (isFinalStatus(metadataOf(thread).ingest_status)) return true;
  const { startedAt } = opts;
  if (startedAt !== undefined && Number.isFinite(startedAt)) {
    const now = opts.now ?? Date.now();
    if (now - startedAt < START_GRACE_MS) return false;
  }
  return true;
}

/**
 * What the ingest pane shows for one thread.
 *
 * @param thread one poll (`threads.search` with INGEST_POLL_SELECT)
 * @param values `threads.getState(id).values`, read once after the run ended (`isRunEnded`)
 * @param fixSeen the fix stage was seen earlier in this run (keeps the fix steps at "publishing")
 * @param startedAt when this UI started the run (Date.now()), for START_GRACE_MS
 */
export function threadToView(input: {
  thread: IngestThreadSnapshot;
  values?: IngestStateValues | null;
  fixSeen?: boolean;
  startedAt?: number;
  now?: number;
}): IngestView {
  const { thread, values } = input;
  const now = input.now ?? Date.now();
  const metadata = metadataOf(thread);
  const record = recordOf(values);
  const busy = thread.status === "busy";
  const base = {
    threadId: thread.thread_id,
    createdAt: str(thread.created_at),
    updatedAt: str(thread.updated_at),
    topic: topicInfoOf(metadata, record),
    sourceUrl:
      httpsUrl(metadata.ingest_source_url) ?? httpsUrl(values?.source_url),
    busy,
  };

  if (busy || !isRunEnded(thread, { startedAt: input.startedAt, now })) {
    const stage = metadata.ingest_stage ?? "queued";
    return {
      ...base,
      phase: busy && isThreadStalled(thread, now) ? "stalled" : "running",
      progress: {
        stage,
        queued: metadata.ingest_status === "queued" || stage === "queued",
        fixSeen: input.fixSeen === true || isFixStage(stage),
      },
    };
  }

  const threadId = thread.thread_id;
  if (record && isFinalStatus(record.status)) {
    return {
      ...base,
      phase: "done",
      result: buildResult(record, { threadId }),
    };
  }
  if (thread.status === "error") {
    return { ...base, phase: "done", result: bareResult(RUN_ERROR, threadId) };
  }
  if (isFinalStatus(metadata.ingest_status)) {
    return {
      ...base,
      phase: "done",
      result: bareResult(metadata.ingest_status!, threadId),
    };
  }
  if (record) {
    // A record with a status this UI doesn't know: show it (statusCopy says "unknown").
    return {
      ...base,
      phase: "done",
      result: buildResult(record, { threadId }),
    };
  }
  return {
    ...base,
    phase: "done",
    result: bareResult(FAILED_TO_START, threadId),
  };
}
