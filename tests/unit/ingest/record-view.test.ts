import { describe, expect, it } from "vitest";

import type {
  IngestRecord,
  IngestThreadMetadata,
  IngestThreadSnapshot,
} from "@/lib/ingest/ingest-types";
import { deriveProgress } from "@/lib/ingest/progress";
import {
  buildResult,
  ctIndexFromRecord,
  isRunEnded,
  isThreadStalled,
  metadataOf,
  recordOf,
  START_GRACE_MS,
  threadToView,
  topicInfoOf,
} from "@/lib/ingest/record-view";
import {
  FAILED_TO_START,
  RUN_ERROR,
  STALL_AFTER_MS,
  statusCopy,
} from "@/lib/ingest/status-copy";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const SOURCE =
  "https://storage.googleapis.com/qc-uploads/topic-ingest/0b6c5e1f.json";
const JSON_URL =
  "https://storage.googleapis.com/qc-uploads/topic-import/photosynthesis_grade_8_fixed.json";
const MD_URL =
  "https://storage.googleapis.com/qc-uploads/topic-import/photosynthesis_grade_8_fixed.md";

/** Metadata of a finished ingest; override any key, or set it to undefined to drop it. */
const meta = (fields: Partial<IngestThreadMetadata> = {}) =>
  ({
    graph_id: "topic_ingest",
    owner_id: "accounts.google.com:1234567890",
    thread_title: "photosynthesis_grade_8.json",
    ingest_file_name: "photosynthesis_grade_8.json",
    ingest_source_url: SOURCE,
    ingest_stage: "done",
    ingest_status: "needs_author_fixes",
    topic_name: "Photosynthesis (Grade 8)",
    question_sets: 2,
    questions: 3,
    ...fields,
  }) satisfies IngestThreadMetadata;

const thread = (
  status: string,
  metadata: Partial<IngestThreadMetadata> = {},
  extra: Partial<IngestThreadSnapshot> = {},
): IngestThreadSnapshot => ({
  thread_id: "thread-1",
  status,
  metadata: meta(metadata),
  created_at: iso(T0),
  updated_at: iso(T0 + MIN),
  ...extra,
});

/** A thread the UI has just created: queued, nothing from the graph yet. */
const queuedMeta = {
  ingest_stage: "queued",
  ingest_status: "queued",
  topic_name: undefined,
  question_sets: undefined,
  questions: undefined,
};

const finished = (fields: Partial<IngestRecord> = {}): IngestRecord => ({
  status: "needs_author_fixes",
  stage: "done",
  topic_id: "topic-123",
  topic_name: "Photosynthesis (Grade 8)",
  cts: 2,
  questions: 3,
  ct_keys: ["light_ct_001", "leaves_ct_002"],
  ...fields,
});

describe("metadataOf: the flat ingest keys, type-checked", () => {
  it("keeps non-empty strings and finite numbers, and drops everything else", () => {
    expect(
      metadataOf({
        metadata: {
          graph_id: "topic_ingest",
          thread_title: "  ",
          ingest_file_name: "a.json",
          ingest_stage: 3,
          ingest_status: "fixing",
          topic_name: { text: "x" },
          question_sets: "2",
          questions: Number.NaN,
          other: "kept out",
        },
      }),
    ).toEqual({
      graph_id: "topic_ingest",
      ingest_file_name: "a.json",
      ingest_status: "fixing",
    });
    expect(
      metadataOf({ metadata: { question_sets: 0, questions: 4 } }),
    ).toEqual({ question_sets: 0, questions: 4 });
  });

  it("reads nothing from missing or odd metadata", () => {
    for (const metadata of [undefined, null, [], "x"])
      expect(
        metadataOf({ metadata } as unknown as IngestThreadSnapshot),
      ).toEqual({});
    expect(metadataOf(undefined)).toEqual({});
  });
});

