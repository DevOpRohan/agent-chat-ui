/**
 * Ingest thread -> what the ingest pane shows.
 *
 * Each ingest is one LangGraph thread on the topic_ingest graph. While the run goes, the pane
 * polls `threads.search({ ids: [id], select: INGEST_POLL_SELECT })` (status, metadata and times,
 * never the state values). Progress comes from the metadata's `ingest_stage` when the graph's
 * writes reached it, else from the checkpoint's `next` (`checkpointProgress`: one `getState` at
 * most every 3 s while busy, the design doc's fallback). The run has ended (`isRunEnded`) when the
 * thread is no longer busy and either the metadata holds a final status or the latest run
 * (`runs.list`) is no longer pending or running. Then the pane reads `values.record` once with
 * `threads.getState`, and `threadToView` turns all of it into an IngestView.
 *
 * The record -> result mapping is ported from topic-ingester's src/server/imports.ts (topicInfo,
 * buildResult, toFindings, summarizeValidation, costOf, ctIndexFromRecord, safeHttpUrl and the
 * stall rule), adapted to threads: the record comes from the thread state instead of Firestore,
 * progress and the topic summary from the thread metadata or the checkpoint, and the topic files
 * are offered as allow-listed links (downloaded through /api/topic-file) instead of server-side
 * flags.
 */
