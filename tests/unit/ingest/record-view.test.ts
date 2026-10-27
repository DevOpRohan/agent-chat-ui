import { describe, expect, it } from "vitest";

import type {
  IngestRecord,
  IngestThreadMetadata,
  IngestThreadSnapshot,
} from "@/lib/ingest/ingest-types";
import { deriveProgress } from "@/lib/ingest/progress";
import {
  buildResult,
  checkpointProgress,
  ctIndexFromRecord,
  hasGraphStage,
  isActiveRunStatus,
  isRunEnded,
  isThreadStalled,
  lastProgressAt,
  mergeCheckpointProgress,
  metadataOf,
  needsLatestRun,
  progressStage,
  recordOf,
  stageFromNext,
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
  it("an error has ended and a busy thread hasn't, whatever the metadata or the runs say", () => {
    expect(isRunEnded(thread("error", queuedMeta))).toBe(true);
    expect(
      isRunEnded(thread("error", queuedMeta), { latestRunStatus: "running" }),
    ).toBe(true);
    expect(isRunEnded(thread("busy"))).toBe(false);
    expect(isRunEnded(thread("busy", queuedMeta))).toBe(false);
    expect(
      isRunEnded(thread("busy", queuedMeta), { latestRunStatus: "success" }),
    ).toBe(false);
  });

  it("an idle thread with a final status in the metadata has ended, without asking the runs", () => {
    expect(isRunEnded(thread("idle"))).toBe(true);
    expect(isRunEnded(thread("idle", { ingest_status: "valid" }))).toBe(true);
    expect(isRunEnded(thread("interrupted", { ingest_status: "fixed" }))).toBe(
      true,
    );
    expect(isRunEnded(thread("idle", { ingest_status: FAILED_TO_START }))).toBe(
      true,
    );
    expect(needsLatestRun(thread("idle"))).toBe(false);
    expect(needsLatestRun(thread("error", queuedMeta))).toBe(false);
    expect(needsLatestRun(thread("busy", queuedMeta))).toBe(false);
  });

  it("without a final status (the runtime dropped the graph's writes), the latest run decides", () => {
    for (const metadata of [queuedMeta, { ingest_status: "processing" }]) {
      const idle = thread("idle", metadata);
      expect(needsLatestRun(idle)).toBe(true);
      expect(needsLatestRun(thread("interrupted", metadata))).toBe(true);
      // Not asked yet: not ended (the pane asks runs.list before it reads the state).
      expect(isRunEnded(idle)).toBe(false);
      expect(isRunEnded(idle, { latestRunStatus: "pending" })).toBe(false);
      expect(isRunEnded(idle, { latestRunStatus: "running" })).toBe(false);
      for (const status of ["success", "error", "timeout", "interrupted"])
        expect(isRunEnded(idle, { latestRunStatus: status })).toBe(true);
      // No run at all: it never started.
      expect(isRunEnded(idle, { latestRunStatus: null })).toBe(true);
    }
  });

  it("only pending and running are runs that haven't finished", () => {
    expect(isActiveRunStatus("pending")).toBe(true);
    expect(isActiveRunStatus("running")).toBe(true);
    for (const status of [
      "success",
      "error",
      "timeout",
      "interrupted",
      null,
      undefined,
      "",
    ])
      expect(isActiveRunStatus(status)).toBe(false);
  });
});