describe("topicInfoOf: the topic line", () => {
  it("takes the graph's topic name and counts from the metadata", () => {
    expect(topicInfoOf(meta())).toEqual({
      name: "Photosynthesis (Grade 8)",
      fileName: "photosynthesis_grade_8.json",
      questionSets: 2,
      questions: 3,
      downloadName: "photosynthesis_grade_8",
    });
  });

  it("falls back to the record, then the file name, then the thread title", () => {
    const bare = meta({
      topic_name: undefined,
      question_sets: undefined,
      questions: undefined,
    });
    expect(
      topicInfoOf(
        bare,
        finished({ topic_name: "Leaves", cts: 4, questions: 9 }),
      ),
    ).toMatchObject({ name: "Leaves", questionSets: 4, questions: 9 });
    expect(topicInfoOf(bare)).toMatchObject({
      name: "photosynthesis_grade_8.json",
      questionSets: undefined,
      questions: undefined,
    });
    expect(topicInfoOf({ thread_title: "My renamed ingest" }).name).toBe(
      "My renamed ingest",
    );
    expect(topicInfoOf(null)).toEqual({
      name: "Untitled topic",
      fileName: undefined,
      questionSets: undefined,
      questions: undefined,
      downloadName: "untitled_topic",
    });
  });

  it("names downloads after the creator's file when it is a slug, else after the topic", () => {
    expect(
      topicInfoOf(meta({ ingest_file_name: "photosynthesis_grade_8 (1).json" }))
        .downloadName,
    ).toBe("photosynthesis_grade_8");
    expect(
      topicInfoOf(meta({ ingest_file_name: "leaves.json" })).downloadName,
    ).toBe("leaves");
  });
});

describe("isRunEnded", () => {
  const now = T0 + 5_000;

  it("an error has ended and a busy thread hasn't, whatever the metadata says", () => {
    expect(
      isRunEnded(thread("error", queuedMeta), { startedAt: T0, now }),
    ).toBe(true);
    expect(isRunEnded(thread("busy"), { startedAt: T0, now })).toBe(false);
    expect(isRunEnded(thread("busy", queuedMeta))).toBe(false);
  });

  it("an idle thread with a final status has ended, even right after the start", () => {
    expect(isRunEnded(thread("idle"), { startedAt: T0, now })).toBe(true);
    expect(isRunEnded(thread("idle", { ingest_status: "valid" }))).toBe(true);
    expect(isRunEnded(thread("interrupted", { ingest_status: "fixed" }))).toBe(
      true,
    );
    expect(isRunEnded(thread("idle", { ingest_status: FAILED_TO_START }))).toBe(
      true,
    );
  });

  it("an idle thread without a final status is still starting during the grace period", () => {
    const idle = thread("idle", queuedMeta);
    expect(START_GRACE_MS).toBe(15_000);
    expect(isRunEnded(idle, { startedAt: T0, now: T0 })).toBe(false);
    expect(
      isRunEnded(idle, { startedAt: T0, now: T0 + START_GRACE_MS - 1 }),
    ).toBe(false);
    expect(isRunEnded(idle, { startedAt: T0, now: T0 + START_GRACE_MS })).toBe(
      true,
    );
    expect(
      isRunEnded(thread("idle", { ingest_status: "processing" }), {
        startedAt: T0,
        now,
      }),
    ).toBe(false);
  });

  it("without a start time (opened from history), an idle thread has ended", () => {
    expect(isRunEnded(thread("idle", queuedMeta))).toBe(true);
    expect(isRunEnded(thread("idle", { ingest_status: "processing" }))).toBe(
      true,
    );
    expect(
      isRunEnded(thread("idle", queuedMeta), { startedAt: Number.NaN, now }),
    ).toBe(true);
  });
});

describe("threadToView: running", () => {
  it("is running right after the UI created the thread, before the run is busy", () => {
    const view = threadToView({
      thread: thread("idle", queuedMeta),
      startedAt: T0,
      now: T0 + 2_000,
    });
    expect(view).toMatchObject({
      threadId: "thread-1",
      phase: "running",
      busy: false,
      sourceUrl: SOURCE,
      createdAt: iso(T0),
      updatedAt: iso(T0 + MIN),
      topic: {
        name: "photosynthesis_grade_8.json",
        downloadName: "photosynthesis_grade_8",
      },
      progress: { stage: "queued", queued: true, fixSeen: false },
    });
    expect(view.result).toBeUndefined();
  });

  it("is running while busy, with the stage for the steps", () => {
    const fixing = threadToView({
      thread: thread("busy", {
        ingest_stage: "fixing",
        ingest_status: "processing",
      }),
      now: T0 + 2 * MIN,
    });
    expect(fixing).toMatchObject({
      phase: "running",
      busy: true,
      topic: { name: "Photosynthesis (Grade 8)", questionSets: 2 },
      progress: { stage: "fixing", queued: false, fixSeen: true },
    });
    expect(fixing.result).toBeUndefined();
    // A busy thread is never read as finished, even with values at hand.
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: "checking",
          ingest_status: "processing",
        }),
        values: { record: finished() },
        now: T0 + 2 * MIN,
      }),
    ).toMatchObject({
      phase: "running",
      progress: { stage: "checking", queued: false, fixSeen: false },
    });
  });

  it("is queued until the graph writes its first stage", () => {
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: undefined,
          ingest_status: undefined,
        }),
        now: T0 + MIN,
      }).progress,
    ).toEqual({ stage: "queued", queued: true, fixSeen: false });
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: "reading",
          ingest_status: "queued",
        }),
        now: T0 + MIN,
      }).progress,
    ).toEqual({ stage: "reading", queued: true, fixSeen: false });
  });

  it("keeps the fix steps at publishing once the fix stage was seen", () => {
    const view = threadToView({
      thread: thread("busy", {
        ingest_stage: "publishing",
        ingest_status: "processing",
      }),
      fixSeen: true,
      now: T0 + MIN,
    });
    expect(view.progress).toEqual({
      stage: "publishing",
      queued: false,
      fixSeen: true,
    });
    expect(deriveProgress(view.progress!).steps.map((s) => s.id)).toEqual([
      "read",
      "check",
      "fix",
      "recheck",
      "finish",
    ]);
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: "rechecking",
          ingest_status: "processing",
        }),
        now: T0 + MIN,
      }).progress?.fixSeen,
    ).toBe(true);
  });
});