import { isTopicFileUrl } from "./file-links";
import type {
  FixSkipReason,
  Finding,
  IngestCheckpointProgress,
  IngestCost,
  IngestRecord,
  IngestResult,
  IngestStage,
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
import { downloadBaseName, isRecord, summarizeTopic } from "./topic-file";

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
 * The topic line: name, file, counts and the base name for downloads. Once the graph has read the
 * file, the name and counts come from the metadata (when its writes reached it), else from the
 * final record, else from the topic in the checkpoint (`checkpointProgress`); before that (or when
 * the file couldn't be read) the file name stands in.
 */
export function topicInfoOf(
  metadata: IngestThreadSnapshot["metadata"],
  record?: IngestRecord | null,
  checkpointTopic?: IngestCheckpointProgress["topic"],
): IngestTopicInfo {
  const meta = metadataOf({ metadata });
  const fileName = meta.ingest_file_name;
  const name =
    meta.topic_name ??
    str(record?.topic_name) ??
    str(checkpointTopic?.name) ??
    fileName ??
    meta.thread_title ??
    "Untitled topic";
  return {
    name,
    fileName,
    questionSets:
      meta.question_sets ??
      num(record?.cts) ??
      num(checkpointTopic?.questionSets),
    questions:
      meta.questions ??
      num(record?.questions) ??
      num(checkpointTopic?.questions),
    downloadName: downloadBaseName({ fileName, topicName: name }),
  };
}

// ---------------------------------------------------------------- progress (fallback)

/**
 * The topic_ingest graph's steps (topic_import/graph.py `build_graph`) -> progress stage. A node in
 * the checkpoint's `next` is the step running now: reset -> load -> validate -> (fix ->
 * revalidate)? -> publish | report.
 */
const NODE_STAGE: Readonly<Record<string, IngestStage>> = {
  reset: "reading",
  load: "reading",
  validate: "checking",
  // Over the daily credit limit: straight from the checks to the report, without fixing.
  skip_fix: "checking",
  fix: "fixing",
  revalidate: "rechecking",
  publish: "publishing",
  report: "publishing",
};

/**
 * The stage a checkpoint's `next` points at: an empty list means the graph has finished ("done");
 * a list that names no known step (or isn't a list) says nothing (undefined).
 */
export function stageFromNext(next: unknown): IngestStage | undefined {
  if (!Array.isArray(next)) return undefined;
  if (next.length === 0) return "done";
  for (const node of next) {
    const stage = typeof node === "string" ? NODE_STAGE[node] : undefined;
    if (stage) return stage;
  }
  return undefined;
}

/** True when the metadata carries a stage the graph wrote (anything other than "queued"). */
export function hasGraphStage(
  thread: Pick<IngestThreadSnapshot, "metadata"> | null | undefined,
): boolean {
  const stage = metadataOf(thread).ingest_stage;
  return stage !== undefined && stage !== "queued";
}

/**
 * The stage to show: the metadata's when the graph's write reached it (anything other than
 * "queued"), else the checkpoint's (`stageFromNext`), else "queued".
 */
export function progressStage(
  metadataStage: unknown,
  checkpointStage?: string,
): string {
  const meta = str(metadataStage);
  if (meta && meta !== "queued") return meta;
  return str(checkpointStage) ?? "queued";
}

/**
 * Reads one `threads.getState` taken while the thread is busy: the stage from `next`, the
 * checkpoint's time, and the topic line from `values.topic`. `values.record` is never read: the
 * graph's first step clears it, so while busy it can only be the last run's.
 *
 * Returns null when the checkpoint says nothing about this run: there is no checkpoint yet (no
 * `created_at`), or it is older than the run (`runCreatedAt`, the server's `created_at` of the run,
 * when known): the run is still waiting to start, and the state is the last run's.
 */
export function checkpointProgress(
  state:
    | { next?: unknown; created_at?: unknown; values?: unknown }
    | null
    | undefined,
  opts: { runCreatedAt?: string | null } = {},
): IngestCheckpointProgress | null {
  if (!state) return null;
  const at = str(state.created_at);
  const time = Date.parse(at ?? "");
  if (!at || !Number.isFinite(time)) return null;
  const runCreated = Date.parse(opts.runCreatedAt ?? "");
  if (Number.isFinite(runCreated) && time < runCreated) return null;
  const progress: IngestCheckpointProgress = { at };
  const stage = stageFromNext(state.next);
  if (stage) progress.stage = stage;
  const values = isRecord(state.values) ? state.values : {};
  const topic = isRecord(values.topic) ? values.topic : undefined;
  if (topic) {
    const summary = summarizeTopic(topic);
    const name = str(topic.topic_name);
    progress.topic = {
      ...(name ? { name: summary.topicName } : {}),
      ...(Array.isArray(topic.cts)
        ? { questionSets: summary.questionSets, questions: summary.questions }
        : {}),
    };
  }
  return progress;
}

/**
 * The next checkpoint reading on top of the last one: a step it can't name keeps the last stage,
 * and a missing topic keeps the last topic line.
 */
export function mergeCheckpointProgress(
  previous: IngestCheckpointProgress | null | undefined,
  next: IngestCheckpointProgress | null | undefined,
): IngestCheckpointProgress | null {
  if (!next) return previous ?? null;
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    ...(next.stage ? {} : previous.stage ? { stage: previous.stage } : {}),
    ...(next.topic ? {} : previous.topic ? { topic: previous.topic } : {}),
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

const FIX_SKIP_REASONS: readonly FixSkipReason[] = [
  "daily_limit",
  "credits_unavailable",
];

function fixSkipReason(value: unknown): FixSkipReason | undefined {
  return FIX_SKIP_REASONS.find((reason) => reason === value);
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
  const fixSkipped = fixSkipReason(result.fix_skipped);
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
    ...(fixSkipped ? { fixSkipped } : {}),
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

/**
 * When the run last showed progress (ms): the later of the thread's `updated_at` and the last
 * checkpoint's time (`checkpointAt`, from `checkpointProgress`). Undefined when neither is known.
 */
export function lastProgressAt(
  thread: Pick<IngestThreadSnapshot, "updated_at">,
  checkpointAt?: string | null,
): number | undefined {
  const times = [thread.updated_at, checkpointAt]
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : undefined;
}

/** Still busy with no progress (`lastProgressAt`) for 30 minutes. */
export function isThreadStalled(
  thread: Pick<IngestThreadSnapshot, "status" | "updated_at">,
  now = Date.now(),
  checkpointAt?: string | null,
): boolean {
  if (thread.status !== "busy") return false;
  const at = lastProgressAt(thread, checkpointAt);
  return at !== undefined && now - at > STALL_AFTER_MS;
}

/** A LangGraph run status that means the run hasn't finished ("pending" or "running"). */
export function isActiveRunStatus(status: unknown): boolean {
  return status === "pending" || status === "running";
}

/**
 * Whether `isRunEnded` needs the thread's latest run to decide: the thread isn't busy or in error,
 * and the metadata holds no final status. The pane then asks `runs.list(id, { limit: 1 })`.
 */
export function needsLatestRun(thread: IngestThreadSnapshot): boolean {
  return (
    thread.status !== "busy" &&
    thread.status !== "error" &&
    !isFinalStatus(metadataOf(thread).ingest_status)
  );
}

/**
 * Whether the thread's run has ended, so its state can be read once.
 *
 * error: ended; busy: not ended. Otherwise (idle or interrupted) it has ended when the metadata
 * holds a final status (the graph's write reached it). Without one, the latest run decides
 * (`latestRunStatus`, from `runs.list(id, { limit: 1 })`): ended unless it is still pending or
 * running; `null` (the thread has no run: it never started) is ended. Not asked yet (undefined):
 * not ended, so the pane asks before it reads the state.
 *
 * "Run again" must reset `ingest_status` and `ingest_stage` to "queued" in the metadata before it
 * creates the new run, or a final status the graph wrote for the last run still reads as ended.
 */
export function isRunEnded(
  thread: IngestThreadSnapshot,
  opts: { latestRunStatus?: string | null } = {},
): boolean {
  if (thread.status === "error") return true;
  if (thread.status === "busy") return false;
  if (isFinalStatus(metadataOf(thread).ingest_status)) return true;
  if (opts.latestRunStatus === undefined) return false;
  return !isActiveRunStatus(opts.latestRunStatus);
}

/**
 * What the ingest pane shows for one thread.
 *
 * @param thread one poll (`threads.search` with INGEST_POLL_SELECT)
 * @param values `threads.getState(id).values`, read once after the run ended (`isRunEnded`);
 *   ignored while the run goes (a record seen then is the last run's)
 * @param fixSeen the fix stage was seen earlier in this run (keeps the fix steps at "publishing")
 * @param latestRunStatus the latest run's status (`runs.list`), null when the thread has none;
 *   undefined when not asked
 * @param checkpoint what the last `getState` taken while busy said (`checkpointProgress`)
 */
export function threadToView(input: {
  thread: IngestThreadSnapshot;
  values?: IngestStateValues | null;
  fixSeen?: boolean;
  latestRunStatus?: string | null;
  checkpoint?: IngestCheckpointProgress | null;
  now?: number;
}): IngestView {
  const { thread, checkpoint } = input;
  const now = input.now ?? Date.now();
  const metadata = metadataOf(thread);
  const busy = thread.status === "busy";
  const running =
    busy || !isRunEnded(thread, { latestRunStatus: input.latestRunStatus });
  // While the run goes, the state's record (if any) is the last run's: never shown.
  const values = running ? undefined : input.values;
  const record = recordOf(values);
  const base = {
    threadId: thread.thread_id,
    createdAt: str(thread.created_at),
    updatedAt: str(thread.updated_at),
    topic: topicInfoOf(metadata, record, checkpoint?.topic),
    sourceUrl:
      httpsUrl(metadata.ingest_source_url) ??
      httpsUrl(input.values?.source_url),
    busy,
  };

  if (running) {
    const stage = progressStage(metadata.ingest_stage, checkpoint?.stage);
    return {
      ...base,
      phase:
        busy && isThreadStalled(thread, now, checkpoint?.at)
          ? "stalled"
          : "running",
      progress: {
        stage,
        queued: stage === "queued",
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
  if (typeof input.latestRunStatus === "string") {
    // A run ran and ended (cancelled, timed out, or crashed) without leaving a record.
    return { ...base, phase: "done", result: bareResult(RUN_ERROR, threadId) };
  }
  return {
    ...base,
    phase: "done",
    result: bareResult(FAILED_TO_START, threadId),
  };
}