describe("fallback progress: the checkpoint's next step", () => {
  it("maps each graph step to its stage, and an empty next to done", () => {
    expect(stageFromNext(["reset"])).toBe("reading");
    expect(stageFromNext(["load"])).toBe("reading");
    expect(stageFromNext(["validate"])).toBe("checking");
    expect(stageFromNext(["skip_fix"])).toBe("checking");
    expect(stageFromNext(["fix"])).toBe("fixing");
    expect(stageFromNext(["revalidate"])).toBe("rechecking");
    expect(stageFromNext(["publish"])).toBe("publishing");
    expect(stageFromNext(["report"])).toBe("publishing");
    expect(stageFromNext([])).toBe("done");
  });

  it("says nothing about steps it doesn't know, or a next that isn't a list", () => {
    expect(stageFromNext(["__start__"])).toBeUndefined();
    expect(stageFromNext(["something_new"])).toBeUndefined();
    expect(stageFromNext(["something_new", "validate"])).toBe("checking");
    expect(stageFromNext([42])).toBeUndefined();
    expect(stageFromNext(undefined)).toBeUndefined();
    expect(stageFromNext(null)).toBeUndefined();
    expect(stageFromNext("validate")).toBeUndefined();
  });

  it("prefers the metadata's stage when the graph wrote one, else the checkpoint's, else queued", () => {
    expect(progressStage("fixing", "checking")).toBe("fixing");
    expect(progressStage("reading", undefined)).toBe("reading");
    expect(progressStage("queued", "checking")).toBe("checking");
    expect(progressStage(undefined, "rechecking")).toBe("rechecking");
    expect(progressStage("", "publishing")).toBe("publishing");
    expect(progressStage("queued", undefined)).toBe("queued");
    expect(progressStage(undefined, undefined)).toBe("queued");
    expect(hasGraphStage(thread("busy", { ingest_stage: "checking" }))).toBe(
      true,
    );
    expect(hasGraphStage(thread("busy", queuedMeta))).toBe(false);
    expect(hasGraphStage(thread("busy", { ingest_stage: undefined }))).toBe(
      false,
    );
    expect(hasGraphStage(null)).toBe(false);
  });

  it("reads the stage, the checkpoint time and the topic line, never the record", () => {
    const topic = {
      topic_name: "Photosynthesis (Grade 8)",
      cts: [
        { variations: [{}, {}] },
        { variations: [{}] },
        { variations: [{}, {}, {}] },
      ],
    };
    const progress = checkpointProgress({
      next: ["fix"],
      created_at: iso(T0 + MIN),
      values: { topic, record: finished({ status: "valid" }) },
    });
    expect(progress).toEqual({
      stage: "fixing",
      at: iso(T0 + MIN),
      topic: {
        name: "Photosynthesis (Grade 8)",
        questionSets: 3,
        questions: 6,
      },
    });
    // Before the graph has read the file: no topic line; an unnamed topic gives only counts.
    expect(
      checkpointProgress({
        next: ["load"],
        created_at: iso(T0),
        values: { topic: null },
      }),
    ).toEqual({ stage: "reading", at: iso(T0) });
    expect(
      checkpointProgress({
        next: ["validate"],
        created_at: iso(T0),
        values: { topic: { cts: [{ variations: [{}] }] } },
      })?.topic,
    ).toEqual({ questionSets: 1, questions: 1 });
    // A step it can't name: the time only.
    expect(
      checkpointProgress({ next: ["__start__"], created_at: iso(T0) }),
    ).toEqual({ at: iso(T0) });
  });

  it("ignores a thread with no checkpoint yet, and the last run's checkpoint", () => {
    // A new thread: getState answers an empty state (next [] would otherwise read as done).
    expect(
      checkpointProgress({ next: [], created_at: null, values: {} }),
    ).toBeNull();
    expect(checkpointProgress({ next: [], values: {} })).toBeNull();
    expect(
      checkpointProgress({ next: [], created_at: "not a date" }),
    ).toBeNull();
    expect(checkpointProgress(null)).toBeNull();
    // Run again, before the new run starts: the state is still the last run's.
    const lastRun = { next: [], created_at: iso(T0), values: {} };
    expect(
      checkpointProgress(lastRun, { runCreatedAt: iso(T0 + MIN) }),
    ).toBeNull();
    expect(
      checkpointProgress(
        { next: ["validate"], created_at: iso(T0) },
        { runCreatedAt: iso(T0 + MIN) },
      ),
    ).toBeNull();
    // This run's checkpoints (at or after the run was created) count.
    expect(
      checkpointProgress(
        { next: ["reset"], created_at: iso(T0 + MIN) },
        { runCreatedAt: iso(T0 + MIN) },
      ),
    ).toEqual({ stage: "reading", at: iso(T0 + MIN) });
    // Without the run's time (opened from history), any checkpoint counts.
    expect(checkpointProgress(lastRun, { runCreatedAt: undefined })).toEqual({
      stage: "done",
      at: iso(T0),
    });
  });

  it("keeps the last stage and topic line when a later reading lacks them", () => {
    const first = {
      stage: "checking" as const,
      at: iso(T0),
      topic: { name: "Photosynthesis (Grade 8)", questionSets: 2 },
    };
    expect(mergeCheckpointProgress(null, first)).toEqual(first);
    expect(mergeCheckpointProgress(first, null)).toEqual(first);
    expect(mergeCheckpointProgress(null, null)).toBeNull();
    expect(mergeCheckpointProgress(first, { at: iso(T0 + MIN) })).toEqual({
      ...first,
      at: iso(T0 + MIN),
    });
    expect(
      mergeCheckpointProgress(first, {
        stage: "fixing",
        at: iso(T0 + MIN),
        topic: { name: "Renamed" },
      }),
    ).toEqual({
      stage: "fixing",
      at: iso(T0 + MIN),
      topic: { name: "Renamed" },
    });
  });
});