describe("threadToView: stalled", () => {
  const busy = thread(
    "busy",
    { ingest_stage: "fixing", ingest_status: "processing" },
    { updated_at: iso(T0) },
  );

  it("is stalled when busy with no progress for 30 minutes", () => {
    expect(STALL_AFTER_MS).toBe(30 * MIN);
    expect(threadToView({ thread: busy, now: T0 + 29 * MIN }).phase).toBe(
      "running",
    );
    const stalled = threadToView({ thread: busy, now: T0 + 31 * MIN });
    expect(stalled).toMatchObject({
      phase: "stalled",
      busy: true,
      progress: { stage: "fixing" },
    });
    expect(stalled.result).toBeUndefined();
    expect(isThreadStalled(busy, T0 + 31 * MIN)).toBe(true);
  });

  it("is never stalled when not busy, or without an update time", () => {
    expect(
      isThreadStalled(
        thread("idle", queuedMeta, { updated_at: iso(T0) }),
        T0 + 60 * MIN,
      ),
    ).toBe(false);
    expect(
      threadToView({
        thread: thread("busy", {}, { updated_at: undefined }),
        now: T0 + 600 * MIN,
      }).phase,
    ).toBe("running");
    expect(
      threadToView({
        thread: thread(
          "idle",
          { ingest_status: "valid" },
          { updated_at: iso(T0) },
        ),
        values: { record: finished({ status: "valid" }) },
        now: T0 + 600 * MIN,
      }).phase,
    ).toBe("done");
  });
});

describe("threadToView: done, with the record", () => {
  it("maps the graph's result: plain issues by set, labelled fixer report, links, cost", () => {
    const view = threadToView({
      thread: thread("idle"),
      values: {
        source_url: SOURCE,
        file_name: "photosynthesis_grade_8.json",
        record: finished({
          message: "The topic has issues to fix; download the issue report.",
          result: {
            issue_report_md: "# Topic import report",
            updater_report: "Fixed:\n- leaves_ct_002 / 1: tidied the maths",
            preview_link: "javascript:alert(1)",
            topic_json_url: JSON_URL,
            source_topic_json_url: SOURCE,
            warnings: ["The topic updater saved no changes."],
            validation: {
              questions: 3,
              error_count: 1,
              warning_count: 0,
              infrastructure_failures: 0,
            },
            findings: [
              {
                severity: "error",
                code: "HINT REQUIRED",
                ct_key: "leaves_ct_002",
                question_no: 1,
                message: "m",
              },
              {
                severity: "error",
                code: "PARSER LATEX",
                ct_key: "light_ct_001",
                question_no: 2,
                message: "down",
                infrastructure: true,
              },
            ],
          },
          cost: { updater_ran: true, updater_cost_usd: 0.42 },
        }),
      },
      now: T0 + 2 * MIN,
    });
    expect(view.phase).toBe("done");
    expect(view.busy).toBe(false);
    expect(view.progress).toBeUndefined();
    expect(view.sourceUrl).toBe(SOURCE);
    expect(view.topic).toMatchObject({
      name: "Photosynthesis (Grade 8)",
      downloadName: "photosynthesis_grade_8",
    });
    expect(view.result).toMatchObject({
      status: "needs_author_fixes",
      message: "The topic has issues to fix; download the issue report.",
      issueReportMd: "# Topic import report",
      updaterReport:
        "Fixed:\n- Set 2, variant 1 `set-key:leaves_ct_002`: tidied the maths",
      previewLink: undefined,
      topicJsonUrl: JSON_URL,
      topicMdUrl: undefined,
      warnings: ["The topic updater saved no changes."],
      technical: {
        validation: {
          questions: 3,
          errorCount: 1,
          warningCount: 0,
          infrastructureFailures: 0,
        },
        cost: { updaterRan: true, updaterCostUsd: 0.42 },
        threadId: "thread-1",
      },
    });
    expect(view.result?.technical.findings).toHaveLength(2);
    // A service outage isn't a topic issue.
    expect(view.result?.issues).toEqual([
      expect.objectContaining({
        label: "Set 2, variant 1",
        ctKey: "leaves_ct_002",
      }),
    ]);
  });

  it("prefers the record to the thread's error status", () => {
    const view = threadToView({
      thread: thread("error", { ingest_status: "valid" }),
      values: { record: finished({ status: "valid" }) },
    });
    expect(view).toMatchObject({ phase: "done", result: { status: "valid" } });
  });

  it("shows a record with a status this UI doesn't know (statusCopy says 'unknown')", () => {
    const view = threadToView({
      thread: thread("idle", { ingest_status: "processing" }),
      values: { record: finished({ status: "something_new" }) },
    });
    expect(view).toMatchObject({
      phase: "done",
      result: { status: "something_new" },
    });
    expect(statusCopy(view.result?.status).status).toBe("unknown");
  });
});

