/**
 * A stateful fake of the LangGraph API (and of the app's two ingest routes) for the Ingester-mode
 * e2e spec. Nothing here talks to a real backend: every request the page makes is answered by
 * `page.context().route(...)`, and any request to another origin is aborted and recorded.
 *
 * The app under test must be a local dev server whose NEXT_PUBLIC_API_URL is FAKE_API_URL
 * (default http://127.0.0.1:2299, where nothing listens), for example:
 *
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:2299 \
 *   NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
 *   pnpm dev --port 3210
 *
 * What it fakes (paths and bodies as @langchain/langgraph-sdk 1.0 sends them):
 *   GET  /info, /ok, /user/limits
 *   POST /threads/search   ids, metadata (containment), status, limit/offset, sort_by/sort_order, select
 *   POST /threads/count
 *   POST /threads          create (metadata kept; owner_id added like auth.py)
 *   GET|PATCH|DELETE /threads/{id}           PATCH merges metadata, like the server
 *   GET  /threads/{id}/state  (+ /state/{checkpoint}, POST /state/checkpoint): values, next, created_at
 *   POST /threads/{id}/history
 *   GET|POST /threads/{id}/runs, GET|DELETE /threads/{id}/runs/{run}, POST .../cancel, GET .../join
 *   POST /api/ingest/upload   (the app's own route; multipart "file")
 *   GET  /api/topic-file      (the app's own route; returns an attachment)
 *
 * Scripted ingest runs behave like the dev deployment (verified 26 Oct 2026): `runs.create` makes
 * the thread busy at once and the run "pending"; once the worker picks it up (`pendingMs`) the run
 * is "running" and walks the graph's steps (`next`: reset -> load -> validate -> (fix ->
 * revalidate)? -> publish | report), each with a fresh checkpoint `created_at`, on a timer
 * (`stageMs`, evaluated lazily whenever the page calls the API) or one step per `advance()`. The
 * values follow the graph: the last run's `record` until `reset` has run, then `record: null`, and
 * `topic` once `load` is done. At the end the thread goes idle with `values.record`, `next: []` and
 * the run "success", or to status "error" (run "error", no record).
 *
 * By default the graph's metadata writes don't land, as on the deployed Postgres runtime: the
 * thread's metadata keeps the UI's `ingest_stage`/`ingest_status` "queued" before, during and
 * after the run, and seeded threads look the same. With `metadataWrites: true` the graph's writes
 * work (stage, status, topic name and counts), for a runtime where `Threads.patch` persists.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { BrowserContext, Page, Request, Route } from "@playwright/test";

import type {
  IngestFinalStatus,
  IngestRecord,
  IngestRecordFinding,
  IngestUploadResponse,
} from "../../src/lib/ingest/ingest-types";

// ---------------------------------------------------------------- configuration

/** The LangGraph API origin the dev server was started with (NEXT_PUBLIC_API_URL). */
export const FAKE_API_URL = (
  process.env.INGEST_E2E_API_URL ?? "http://127.0.0.1:2299"
).replace(/\/+$/, "");

/** NEXT_PUBLIC_ASSISTANT_ID of the dev server: Crafter's graph. */
export const CRAFTER_GRAPH_ID =
  process.env.INGEST_E2E_CRAFTER_GRAPH_ID ?? "o3_question_crafter_agent";

export const INGEST_GRAPH_ID = "topic_ingest";

/** Topic files live here (the app only offers https://storage.googleapis.com links). */
export const TEST_BUCKET = "https://storage.googleapis.com/test-bucket";

/** What auth.py would stamp on every thread. */
export const OWNER_ID = "e2e-owner";

/** The six final statuses, in the order the spec walks them. */
export const FINAL_STATUSES: readonly IngestFinalStatus[] = [
  "valid",
  "fixed",
  "needs_author_fixes",
  "validation_incomplete",
  "updater_failed",
  "invalid_input",
];

/** True when the base URL is a dev server on this machine (the only place this fake makes sense). */
export function isLocalBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    const { hostname } = new URL(baseURL);
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- fixtures

const FIXTURE_DIR = new URL("../fixtures/ingest-e2e/", import.meta.url);

export function readFixture(name: string): Buffer {
  return readFileSync(fileURLToPath(new URL(name, FIXTURE_DIR)));
}

/** A real TopicCrafter topic (the skill's examples/all_types.json): 18 question sets, 27 questions. */
export const TOPIC_FIXTURE = "mixed_practice.json";

const fixtureTopic = JSON.parse(
  readFixture(TOPIC_FIXTURE).toString("utf8"),
) as {
  topic_id: string;
  topic_name: string;
  cts: Array<{ key: string; variations: unknown[] }>;
};

export const FIXTURE_TOPIC = {
  id: fixtureTopic.topic_id,
  name: fixtureTopic.topic_name,
  ctKeys: fixtureTopic.cts.map((ct) => ct.key),
  questionSets: fixtureTopic.cts.length,
  questions: fixtureTopic.cts.reduce((n, ct) => n + ct.variations.length, 0),
};

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** The fixture topic as a file the creator picks (optionally renamed). */
export function topicUpload(fileName = TOPIC_FIXTURE): UploadFile {
  return {
    name: fileName,
    mimeType: "application/json",
    buffer: readFixture(TOPIC_FIXTURE),
  };
}

/** A TopicCrafter .md (the file creators most often pick by mistake). */
export function markdownUpload(): UploadFile {
  const text = [
    "# Topic: Mixed Maths and Science Practice",
    "",
    "- Topic ID: 0b6c3f7e-1d2a-4c8b-9e5f-3a7d1c2b4e60",
    "- Language: English",
    "- Total CTs: 18",
    "- Format: topic-md 1",
    "",
    "## CT 1: quadratic_x_intercepts_ct_001",
    "",
    "- Type: MCQ",
    "- Difficulty: MEDIUM",
    "",
  ].join("\n");
  return {
    name: "mixed_practice.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  };
}

/** One byte over the 10 MB limit, named .json. */
export function oversizedUpload(): UploadFile {
  const size = 10 * 1024 * 1024 + 1;
  const buffer = Buffer.alloc(size, 0x20);
  buffer.write("{", 0);
  buffer.write("}", size - 1);
  return { name: "huge_topic.json", mimeType: "application/json", buffer };
}

/** Broken JSON (a missing comma at line 3, column 3). */
export function brokenJsonUpload(): UploadFile {
  return {
    name: "broken_topic.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{\n  "topic_id": "x"\n  "topic_name": "Broken Example",\n  "cts": []\n}\n',
    ),
  };
}

/** Valid JSON that is not a topic. */
export function notATopicUpload(): UploadFile {
  return {
    name: "not_a_topic.json",
    mimeType: "application/json",
    buffer: readFixture("not_a_topic.json"),
  };
}

/**
 * The download base name the app uses (topic-file.ts `downloadBaseName`): the file's own stem
 * when it is already a skill-style slug, else a slug of the topic name.
 */
export function downloadBaseName(fileName: string, topicName: string): string {
  const stem = fileName.replace(/\.json$/i, "");
  if (/^[a-z0-9_]{1,50}$/.test(stem)) return stem;
  return (
    topicName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "topic"
  );
}

// ---------------------------------------------------------------- records