describe("threadToView: running", () => {
  it("is running right after the UI created the run, while it is pending and the thread not yet busy", () => {
    const view = threadToView({
      thread: thread("idle", queuedMeta),
      latestRunStatus: "pending",
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
    // Not asked yet: still running, never "didn't start".
    expect(threadToView({ thread: thread("idle", queuedMeta) }).phase).toBe(
      "running",
    );
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

  it("is queued until a stage is known, from the metadata or the checkpoint", () => {
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
        thread: thread("busy", queuedMeta),
        checkpoint: { at: iso(T0) },
        now: T0 + MIN,
      }).progress,
    ).toEqual({ stage: "queued", queued: true, fixSeen: false });
    // A stage means the run has started, whatever ingest_status still says.
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: "reading",
          ingest_status: "queued",
        }),
        now: T0 + MIN,
      }).progress,
    ).toEqual({ stage: "reading", queued: false, fixSeen: false });
  });

  it("takes the stage and topic line from the checkpoint while the metadata stays queued", () => {
    const view = threadToView({
      thread: thread("busy", queuedMeta),
      checkpoint: {
        stage: "fixing",
        at: iso(T0 + MIN),
        topic: {
          name: "Photosynthesis (Grade 8)",
          questionSets: 2,
          questions: 3,
        },
      },
      now: T0 + 2 * MIN,
    });
    expect(view).toMatchObject({
      phase: "running",
      busy: true,
      topic: {
        name: "Photosynthesis (Grade 8)",
        fileName: "photosynthesis_grade_8.json",
        questionSets: 2,
        questions: 3,
      },
      progress: { stage: "fixing", queued: false, fixSeen: true },
    });
    // The metadata wins when the graph's writes reach it.
    expect(
      threadToView({
        thread: thread("busy", {
          ingest_stage: "rechecking",
          ingest_status: "processing",
          topic_name: "From the metadata",
        }),
        checkpoint: {
          stage: "fixing",
          at: iso(T0 + MIN),
          topic: { name: "From the checkpoint" },
        },
        now: T0 + 2 * MIN,
      }),
    ).toMatchObject({
      topic: { name: "From the metadata" },
      progress: { stage: "rechecking" },
    });
  });

  it("never shows a record while the run goes (it is the last run's)", () => {
    const view = threadToView({
      thread: thread("busy", queuedMeta),
      values: { record: finished({ status: "valid" }), source_url: SOURCE },
      checkpoint: { stage: "reading", at: iso(T0) },
      now: T0 + MIN,
    });
    expect(view.phase).toBe("running");
    expect(view.result).toBeUndefined();
    // Its topic line doesn't leak in either.
    expect(view.topic.name).toBe("photosynthesis_grade_8.json");
    expect(view.topic.questions).toBeUndefined();
    const pending = threadToView({
      thread: thread("idle", queuedMeta),
      values: { record: finished({ status: "valid" }) },
      latestRunStatus: "running",
    });
    expect(pending.phase).toBe("running");
    expect(pending.result).toBeUndefined();
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

  it("counts the checkpoint's time as progress (the run's metadata may never change)", () => {
    expect(lastProgressAt(busy)).toBe(T0);
    expect(lastProgressAt(busy, iso(T0 + 20 * MIN))).toBe(T0 + 20 * MIN);
    expect(lastProgressAt(busy, iso(T0 - 20 * MIN))).toBe(T0);
    expect(lastProgressAt({ updated_at: undefined }, iso(T0))).toBe(T0);
    expect(lastProgressAt({ updated_at: undefined })).toBeUndefined();
    expect(isThreadStalled(busy, T0 + 31 * MIN, iso(T0 + 20 * MIN))).toBe(
      false,
    );
    expect(isThreadStalled(busy, T0 + 51 * MIN, iso(T0 + 20 * MIN))).toBe(true);
    expect(
      threadToView({
        thread: busy,
        checkpoint: { stage: "fixing", at: iso(T0 + 20 * MIN) },
        now: T0 + 31 * MIN,
      }).phase,
    ).toBe("running");
    expect(
      threadToView({
        thread: busy,
        checkpoint: { stage: "fixing", at: iso(T0 + 20 * MIN) },
        now: T0 + 51 * MIN,
      }).phase,
    ).toBe("stalled");
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
        "Fixed:\n- CT 2, variant 1 `set-key:leaves_ct_002`: tidied the maths",
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
        label: "CT 2, variant 1",
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
      latestRunStatus: "success",
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
        now: T0 + 1_000,
      }).result?.status,
    ).toBe(RUN_ERROR);
  });

  it("run_error when the latest run ended without leaving a record", () => {
    for (const latestRunStatus of [
      "success",
      "error",
      "timeout",
      "interrupted",
    ]) {
      const view = threadToView({
        thread: thread("idle", queuedMeta),
        values: { record: null },
        latestRunStatus,
      });
      expect(view.phase).toBe("done");
      expect(view.result?.status).toBe(RUN_ERROR);
    }
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

  it("failed_to_start when an idle thread has no run, no record and no final status", () => {
    const view = threadToView({
      thread: thread("idle", queuedMeta),
      latestRunStatus: null,
    });
    expect(view.phase).toBe("done");
    expect(view.result).toEqual({
      status: FAILED_TO_START,
      message: "",
      issues: [],
      warnings: [],
      technical: { findings: [], threadId: "thread-1" },
    });
    // Something in values that isn't a record is ignored.
    expect(
      threadToView({
        thread: thread("idle", queuedMeta),
        values: { record: "oops" } as never,
        latestRunStatus: null,
      }).result?.status,
    ).toBe(FAILED_TO_START);
  });

  it("reads the record once the latest run has ended, with the metadata still queued", () => {
    const view = threadToView({
      thread: thread("idle", queuedMeta),
      values: { record: finished({ status: "valid" }) },
      latestRunStatus: "success",
      checkpoint: { stage: "publishing", at: iso(T0) },
    });
    expect(view).toMatchObject({
      phase: "done",
      topic: {
        name: "Photosynthesis (Grade 8)",
        questionSets: 2,
        questions: 3,
      },
      result: { status: "valid" },
    });
    expect(view.progress).toBeUndefined();
    // invalid_input: no topic in the record, so the file name stays.
    expect(
      threadToView({
        thread: thread("idle", queuedMeta),
        values: {
          record: { status: "invalid_input", message: "Could not read" },
        },
        latestRunStatus: "success",
      }),
    ).toMatchObject({
      topic: { name: "photosynthesis_grade_8.json" },
      result: { status: "invalid_input" },
    });
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
  it("says when the daily credit limit held the fixer back, and only with a known reason", () => {
    const skipped = (fix_skipped?: string | null) =>
      buildResult(
        finished({ status: "needs_author_fixes", result: { fix_skipped } }),
        { threadId: "t" },
      ).fixSkipped;
    expect(skipped("daily_limit")).toBe("daily_limit");
    expect(skipped("credits_unavailable")).toBe("credits_unavailable");
    expect(skipped(undefined)).toBeUndefined();
    expect(skipped(null)).toBeUndefined();
    expect(skipped("something_else")).toBeUndefined();
    expect(
      "fixSkipped" in
        buildResult(finished({ status: "fixed" }), { threadId: "t" }),
    ).toBe(false);
  });

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