describe("threadToView: done, without a record", () => {
  it("run_error when the thread is in error", () => {
    const view = threadToView({
      thread: thread("error", {
        ingest_stage: "checking",
        ingest_status: "processing",
      }),
      values: { record: null },
    });
    expect(view).toMatchObject({ phase: "done", busy: false });
    expect(view.progress).toBeUndefined();
    expect(view.result).toEqual({
      status: RUN_ERROR,
      message: "",
      issues: [],
      warnings: [],
      technical: { findings: [], threadId: "thread-1" },
    });
    expect(statusCopy(view.result?.status).title).toBe(
      "We couldn't finish checking.",
    );
  });

  it("run_error even right after the start (an error has ended)", () => {
    expect(
      threadToView({
        thread: thread("error", queuedMeta),
        startedAt: T0,
        now: T0 + 1_000,
      }).result?.status,
    ).toBe(RUN_ERROR);
  });

  it("the metadata's final status when the state has no record", () => {
    for (const values of [undefined, null, {}, { record: null }]) {
      const view = threadToView({
        thread: thread("idle", { ingest_status: "valid" }),
        values,
      });
      expect(view).toMatchObject({ phase: "done", topic: { questions: 3 } });
      expect(view.result).toEqual({
        status: "valid",
        message: "",
        issues: [],
        warnings: [],
        technical: { findings: [], threadId: "thread-1" },
      });
    }
  });

  it("failed_to_start when an idle thread has neither a record nor a final status", () => {
    const view = threadToView({ thread: thread("idle", queuedMeta) });
    expect(view.phase).toBe("done");
    expect(view.result).toEqual({
      status: FAILED_TO_START,
      message: "",
      issues: [],
      warnings: [],
      technical: { findings: [], threadId: "thread-1" },
    });
    // After the grace period, a run the UI started that never got busy didn't start.
    expect(
      threadToView({
        thread: thread("idle", queuedMeta),
        startedAt: T0,
        now: T0 + START_GRACE_MS + 1,
      }).result?.status,
    ).toBe(FAILED_TO_START);
    // Something in values that isn't a record is ignored.
    expect(
      threadToView({
        thread: thread("idle", queuedMeta),
        values: { record: "oops" } as never,
      }).result?.status,
    ).toBe(FAILED_TO_START);
  });
});

describe("threadToView: the uploaded file's link (for Run again)", () => {
  it("comes from the metadata, else the state, and only as https", () => {
    const view = (metadataUrl: string | undefined, stateUrl?: string) =>
      threadToView({
        thread: thread("idle", { ingest_source_url: metadataUrl }),
        values: stateUrl ? { source_url: stateUrl } : undefined,
      }).sourceUrl;
    expect(view(SOURCE)).toBe(SOURCE);
    expect(view(undefined, SOURCE)).toBe(SOURCE);
    expect(view("http://storage.googleapis.com/b/x.json", SOURCE)).toBe(SOURCE);
    expect(view("javascript:alert(1)")).toBeUndefined();
    expect(view(undefined, "file:///etc/passwd")).toBeUndefined();
    expect(view(undefined)).toBeUndefined();
  });
});