export interface RecordOptions {
  fileName?: string;
  topicName?: string;
  /** Used to make the record's links unique. */
  threadId?: string;
  /** `fixed` only: whether the graph could make the matching .md (default true). */
  withMarkdown?: boolean;
  /**
   * `needs_author_fixes` only: the daily credit limit held the fixer back (topic_import/credits.py),
   * so the issues come back unfixed, with no preview.
   */
  fixSkipped?: "daily_limit" | "credits_unavailable";
}

/** topic_import/credits.py REPORT_NOTES. */
const FIX_SKIPPED_REPORT_NOTES = {
  daily_limit:
    "Not sent to the automatic fixer: the daily credit limit was reached. Fix these issues yourself, or get more credits and run the check again.",
  credits_unavailable:
    "Not sent to the automatic fixer: the daily credit limit could not be checked. Fix these issues yourself, or run the check again later.",
} as const;

const STATUS_TEXT: Record<string, string> = {
  validation_incomplete:
    "The LaTeX parser service could not be reached for some checks. These are not problems in your topic; submit it again later.",
  needs_author_fixes: "Some problems need a fix in the topic itself.",
  updater_failed:
    "The automatic fix step failed, so these problems are still open.",
  fixed:
    "Nothing is left to fix. Apply the platform's fixes below to your .md so your copy matches the uploaded topic.",
};

const HOW_TO_FIX =
  "Give this report and your topic's `.md` file to your assistant with the TopicCrafter skill and ask: " +
  "*Fix only the issues in this report, and apply any platform fixes it lists. Keep every CT key, variant " +
  "number and correct answer, then give me the new .md and .json files.* Then upload the new `.json` " +
  "here. Issues are listed by CT key and variant number, the same headings as in your `.md` file.";

const HOW_TO: Record<string, string> = {
  fixed:
    "Give this report and your topic's `.md` file to your assistant with the TopicCrafter skill and ask: " +
    "*Apply the platform's fixes listed in this report to my .md. Keep every CT key, variant number and " +
    "correct answer, then give me the new .md and .json files.* There is no need to upload again: the " +
    "platform already has the fixed topic.",
  validation_incomplete:
    "Nothing needs fixing in your topic. Upload the same `.json` again in a few minutes.",
};