describe("buildResult", () => {
  it("knows when the fixer didn't run, and when a download isn't allowed", () => {
    const result = buildResult(
      finished({
        status: "valid",
        result: { topic_json_url: "https://evil.example/t.json" },
        cost: { updater_ran: false, updater_cost_usd: null },
      }),
      { threadId: "thread-1" },
    );
    expect(result.technical.cost).toEqual({ updaterRan: false });
    expect(result.topicJsonUrl).toBeUndefined();
    expect(result.topicMdUrl).toBeUndefined();
    expect(result.technical.threadId).toBe("thread-1");
  });

  it("offers topic files only on allow-listed https storage links", () => {
    const links = (topic_json_url?: string, topic_md_url?: string) => {
      const r = buildResult(
        finished({ status: "fixed", result: { topic_json_url, topic_md_url } }),
        { threadId: "t" },
      );
      return [r.topicJsonUrl, r.topicMdUrl];
    };
    expect(links(JSON_URL, MD_URL)).toEqual([JSON_URL, MD_URL]);
    expect(links(JSON_URL, undefined)).toEqual([JSON_URL, undefined]);
    expect(
      links("https://evil.example/t.json", "https://evil.example/t.md"),
    ).toEqual([undefined, undefined]);
    expect(
      links(
        "http://storage.googleapis.com/b/t.json",
        "https://user@storage.googleapis.com/b/t.md",
      ),
    ).toEqual([undefined, undefined]);
    expect(
      links("https://storage.googleapis.com:8443/b/t.json", "/b/t.md"),
    ).toEqual([undefined, undefined]);
  });

  it("keeps http(s) preview links only", () => {
    const preview = (preview_link: string | null) =>
      buildResult(finished({ result: { preview_link } }), { threadId: "t" })
        .previewLink;
    expect(preview("https://preview.example/topic/1")).toBe(
      "https://preview.example/topic/1",
    );
    expect(preview("http://localhost:3000/p")).toBe("http://localhost:3000/p");
    expect(preview("javascript:alert(1)")).toBeUndefined();
    expect(preview("not a link")).toBeUndefined();
    expect(preview(null)).toBeUndefined();
  });

  it("reads a sparse or odd record safely", () => {
    expect(buildResult({}, { threadId: "t" })).toEqual({
      status: "unknown",
      message: "",
      issueReportMd: undefined,
      updaterReport: undefined,
      previewLink: undefined,
      topicJsonUrl: undefined,
      topicMdUrl: undefined,
      issues: [],
      warnings: [],
      technical: {
        validation: undefined,
        findings: [],
        cost: undefined,
        threadId: "t",
      },
    });
    const odd = buildResult(
      {
        status: "valid",
        result: {
          warnings: ["ok", 3, null] as unknown as string[],
          findings: "x" as never,
          validation: "x" as never,
        },
        cost: "x" as never,
        ct_keys: "x" as never,
      },
      { threadId: "t" },
    );
    expect(odd.warnings).toEqual(["ok"]);
    expect(odd.technical).toMatchObject({
      findings: [],
      validation: undefined,
      cost: undefined,
    });
  });

  it("caps findings at 300 and each message at 1,000 characters", () => {
    const result = buildResult(
      finished({
        result: {
          findings: Array.from({ length: 320 }, (_, i) => ({
            code: "HINT REQUIRED",
            ct_key: "light_ct_001",
            question_no: i,
            message: "m".repeat(1500),
          })),
        },
      }),
      { threadId: "t" },
    );
    expect(result.technical.findings).toHaveLength(300);
    expect(result.technical.findings[0]).toMatchObject({
      severity: "error",
      ctKey: "light_ct_001",
      questionNo: 0,
    });
    expect(result.technical.findings[0]!.message).toHaveLength(1000);
  });
});

describe("ctIndexFromRecord and recordOf", () => {
  it("numbers sets by their position, first key wins, odd keys skipped", () => {
    expect(
      ctIndexFromRecord({
        ct_keys: ["a_ct_001", "", "b_ct_002", "a_ct_001", 7 as never],
      }),
    ).toEqual({ a_ct_001: 1, b_ct_002: 3 });
    expect(ctIndexFromRecord({})).toEqual({});
  });

  it("reads values.record only when it is an object", () => {
    expect(recordOf({ record: finished() })).toMatchObject({ cts: 2 });
    for (const values of [
      undefined,
      null,
      {},
      { record: null },
      { record: [] },
    ])
      expect(recordOf(values as never)).toBeUndefined();
  });
});