/** The backend's issue report (topic_import/pipeline.py `issue_report_md`), for realistic records. */
export function issueReportMd(
  status: string,
  rows: IngestRecordFinding[],
  options: { title?: string; notes?: string[]; platformFixes?: string } = {},
): string {
  const errors = rows.filter((r) => (r.severity ?? "error") === "error");
  const out = [
    `# Topic import report${options.title ? `: ${options.title}` : ""}`,
    "",
    `**Status:** \`${status}\`. ${STATUS_TEXT[status] ?? ""}`,
    `**Errors:** ${errors.length} · **Warnings:** ${rows.length - errors.length}`,
    "",
  ];
  for (const note of options.notes ?? []) out.push(`> ${note}`);
  if (options.notes?.length) out.push("");
  out.push("## How to fix", "", HOW_TO[status] ?? HOW_TO_FIX, "");
  const bullet = (r: IngestRecordFinding) => {
    const tag = (r.severity ?? "error") === "error" ? "ERROR" : "warning";
    const code = r.code ? ` [${r.code}]` : "";
    const where = r.field ? ` \`${r.field}\`:` : "";
    return `- **${tag}**${code}${where} ${r.message ?? ""}`;
  };
  const topicRows = rows.filter((r) => !r.ct_key);
  if (topicRows.length) out.push("## Topic", "", ...topicRows.map(bullet), "");
  const byCt = new Map<string, Map<number, IngestRecordFinding[]>>();
  for (const r of rows) {
    if (!r.ct_key) continue;
    const variants = byCt.get(r.ct_key) ?? new Map();
    const list = variants.get(r.question_no ?? 0) ?? [];
    list.push(r);
    variants.set(r.question_no ?? 0, list);
    byCt.set(r.ct_key, variants);
  }
  for (const [ctKey, variants] of byCt) {
    out.push(`## CT \`${ctKey}\``, "");
    for (const [qno, items] of [...variants].sort((a, b) => a[0] - b[0])) {
      if (qno) out.push(`### Variant ${qno}`, "");
      out.push(...items.map(bullet), "");
    }
  }
  if (options.platformFixes?.trim()) {
    out.push(
      "## The platform's automatic fixes",
      "",
      "The platform's fixer reported the following. What it fixed is already in the uploaded topic: apply " +
        "the same changes to your `.md` so your copy stays in step. Anything it did not fix is listed in the " +
        "issues above.",
      "",
      options.platformFixes.trim(),
      "",
    );
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const [CT1, CT2, CT3] = FIXTURE_TOPIC.ctKeys as [string, string, string];

/** An open finding the fixer can't fix: Set 1, variant 1, the hint's full stop. */
export const HINT_FINDING: IngestRecordFinding = {
  severity: "error",
  code: "PUNCTUATION",
  ct_key: CT1,
  question_no: 1,
  field: "hint",
  message: "The hint must end with a full stop.",
};

export const LATEX_FINDING: IngestRecordFinding = {
  severity: "error",
  code: "PARSER LATEX",
  ct_key: CT3,
  question_no: 2,
  field: "solution",
  message: "Unbalanced \\( delimiter in the solution.",
};

/** A check that couldn't run (service outage): not a problem in the topic. */
export const INFRASTRUCTURE_FINDING: IngestRecordFinding = {
  severity: "error",
  code: "PARSER LATEX",
  ct_key: CT2,
  question_no: 1,
  field: "question",
  message: "LaTeX parser service unavailable (HTTP 503).",
  infrastructure: true,
};

export const UPDATER_REPORT = [
  `- \`${CT1}\` variant 2: added the missing full stop at the end of the hint.`,
  `- \`${CT2}\` variant 1: closed an unbalanced \`\\(\` in the solution.`,
].join("\n");

export const INVALID_INPUT_MESSAGE =
  "Could not read the topic: the file is not valid JSON (line 3, column 3: Expecting ',' delimiter)";

/** A realistic `values.record` for each final status (the shape topic_import's `_finish` writes). */
export function buildRecord(
  status: IngestFinalStatus,
  options: RecordOptions = {},
): IngestRecord {
  const name = options.topicName ?? FIXTURE_TOPIC.name;
  const key = options.threadId ?? randomUUID();
  const saved = `${TEST_BUCKET}/topic-import/${key}/topic.json`;
  const updatedJson = `${TEST_BUCKET}/topic-import/${key}/topic_updated.json`;
  const updatedMd = `${TEST_BUCKET}/topic-import/${key}/topic_updated.md`;
  const preview = `https://preview.cerebry.test/topics/${key}`;
  const summary = {
    topic_id: FIXTURE_TOPIC.id,
    topic_name: name,
    cts: FIXTURE_TOPIC.questionSets,
    questions: FIXTURE_TOPIC.questions,
    ct_keys: FIXTURE_TOPIC.ctKeys,
  };
  const validation = (errors: number, infrastructure = 0) => ({
    questions: FIXTURE_TOPIC.questions,
    error_count: errors,
    warning_count: 0,
    infrastructure_failures: infrastructure,
  });
  const empty = {
    preview_link: null,
    topic_json_url: null,
    source_topic_json_url: null,
    topic_md_url: null,
    issue_report_md: "",
    updater_report: "",
    warnings: [] as string[],
    findings: [] as IngestRecordFinding[],
  };

  if (status === "needs_author_fixes" && options.fixSkipped) {
    return {
      status,
      stage: "done",
      message:
        "The topic has issues to fix; the automatic fixer was skipped because of the daily credit limit.",
      result: {
        ...empty,
        topic_json_url: saved,
        source_topic_json_url: saved,
        issue_report_md: issueReportMd(status, [HINT_FINDING], {
          title: name,
          notes: [FIX_SKIPPED_REPORT_NOTES[options.fixSkipped]],
        }),
        validation: validation(1),
        findings: [HINT_FINDING],
        fix_skipped: options.fixSkipped,
      },
      cost: { updater_ran: false, updater_cost_usd: null },
      ...summary,
    };
  }

  switch (status) {
    case "valid":
      return {
        status,
        stage: "done",
        message: "The topic is valid.",
        result: {
          ...empty,
          preview_link: preview,
          topic_json_url: saved,
          validation: validation(0),
        },
        cost: { updater_ran: false, updater_cost_usd: null },
        ...summary,
      };
    case "fixed": {
      const withMarkdown = options.withMarkdown !== false;
      return {
        status,
        stage: "done",
        message: "The topic updater fixed every issue; the topic is now valid.",
        result: {
          ...empty,
          preview_link: preview,
          topic_json_url: updatedJson,
          source_topic_json_url: saved,
          topic_md_url: withMarkdown ? updatedMd : null,
          issue_report_md: issueReportMd("fixed", [], {
            title: name,
            platformFixes: UPDATER_REPORT,
          }),
          updater_report: UPDATER_REPORT,
          warnings: withMarkdown
            ? []
            : ["Could not save the topic markdown: parser round-trip failed"],
          validation: validation(0),
        },
        cost: { updater_ran: true, updater_cost_usd: 0.42 },
        ...summary,
      };
    }
    case "needs_author_fixes":
      return {
        status,
        stage: "done",
        message:
          "The topic updater fixed some issues; the rest are in the issue report.",
        result: {
          ...empty,
          preview_link: preview,
          topic_json_url: updatedJson,
          source_topic_json_url: saved,
          issue_report_md: issueReportMd(status, [HINT_FINDING], {
            title: name,
            notes: ["The preview shows the topic after the automatic fixes."],
            platformFixes: UPDATER_REPORT,
          }),
          updater_report: UPDATER_REPORT,
          validation: validation(1),
          findings: [HINT_FINDING],
        },
        cost: { updater_ran: true, updater_cost_usd: 0.37 },
        ...summary,
      };
    case "validation_incomplete":
      return {
        status,
        stage: "done",
        message:
          "Some checks could not run because the LaTeX parser service failed; try again later.",
        result: {
          ...empty,
          topic_json_url: saved,
          source_topic_json_url: saved,
          issue_report_md: issueReportMd(status, [INFRASTRUCTURE_FINDING], {
            title: name,
          }),
          validation: validation(1, 1),
          findings: [INFRASTRUCTURE_FINDING],
        },
        cost: { updater_ran: false, updater_cost_usd: null },
        ...summary,
      };
    case "updater_failed":
      return {
        status,
        stage: "done",
        message: "The automatic fix step failed; download the issue report.",
        result: {
          ...empty,
          topic_json_url: saved,
          source_topic_json_url: saved,
          issue_report_md: issueReportMd(
            status,
            [HINT_FINDING, LATEX_FINDING],
            {
              title: name,
            },
          ),
          warnings: ["Topic updater failed: RuntimeError: updater crashed"],
          validation: validation(2),
          findings: [HINT_FINDING, LATEX_FINDING],
        },
        cost: { updater_ran: true, updater_cost_usd: null },
        ...summary,
      };
    case "invalid_input":
      // The file couldn't be read, so the record has no topic summary.
      return {
        status,
        stage: "done",
        message: INVALID_INPUT_MESSAGE,
        result: {
          ...empty,
          validation: {
            questions: null,
            error_count: null,
            warning_count: null,
            infrastructure_failures: null,
          },
        },
        cost: { updater_ran: false, updater_cost_usd: null },
      };
  }
}

// ---------------------------------------------------------------- fake state

export type ThreadStatus = "idle" | "busy" | "interrupted" | "error";

export interface FakeThread {
  thread_id: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  status: ThreadStatus;
  values: Record<string, unknown> | null;
  interrupts: Record<string, unknown>;
}

export interface FakeRun {
  run_id: string;
  thread_id: string;
  assistant_id: string;
  created_at: string;
  updated_at: string;
  status: "pending" | "running" | "success" | "error" | "interrupted";
  metadata: Record<string, unknown>;
  multitask_strategy: string;
  kwargs: { input?: unknown; config?: unknown };
}

export interface RunInput {
  source_url?: string;
  file_name?: string;
  [key: string]: unknown;
}

export interface RunScript {
  /**
   * The run's steps, in order: stages ("reading", "checking", ...; each runs its graph step) or
   * graph steps ("reset", "load", "validate", "fix", "revalidate", "publish", "report").
   * Default: reading, checking, publishing.
   */
  stages?: readonly string[];
  /** How long each step lasts (ms), or "manual" to wait for `advance()`. Default 300 ms. */
  stageMs?: number | "manual";
  /**
   * How long the run stays "pending" before the worker picks it up (ms), or "manual" to wait for
   * `advance()`. Meanwhile the thread is busy and its state is still the last run's. Default 0.
   */
  pendingMs?: number | "manual";
  /** The record the run ends with (default: a valid record for the run's file). */
  record?:
    | IngestRecord
    | ((ctx: { input: RunInput; threadId: string }) => IngestRecord);
  /** End in a run error instead: thread status "error", no record. */
  error?: string;
  /** Answer runs.create itself with this error (the run never starts). */
  reject?: {
    status: number;
    headers?: Record<string, string>;
    json?: unknown;
  };
}

/** The stages of a run that goes through the fixer. */
export const FIX_STAGES = [
  "reading",
  "checking",
  "fixing",
  "rechecking",
  "publishing",
] as const;
/** The stages of a run that needs no fix. */
export const PLAIN_STAGES = ["reading", "checking", "publishing"] as const;

/** The topic_ingest graph's steps (topic_import/graph.py) -> the progress stage they stand for. */
export const NODE_STAGE: Readonly<Record<string, string>> = {
  reset: "reading",
  load: "reading",
  validate: "checking",
  fix: "fixing",
  revalidate: "rechecking",
  publish: "publishing",
  report: "publishing",
};

/** A progress stage -> the graph step that runs during it. */
const STAGE_NODE: Readonly<Record<string, string>> = {
  reading: "load",
  checking: "validate",
  fixing: "fix",
  rechecking: "revalidate",
  publishing: "publish",
};

/** Steps before the graph has read the file (no `values.topic` yet). */
const BEFORE_READ = new Set(["reset", "load"]);

interface RunStep {
  node: string;
  stage: string;
}

/** A script entry is a graph step ("reset", "validate", ...) or a stage ("reading", ...). */
function toStep(entry: string): RunStep {
  if (entry in NODE_STAGE) return { node: entry, stage: NODE_STAGE[entry]! };
  return { node: STAGE_NODE[entry] ?? entry, stage: entry };
}

interface ActiveRun {
  run: FakeRun;
  steps: RunStep[];
  stageMs: number | "manual";
  pendingMs: number | "manual";
  /** -1 while the run is pending (not picked up yet). */
  index: number;
  enteredAt: number;
  record?: IngestRecord;
  error?: string;
}

/** The thread's latest checkpoint, as `threads.getState` reports it. */
export interface FakeCheckpoint {
  next: string[];
  /** `created_at`; null when the thread has no checkpoint yet. */
  at: string | null;
}

export interface StateRead {
  threadId: string;
  /** The thread was busy when the page read its state. */
  busy: boolean;
  next: string[];
  /** `values.record` held a record (the last run's, while busy). */
  hadRecord: boolean;
}

export interface SearchBody {
  metadata?: Record<string, unknown>;
  ids?: string[];
  limit?: number;
  offset?: number;
  status?: string;
  sort_by?: string;
  sort_order?: string;
  select?: string[];
}

export interface RunCreateCall {
  threadId: string;
  body: {
    assistant_id?: string;
    input?: RunInput;
    metadata?: Record<string, unknown>;
    multitask_strategy?: string;
    [key: string]: unknown;
  };
  /** HTTP status the fake answered with. */
  status: number;
}

export interface UploadCall {
  fileName?: string;
  contentType?: string;
  size: number;
  /** The link the fake returned (absent when the upload was refused). */
  url?: string;
}

export interface SeedCrafterOptions {
  title: string;
  threadId?: string;
  /** Default: one question and one answer. */
  messages?: Array<{ type: "human" | "ai"; content: string }>;
  updatedMinutesAgo?: number;
}

export type SeedIngestState =
  | IngestFinalStatus
  /** Busy, with a run held at `stage` until advance()/finish(). */
  | "running"
  /** Busy, with no progress for `updatedMinutesAgo` (default 31) minutes. */
  | "stalled"
  /** Thread status "error": the run crashed, no record. */
  | "error"
  /** Idle with ingest_status "queued" and no run: the run never started. */
  | "not_started";

export interface SeedIngestOptions {
  state: SeedIngestState;
  fileName?: string;
  /** thread_title (default: the file name). */
  title?: string;
  topicName?: string;
  threadId?: string;
  sourceUrl?: string;
  /** running / stalled / error: the stage in the metadata (default "checking"). */
  stage?: string;
  /** running: the stages after `stage` (default: the rest of FIX_STAGES or PLAIN_STAGES). */
  nextStages?: readonly string[];
  /** Final states: the record (default `buildRecord(state)`); running: the record it ends with. */
  record?: IngestRecord;
  recordOptions?: RecordOptions;
  updatedMinutesAgo?: number;
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function isUuid(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/** A stable fake assistant UUID per graph, like the server's default assistants. */
function assistantUuid(graphId: string): string {
  let hash = 0;
  for (const char of graphId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function defaultBudget() {
  return {
    timezone: "Asia/Kolkata",
    currency: "USD",
    spent_microusd: 1_250_000,
    base_limit_microusd: 5_000_000,
    extra_credit_microusd: 0,
    limit_microusd: 5_000_000,
    remaining_microusd: 3_750_000,
    resets_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
  };
}

function parseMultipartFile(
  body: Buffer,
  contentType: string | undefined,
): { fileName?: string; contentType?: string; body: Buffer } | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) return null;
  const raw = body.toString("latin1");
  for (const part of raw.split(`--${boundary}`)) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const fileName = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (fileName === undefined) continue;
    let content = part.slice(headerEnd + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    return {
      fileName: Buffer.from(fileName, "latin1").toString("utf8"),
      contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim(),
      body: Buffer.from(content, "latin1"),
    };
  }
  return null;
}

// ---------------------------------------------------------------- the fake

export class IngestBackend {
  readonly apiUrl = FAKE_API_URL;
  readonly apiOrigin = new URL(FAKE_API_URL).origin;
  readonly appOrigin: string;

  readonly threads = new Map<string, FakeThread>();
  readonly runs = new Map<string, FakeRun[]>();
  /** Topic files by link (uploads, and the files a record points at). */
  readonly files = new Map<string, Buffer>();

  /** What /user/limits answers (the DailyBudget control). */
  budget = defaultBudget();
  /** When set, /api/ingest/upload answers with this error. */
  uploadFailure: { status: number; json?: unknown } | null = null;
  /** When set, the pane's poll (`threads.search` with `ids`) answers with this error. */
  pollFailure: { status: number; json?: unknown } | null = null;
  /**
   * Whether the graph's own metadata writes land (stage, status, topic name and counts). False by
   * default, like the deployed Postgres runtime; set it before seeding or starting runs.
   */
  metadataWrites: boolean;
  /**
   * Threads created after this is set are left out of list searches (no `ids`), so a history row
   * for them can only come from the page itself.
   */
  hideNewThreadsFromLists = false;

  /** Every call the page made, for assertions. */
  readonly calls = {
    searches: [] as SearchBody[],
    threadCreates: [] as Array<{
      body: { metadata?: Record<string, unknown>; [key: string]: unknown };
      threadId: string;
    }>,
    threadPatches: [] as Array<{
      threadId: string;
      metadata: Record<string, unknown>;
    }>,
    runCreates: [] as RunCreateCall[],
    stateReads: [] as string[],
    /** Every state read, with what the state held at that moment. */
    stateReadLog: [] as StateRead[],
    /** Thread ids of every `runs.list` (GET /threads/{id}/runs). */
    runLists: [] as string[],
    uploads: [] as UploadCall[],
    topicFiles: [] as Array<{ url: string | null; name: string | null }>,
    /** Requests to the chat's upload routes (/api/upload, /api/openai/*): Ingester must not make any. */
    chatUploads: [] as string[],
    /** API requests this fake doesn't know (answered 404). */
    unhandled: [] as string[],
    /** Requests to any other origin (aborted). */
    blocked: [] as string[],
  };
  /** "METHOD url" of every request any page in the context made, in order. */
  readonly requests: string[] = [];

  private readonly active = new Map<string, ActiveRun>();
  private readonly queue: RunScript[] = [];
  private readonly checkpoints = new Map<string, FakeCheckpoint>();
  private readonly hiddenFromLists = new Set<string>();

  constructor(options: { appUrl: string; metadataWrites?: boolean }) {
    this.appOrigin = new URL(options.appUrl).origin;
    this.metadataWrites = options.metadataWrites ?? false;
  }

  // ------------------------------------------------------------ install

  /** Routes every request of the page's context. Call before the first page.goto. */
  async install(page: Page): Promise<void> {
    const context: BrowserContext = page.context();
    context.on("request", (request) => {
      this.requests.push(`${request.method()} ${request.url()}`);
    });
    // Lowest precedence first: any other origin never reaches the network.
    await context.route(
      (url) => url.origin !== this.appOrigin && url.origin !== this.apiOrigin,
      async (route) => {
        this.calls.blocked.push(route.request().url());
        await route.abort("blockedbyclient");
      },
    );
    await context.route(
      (url) => url.origin === this.apiOrigin,
      (route) => this.handleApi(route),
    );
    await context.route(
      (url) =>
        url.origin === this.appOrigin && url.pathname === "/api/ingest/upload",
      (route) => this.handleUpload(route),
    );
    await context.route(
      (url) =>
        url.origin === this.appOrigin && url.pathname === "/api/topic-file",
      (route) => this.handleTopicFile(route),
    );
    await context.route(
      (url) =>
        url.origin === this.appOrigin &&
        (url.pathname === "/api/upload" ||
          url.pathname.startsWith("/api/upload/") ||
          url.pathname.startsWith("/api/openai")),
      async (route) => {
        this.calls.chatUploads.push(
          `${route.request().method()} ${route.request().url()}`,
        );
        await route.fulfill({
          status: 500,
          json: {
            error: {
              code: "E2E_UNEXPECTED",
              message: "The chat upload route is not part of Ingester.",
            },
          },
        });
      },
    );
  }

  /** Requests that went (or tried to go) to OpenAI. Must stay empty. */
  openAiRequests(): string[] {
    return this.requests.filter((line) => {
      try {
        const url = new URL(line.slice(line.indexOf(" ") + 1));
        return (
          url.hostname === "openai.com" || url.hostname.endsWith(".openai.com")
        );
      } catch {
        return false;
      }
    });
  }

  /** A JSON-friendly dump for test attachments. */
  snapshot() {
    return {
      metadataWrites: this.metadataWrites,
      threads: [...this.threads.values()],
      checkpoints: Object.fromEntries(this.checkpoints),
      runs: Object.fromEntries(this.runs),
      active: [...this.active.entries()].map(([threadId, a]) => ({
        threadId,
        steps: a.steps,
        index: a.index,
        stageMs: a.stageMs,
        pendingMs: a.pendingMs,
      })),
      calls: this.calls,
      requests: this.requests.filter(
        (line) =>
          !/\/_next\/|\/__nextjs|\.(js|css|woff2?|svg|png|ico)(\?|$)/.test(
            line,
          ),
      ),
    };
  }

  // ------------------------------------------------------------ scripting

  /** The next runs.create (on any ingest thread) follows this script. */
  queueRun(script: RunScript): void {
    this.queue.push(script);
  }

  /** Thread ids with a run in progress. */
  activeThreadIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Moves the run one step on: a pending run starts its first step; the last step ends the run.
   * Returns the new step's stage, or "done".
   */
  advance(threadId?: string): string {
    const id = this.resolveActive(threadId);
    this.step(id);
    const run = this.active.get(id);
    return run ? run.steps[run.index]!.stage : "done";
  }

  /** The thread's latest checkpoint (what `getState` reports as `next` and `created_at`). */
  checkpoint(threadId: string): FakeCheckpoint {
    return this.checkpoints.get(threadId) ?? { next: [], at: null };
  }

  /** The thread's runs, newest first (what `runs.list` answers). */
  runsOf(threadId: string): FakeRun[] {
    return this.runs.get(threadId) ?? [];
  }

  /**
   * Another tab (or client) starts a run on the thread: it puts the metadata back to "queued" and
   * creates the run, as the UI's Run again does. Not recorded in `calls.runCreates`.
   */
  startRunElsewhere(threadId: string, script: RunScript = {}): FakeRun {
    const thread = this.thread(threadId);
    thread.metadata = {
      ...thread.metadata,
      ingest_stage: "queued",
      ingest_status: "queued",
    };
    const created = this.createRun(
      thread,
      {
        assistant_id: INGEST_GRAPH_ID,
        input: {
          source_url: String(thread.metadata.ingest_source_url ?? ""),
          file_name: String(thread.metadata.ingest_file_name ?? "topic.json"),
        },
      },
      { script },
    );
    if (created.status !== 200)
      throw new Error(
        `fake LangGraph: run elsewhere refused (${created.status})`,
      );
    return created.json as FakeRun;
  }

  /** Ends the run now, with its record (or its error). */
  finish(threadId?: string): void {
    this.complete(this.resolveActive(threadId));
  }

  thread(threadId: string): FakeThread {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`fake LangGraph: no thread ${threadId}`);
    return thread;
  }

  /** The ingest run creations (POST /threads/{id}/runs on topic_ingest). */
  ingestRunCreates(): RunCreateCall[] {
    return this.calls.runCreates.filter(
      (call) => call.body.assistant_id === INGEST_GRAPH_ID,
    );
  }

  // ------------------------------------------------------------ seeds

  seedCrafterThread(options: SeedCrafterOptions): FakeThread {
    const threadId = options.threadId ?? randomUUID();
    const at = isoMinutesAgo(options.updatedMinutesAgo ?? 5);
    const messages = (
      options.messages ?? [
        { type: "human" as const, content: `${options.title}: please help.` },
        {
          type: "ai" as const,
          content: `Here is a plan for ${options.title}.`,
        },
      ]
    ).map((message, index) => ({
      id: `${threadId}-m${index}`,
      type: message.type,
      content: message.content,
    }));
    const thread: FakeThread = {
      thread_id: threadId,
      created_at: at,
      updated_at: at,
      metadata: {
        graph_id: CRAFTER_GRAPH_ID,
        assistant_id: assistantUuid(CRAFTER_GRAPH_ID),
        owner_id: OWNER_ID,
        thread_title: options.title,
      },
      status: "idle",
      values: { messages },
      interrupts: {},
    };
    this.threads.set(threadId, thread);
    this.checkpoints.set(threadId, { next: [], at });
    this.runs.set(threadId, [
      this.newRun(threadId, CRAFTER_GRAPH_ID, "success", at, {}),
    ]);
    return thread;
  }

  /** A thread of another graph (for example a stateless topic_import leftover): in neither list. */
  seedOtherGraphThread(graphId: string, title: string): FakeThread {
    const threadId = randomUUID();
    const at = isoMinutesAgo(1);
    const thread: FakeThread = {
      thread_id: threadId,
      created_at: at,
      updated_at: at,
      metadata: {
        graph_id: graphId,
        assistant_id: assistantUuid(graphId),
        owner_id: OWNER_ID,
        thread_title: title,
      },
      status: "idle",
      values: {},
      interrupts: {},
    };
    this.threads.set(threadId, thread);
    this.checkpoints.set(threadId, { next: [], at });
    return thread;
  }

  /**
   * An ingest thread in a given state. Its metadata is what the UI wrote at create ("queued"),
   * plus, with `metadataWrites`, what the graph would have written for that state.
   */
  seedIngestThread(options: SeedIngestOptions): FakeThread {
    const threadId = options.threadId ?? randomUUID();
    const fileName = options.fileName ?? TOPIC_FIXTURE;
    const sourceUrl =
      options.sourceUrl ?? `${TEST_BUCKET}/topic-ingest/${randomUUID()}.json`;
    if (!this.files.has(sourceUrl))
      this.files.set(sourceUrl, readFixture(TOPIC_FIXTURE));
    const minutesAgo =
      options.updatedMinutesAgo ?? (options.state === "stalled" ? 31 : 2);
    const updatedAt = isoMinutesAgo(minutesAgo);
    const createdAt = isoMinutesAgo(minutesAgo + 1);
    const recordOptions: RecordOptions = {
      fileName,
      topicName: options.topicName,
      threadId,
      ...options.recordOptions,
    };
    const topicName = options.topicName ?? FIXTURE_TOPIC.name;
    const topicMeta = {
      topic_name: topicName,
      question_sets: FIXTURE_TOPIC.questionSets,
      questions: FIXTURE_TOPIC.questions,
    };
    const input = { source_url: sourceUrl, file_name: fileName };
    const thread: FakeThread = {
      thread_id: threadId,
      created_at: createdAt,
      updated_at: updatedAt,
      metadata: {
        graph_id: INGEST_GRAPH_ID,
        assistant_id: assistantUuid(INGEST_GRAPH_ID),
        owner_id: OWNER_ID,
        thread_title: options.title ?? fileName,
        ingest_file_name: fileName,
        ingest_source_url: sourceUrl,
        ingest_stage: "queued",
        ingest_status: "queued",
      },
      status: "idle",
      values: { ...input, record: null, topic: null },
      interrupts: {},
    };
    this.threads.set(threadId, thread);
    const stage = options.stage ?? "checking";
    const node = STAGE_NODE[stage] ?? stage;
    /** What the graph writes into the metadata, when its writes land. */
    const graphWrites = (fields: Record<string, unknown>) => {
      if (this.metadataWrites) Object.assign(thread.metadata, fields);
    };
    const topicValue = (read: boolean) =>
      read ? this.topicValue(sourceUrl, topicName) : null;

    switch (options.state) {
      case "not_started":
        thread.values = null;
        this.checkpoints.set(threadId, { next: [], at: null });
        this.runs.set(threadId, []);
        break;
      case "error":
        graphWrites({
          ingest_stage: stage,
          ingest_status: "processing",
          ...(stage === "reading" ? {} : topicMeta),
        });
        thread.status = "error";
        thread.values = {
          ...input,
          record: null,
          topic: topicValue(stage !== "reading"),
        };
        // The checkpoint stays at the step that failed.
        this.checkpoints.set(threadId, { next: [node], at: updatedAt });
        this.runs.set(threadId, [
          this.newRun(threadId, INGEST_GRAPH_ID, "error", updatedAt, input),
        ]);
        break;
      case "stalled":
        graphWrites({
          ingest_stage: stage,
          ingest_status: "processing",
          ...(stage === "reading" ? {} : topicMeta),
        });
        thread.status = "busy";
        thread.values = {
          ...input,
          record: null,
          topic: topicValue(stage !== "reading"),
        };
        // No active run: nothing moves, so neither updated_at nor the checkpoint changes.
        this.checkpoints.set(threadId, { next: [node], at: updatedAt });
        this.runs.set(threadId, [
          this.newRun(threadId, INGEST_GRAPH_ID, "running", createdAt, input),
        ]);
        break;
      case "running": {
        const order: readonly string[] = (
          FIX_STAGES as readonly string[]
        ).includes(stage)
          ? FIX_STAGES
          : PLAIN_STAGES;
        const rest =
          options.nextStages ??
          (order.includes(stage) ? order.slice(order.indexOf(stage) + 1) : []);
        thread.status = "busy";
        thread.values = {
          ...input,
          record: null,
          topic: topicValue(stage !== "reading"),
        };
        const run = this.newRun(
          threadId,
          INGEST_GRAPH_ID,
          "running",
          createdAt,
          input,
        );
        this.runs.set(threadId, [run]);
        this.active.set(threadId, {
          run,
          steps: [stage, ...rest].map(toStep),
          stageMs: "manual",
          pendingMs: 0,
          index: 0,
          enteredAt: Date.now(),
          record: options.record ?? buildRecord("valid", recordOptions),
        });
        this.checkpoints.set(threadId, { next: [node], at: updatedAt });
        graphWrites({
          ingest_stage: stage,
          ingest_status: "processing",
          ...(stage === "reading" ? {} : topicMeta),
        });
        break;
      }
      default: {
        const record =
          options.record ?? buildRecord(options.state, recordOptions);
        this.registerRecordFiles(record);
        thread.values = {
          ...input,
          record,
          topic: topicValue(Boolean(record.topic_name)),
        };
        this.checkpoints.set(threadId, { next: [], at: updatedAt });
        graphWrites({
          ingest_stage: "done",
          ingest_status: record.status,
          ...this.topicMetaOf(record),
        });
        this.runs.set(threadId, [
          this.newRun(threadId, INGEST_GRAPH_ID, "success", updatedAt, input),
        ]);
      }
    }
    return thread;
  }

  /** The topic in the uploaded file, as the graph keeps it in `values.topic` once read. */
  private topicValue(
    sourceUrl: string | undefined,
    topicName?: string | null,
  ): Record<string, unknown> | null {
    const file = sourceUrl ? this.files.get(sourceUrl) : undefined;
    if (!file) return null;
    try {
      const topic = JSON.parse(file.toString("utf8")) as unknown;
      if (!topic || typeof topic !== "object" || Array.isArray(topic))
        return null;
      return topicName
        ? { ...(topic as Record<string, unknown>), topic_name: topicName }
        : (topic as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ engine

  private resolveActive(threadId?: string): string {
    if (threadId) {
      if (!this.active.has(threadId))
        throw new Error(`fake LangGraph: no run in progress on ${threadId}`);
      return threadId;
    }
    const ids = this.activeThreadIds();
    if (ids.length !== 1)
      throw new Error(
        `fake LangGraph: expected one run in progress, found ${ids.length}`,
      );
    return ids[0]!;
  }

  private tick(): void {
    const now = Date.now();
    for (const [threadId, run] of [...this.active]) {
      for (;;) {
        if (this.active.get(threadId) !== run) break;
        const wait = run.index < 0 ? run.pendingMs : run.stageMs;
        if (wait === "manual" || now - run.enteredAt < wait) break;
        run.enteredAt += wait;
        this.step(threadId);
      }
    }
  }

  private step(threadId: string): void {
    const run = this.active.get(threadId);
    if (!run) return;
    run.index += 1;
    if (run.index >= run.steps.length) {
      this.complete(threadId);
      return;
    }
    // The worker has picked the run up.
    if (run.run.status === "pending") {
      run.run.status = "running";
      run.run.updated_at = new Date().toISOString();
    }
    this.enterStep(threadId, run);
  }

  /** The run's input, as the graph has it in its state. */
  private inputOf(run: ActiveRun): RunInput {
    return ((run.run.kwargs.input ?? {}) as RunInput) || {};
  }

  /** A new checkpoint: `step.node` runs next. Values and (with metadataWrites) metadata follow. */
  private enterStep(threadId: string, run: ActiveRun): void {
    const thread = this.thread(threadId);
    const { node, stage } = run.steps[run.index]!;
    const input = this.inputOf(run);
    const values: Record<string, unknown> = {
      ...(thread.values ?? {}),
      source_url: input.source_url,
      file_name: input.file_name,
    };
    // Until `reset` has run, the state still holds the last run's record and topic.
    if (node !== "reset") {
      values.record = null;
      values.topic = BEFORE_READ.has(node)
        ? null
        : this.topicValue(input.source_url, run.record?.topic_name);
    }
    thread.values = values;
    this.checkpoints.set(threadId, {
      next: [node],
      at: new Date().toISOString(),
    });
    if (this.metadataWrites) {
      thread.metadata = {
        ...thread.metadata,
        ingest_stage: stage,
        ingest_status: "processing",
        // The graph writes the topic summary once it has read the file.
        ...(stage === "reading" ? {} : this.topicMetaOf(run.record)),
      };
      this.touch(thread);
    }
  }

  private complete(threadId: string): void {
    const run = this.active.get(threadId);
    if (!run) return;
    this.active.delete(threadId);
    const thread = this.thread(threadId);
    const now = new Date().toISOString();
    run.run.updated_at = now;
    const input = this.inputOf(run);
    if (run.error !== undefined || !run.record) {
      // The checkpoint stays at the step that failed; the record stays empty.
      thread.status = "error";
      run.run.status = "error";
    } else {
      this.registerRecordFiles(run.record);
      thread.values = {
        ...(thread.values ?? {}),
        source_url: input.source_url,
        file_name: input.file_name,
        record: run.record,
      };
      this.checkpoints.set(threadId, { next: [], at: now });
      if (this.metadataWrites) {
        thread.metadata = {
          ...thread.metadata,
          ingest_stage: "done",
          ingest_status: run.record.status,
          ...this.topicMetaOf(run.record),
        };
      }
      thread.status = "idle";
      run.run.status = "success";
    }
    // The status change.
    this.touch(thread);
  }

  private topicMetaOf(
    record: IngestRecord | undefined,
  ): Record<string, unknown> {
    if (!record?.topic_name) return {};
    return {
      topic_name: record.topic_name,
      ...(typeof record.cts === "number" ? { question_sets: record.cts } : {}),
      ...(typeof record.questions === "number"
        ? { questions: record.questions }
        : {}),
    };
  }

  private registerRecordFiles(record: IngestRecord): void {
    const result = record.result ?? {};
    for (const url of [result.topic_json_url, result.source_topic_json_url]) {
      if (url && !this.files.has(url))
        this.files.set(url, readFixture(TOPIC_FIXTURE));
    }
    if (result.topic_md_url && !this.files.has(result.topic_md_url)) {
      this.files.set(
        result.topic_md_url,
        Buffer.from(
          `# Topic: ${record.topic_name ?? FIXTURE_TOPIC.name}\n\n- Topic ID: ${FIXTURE_TOPIC.id}\n`,
        ),
      );
    }
  }

  private touch(thread: FakeThread): void {
    thread.updated_at = new Date().toISOString();
  }

  private newRun(
    threadId: string,
    graphId: string,
    status: FakeRun["status"],
    at: string,
    input: unknown,
  ): FakeRun {
    return {
      run_id: randomUUID(),
      thread_id: threadId,
      assistant_id: assistantUuid(graphId),
      created_at: at,
      updated_at: at,
      status,
      metadata: {},
      multitask_strategy: "reject",
      kwargs: { input },
    };
  }

  // ------------------------------------------------------------ LangGraph API

  private stateOf(thread: FakeThread) {
    const checkpoint = this.checkpoint(thread.thread_id);
    return {
      values: thread.values ?? {},
      next: checkpoint.next,
      tasks: [],
      metadata: checkpoint.at ? { source: "loop" } : null,
      created_at: checkpoint.at,
      checkpoint: {
        thread_id: thread.thread_id,
        checkpoint_ns: "",
        checkpoint_id: checkpoint.at ? `cp-${Date.parse(checkpoint.at)}` : null,
      },
      parent_checkpoint: null,
      interrupts: [],
    };
  }

  private search(body: SearchBody): unknown[] {
    let rows = [...this.threads.values()];
    if (Array.isArray(body.ids))
      rows = rows.filter((t) => body.ids!.includes(t.thread_id));
    else rows = rows.filter((t) => !this.hiddenFromLists.has(t.thread_id));
    if (body.metadata && typeof body.metadata === "object") {
      rows = rows.filter((t) =>
        Object.entries(body.metadata!).every(([key, value]) =>
          deepEqual(t.metadata[key], value),
        ),
      );
    }
    if (body.status) rows = rows.filter((t) => t.status === body.status);
    const sortBy = (body.sort_by ?? "created_at") as keyof FakeThread;
    const direction = body.sort_order === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const left = String(a[sortBy] ?? "");
      const right = String(b[sortBy] ?? "");
      return left < right ? -direction : left > right ? direction : 0;
    });
    const offset = Math.max(0, body.offset ?? 0);
    const limit = Math.max(0, body.limit ?? 10);
    rows = rows.slice(offset, offset + limit);
    const select = body.select;
    if (!Array.isArray(select) || select.length === 0) return rows;
    return rows.map((thread) =>
      Object.fromEntries(
        select
          .filter((key) => key in thread)
          .map((key) => [key, thread[key as keyof FakeThread]]),
      ),
    );
  }

  private createThread(body: {
    thread_id?: string;
    metadata?: Record<string, unknown>;
    if_exists?: string;
  }): { status: number; json: unknown } {
    const threadId = body.thread_id ?? randomUUID();
    const existing = this.threads.get(threadId);
    if (existing) {
      if (body.if_exists === "do_nothing")
        return { status: 200, json: existing };
      return {
        status: 409,
        json: { detail: `Thread ${threadId} already exists` },
      };
    }
    const now = new Date().toISOString();
    const thread: FakeThread = {
      thread_id: threadId,
      created_at: now,
      updated_at: now,
      metadata: { ...(body.metadata ?? {}), owner_id: OWNER_ID },
      status: "idle",
      values: null,
      interrupts: {},
    };
    this.threads.set(threadId, thread);
    this.checkpoints.set(threadId, { next: [], at: null });
    this.runs.set(threadId, []);
    if (this.hideNewThreadsFromLists) this.hiddenFromLists.add(threadId);
    this.calls.threadCreates.push({ body, threadId });
    return { status: 200, json: thread };
  }

  private createRun(
    thread: FakeThread,
    body: RunCreateCall["body"],
    elsewhere?: { script: RunScript },
  ): { status: number; json: unknown; headers?: Record<string, string> } {
    const threadId = thread.thread_id;
    const assistant = String(body.assistant_id ?? "");
    const graphId = isUuid(assistant)
      ? String(thread.metadata.graph_id ?? assistant)
      : assistant;
    const script = elsewhere
      ? elsewhere.script
      : graphId === INGEST_GRAPH_ID
        ? this.queue.shift()
        : undefined;
    const call: RunCreateCall = { threadId, body, status: 200 };
    if (!elsewhere) this.calls.runCreates.push(call);

    if (script?.reject) {
      call.status = script.reject.status;
      return {
        status: script.reject.status,
        json: script.reject.json ?? { detail: "Run rejected (fake)" },
        headers: script.reject.headers,
      };
    }
    if (thread.status === "busy") {
      call.status = 409;
      return {
        status: 409,
        json: {
          detail:
            "Thread is already running a task. Wait for it to finish or choose a different multitask strategy.",
        },
      };
    }

    const now = new Date().toISOString();
    const input = (body.input ?? {}) as RunInput;
    const run = this.newRun(threadId, graphId, "running", now, input);
    run.metadata = body.metadata ?? {};
    run.multitask_strategy = body.multitask_strategy ?? "reject";
    run.kwargs = { input, config: body.config };
    this.runs.set(threadId, [run, ...(this.runs.get(threadId) ?? [])]);
    // The server stamps the graph and assistant on the thread when a run is created.
    thread.metadata = {
      ...thread.metadata,
      graph_id: graphId,
      assistant_id: assistantUuid(graphId),
    };

    if (graphId === INGEST_GRAPH_ID) {
      const record = script?.error
        ? undefined
        : typeof script?.record === "function"
          ? script.record({ input, threadId })
          : (script?.record ??
            buildRecord("valid", { fileName: input.file_name, threadId }));
      // Busy at once; the run waits as "pending" until the worker picks it up. Until then the
      // state (values, next, checkpoint time) is still the last run's.
      thread.status = "busy";
      run.status = "pending";
      this.touch(thread);
      const active: ActiveRun = {
        run,
        steps: (script?.stages ?? PLAIN_STAGES).map(toStep),
        stageMs: script?.stageMs ?? 300,
        pendingMs: script?.pendingMs ?? 0,
        index: -1,
        enteredAt: Date.now(),
        record,
        error: script?.error,
      };
      this.active.set(threadId, active);
      if (active.pendingMs === 0) this.step(threadId);
    } else {
      // A Crafter message: answer at once.
      const previous = Array.isArray(thread.values?.messages)
        ? (thread.values!.messages as unknown[])
        : [];
      const sent = Array.isArray((input as { messages?: unknown[] }).messages)
        ? ((input as { messages: unknown[] }).messages ?? [])
        : [];
      thread.values = {
        ...(thread.values ?? {}),
        messages: [
          ...previous,
          ...sent,
          { id: `${run.run_id}-ai`, type: "ai", content: "Fake answer." },
        ],
      };
      run.status = "success";
      thread.status = "idle";
      this.checkpoints.set(threadId, { next: [], at: now });
      this.touch(thread);
    }
    return {
      status: 200,
      json: run,
      headers: {
        "content-location": `/threads/${threadId}/runs/${run.run_id}`,
      },
    };
  }

  private corsHeaders(request: Request): Record<string, string> {
    const headers = request.headers();
    return {
      "access-control-allow-origin": headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        headers["access-control-request-headers"] ??
        "authorization,content-type,x-api-key",
      "access-control-expose-headers":
        "content-location,x-user-limit-code,content-type",
      "access-control-max-age": "600",
      vary: "origin",
    };
  }

  private async handleApi(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    const cors = this.corsHeaders(request);
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const reply = async (
      status: number,
      json?: unknown,
      headers: Record<string, string> = {},
    ) => {
      if (status === 204 || json === undefined) {
        await route.fulfill({ status, headers: { ...cors, ...headers } });
        return;
      }
      await route.fulfill({
        status,
        headers: { ...cors, "content-type": "application/json", ...headers },
        body: JSON.stringify(json),
      });
    };

    this.tick();
    const url = new URL(request.url());
    const path = url.pathname.replace(/\/+$/, "") || "/";
    let body: Record<string, unknown> = {};
    try {
      body = (request.postDataJSON() as Record<string, unknown>) ?? {};
    } catch {
      body = {};
    }

    if (method === "GET" && (path === "/info" || path === "/ok"))
      return reply(200, { version: "fake-langgraph-e2e", flags: {} });
    if (method === "GET" && path === "/user/limits")
      return reply(200, this.budget);
    if (method === "POST" && path === "/threads/search") {
      this.calls.searches.push(body as SearchBody);
      if (this.pollFailure && Array.isArray((body as SearchBody).ids))
        return reply(
          this.pollFailure.status,
          this.pollFailure.json ?? { detail: "Poll refused (fake)" },
        );
      return reply(200, this.search(body as SearchBody));
    }
    if (method === "POST" && path === "/threads/count") {
      return reply(
        200,
        this.search({ ...(body as SearchBody), limit: 1e6, select: undefined })
          .length,
      );
    }
    if (method === "POST" && path === "/threads") {
      const created = this.createThread(body);
      return reply(created.status, created.json);
    }

    const match = /^\/threads\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (match) {
      const threadId = decodeURIComponent(match[1]!);
      const rest = match[2] ?? "";
      const thread = this.threads.get(threadId);
      if (!thread)
        return reply(404, { detail: `Thread with ID ${threadId} not found` });

      if (rest === "") {
        if (method === "GET") return reply(200, thread);
        if (method === "PATCH") {
          const metadata = (body.metadata ?? {}) as Record<string, unknown>;
          this.calls.threadPatches.push({ threadId, metadata });
          thread.metadata = { ...thread.metadata, ...metadata };
          this.touch(thread);
          return reply(200, thread);
        }
        if (method === "DELETE") {
          this.threads.delete(threadId);
          this.active.delete(threadId);
          this.checkpoints.delete(threadId);
          return reply(204);
        }
      }
      if (
        rest === "state" ||
        rest === "state/checkpoint" ||
        rest.startsWith("state/")
      ) {
        if (method === "GET" || (method === "POST" && rest !== "state")) {
          this.calls.stateReads.push(threadId);
          const record = thread.values?.record;
          this.calls.stateReadLog.push({
            threadId,
            busy: thread.status === "busy",
            next: [...this.checkpoint(threadId).next],
            hadRecord: !!record && typeof record === "object",
          });
          return reply(200, this.stateOf(thread));
        }
      }
      if (rest === "history" && method === "POST") {
        const values = thread.values ?? {};
        return reply(
          200,
          Object.keys(values).length ? [this.stateOf(thread)] : [],
        );
      }
      if (rest === "runs") {
        if (method === "GET") {
          this.calls.runLists.push(threadId);
          const limit = Number(url.searchParams.get("limit") ?? 10);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return reply(
            200,
            (this.runs.get(threadId) ?? []).slice(offset, offset + limit),
          );
        }
        if (method === "POST") {
          const created = this.createRun(thread, body as RunCreateCall["body"]);
          return reply(created.status, created.json, created.headers);
        }
      }
      const runMatch = /^runs\/([^/]+)(?:\/(cancel|join))?$/.exec(rest);
      if (runMatch) {
        const run = (this.runs.get(threadId) ?? []).find(
          (r) => r.run_id === runMatch[1],
        );
        if (!run) return reply(404, { detail: "Run not found" });
        if (!runMatch[2] && method === "GET") return reply(200, run);
        if (!runMatch[2] && method === "DELETE") return reply(204);
        if (runMatch[2] === "cancel" && method === "POST") {
          this.active.delete(threadId);
          run.status = "interrupted";
          thread.status = "idle";
          this.touch(thread);
          return reply(204);
        }
        if (runMatch[2] === "join" && method === "GET")
          return reply(200, thread.values ?? {});
      }
    }

    this.calls.unhandled.push(`${method} ${path}`);
    return reply(404, {
      detail: `Not found (fake LangGraph): ${method} ${path}`,
    });
  }

  // ------------------------------------------------------------ app routes

  private async handleUpload(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fulfill({
        status: 405,
        json: { error: { code: "METHOD", message: "POST only" } },
      });
      return;
    }
    const file = parseMultipartFile(
      request.postDataBuffer() ?? Buffer.alloc(0),
      request.headers()["content-type"],
    );
    const call: UploadCall = {
      fileName: file?.fileName,
      contentType: file?.contentType,
      size: file?.body.length ?? 0,
    };
    this.calls.uploads.push(call);
    if (this.uploadFailure) {
      await route.fulfill({
        status: this.uploadFailure.status,
        json: this.uploadFailure.json ?? {
          error: { code: "UPLOAD_FAILED", message: "Upload failed (fake)." },
        },
      });
      return;
    }
    if (!file) {
      await route.fulfill({
        status: 400,
        json: { error: { code: "NO_FILE", message: "No file was sent." } },
      });
      return;
    }
    const url = `${TEST_BUCKET}/topic-ingest/${randomUUID()}.json`;
    this.files.set(url, file.body);
    call.url = url;
    const response: IngestUploadResponse = {
      url,
      fileName: file.fileName ?? "topic.json",
      size: file.body.length,
    };
    await route.fulfill({ status: 200, json: response });
  }

  private async handleTopicFile(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const target = url.searchParams.get("url");
    const name = url.searchParams.get("name");
    this.calls.topicFiles.push({ url: target, name });
    const body = target ? this.files.get(target) : undefined;
    if (!body) {
      await route.fulfill({
        status: 404,
        json: { error: { code: "NOT_FOUND", message: "No such file (fake)." } },
      });
      return;
    }
    const fileName = name ?? "topic.json";
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": fileName.endsWith(".md")
          ? "text/markdown; charset=utf-8"
          : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
      body,
    });
  }
}
