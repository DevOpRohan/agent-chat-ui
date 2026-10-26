/**
 * Ingester mode, end to end, against a fake LangGraph backend (tests/helpers/ingest-backend.ts).
 *
 * Run it against a local dev server whose LangGraph URL is the fake's origin:
 *
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:2299 \
 *   NEXT_PUBLIC_ASSISTANT_ID=o3_question_crafter_agent \
 *   pnpm dev --port 3210
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3210 npx playwright test tests/ingester-mode.spec.ts
 *
 * Nothing leaves the browser: every LangGraph call, /api/ingest/upload and /api/topic-file are
 * answered by the fake, and any other origin is blocked.
 *
 * The fake behaves like the dev deployment by default: the graph's metadata writes don't land, so
 * every scenario reads progress from the checkpoint (`getState().next`) and the end of a run from
 * the thread status and `runs.list`. "when the runtime keeps the graph's metadata writes" runs
 * with `metadataWrites: true`.
 */
import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import type { IngestRecord } from "../src/lib/ingest/ingest-types";
import {
  buildRecord,
  CRAFTER_GRAPH_ID,
  FINAL_STATUSES,
  FIX_STAGES,
  FIXTURE_TOPIC,
  INGEST_GRAPH_ID,
  isLocalBaseUrl,
  PLAIN_STAGES,
  TOPIC_FIXTURE,
  brokenJsonUpload,
  markdownUpload,
  notATopicUpload,
  oversizedUpload,
  readFixture,
  topicUpload,
  type FakeThread,
  type IngestBackend,
} from "./helpers/ingest-backend";
import {
  ACTIONS,
  COPY,
  FILE_MESSAGES,
  PRIMARY_ACTION,
  STATUS_TITLES,
  STEP_LABELS,
  action,
  applyTheme,
  chooseFile,
  expect,
  expectUrlParam,
  fitsWidth,
  historyHeading,
  historyNewButton,
  historyPanel,
  historyRow,
  historyRows,
  openApp,
  screenshot,
  step,
  test,
  ui,
  urlParam,
  waitForHydration,
} from "./helpers/ingest-ui";

test.skip(
  ({ baseURL }) => !isLocalBaseUrl(baseURL),
  "Mocked-backend spec: run it against a local dev server (PLAYWRIGHT_BASE_URL=http://localhost:3210) " +
    "started with NEXT_PUBLIC_API_URL=http://127.0.0.1:2299.",
);
test.describe.configure({ mode: "parallel" });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

function recordOf(thread: FakeThread): IngestRecord {
  return thread.values?.record as IngestRecord;
}

async function historyIds(page: Page): Promise<string[]> {
  return historyRows(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-thread-id") ?? ""),
  );
}

/** Links to the updated topic files (only for `fixed` with a matching .md). */
function topicFileLinks(page: Page) {
  return page.getByRole("link", { name: /^Download the \.(md|json)$/ });
}

function openIngest(page: Page, thread: FakeThread) {
  return openApp(page, { mode: "ingester", ingestId: thread.thread_id });
}

// ---------------------------------------------------------------- mode switch and URL

test.describe("mode switch and URL", () => {
  test("no mode opens Crafter; Ingester is kept in the URL across a reload", async ({
    page,
  }) => {
    const $ = ui(page);
    await openApp(page);
    await expect($.modeSwitchById).toBeVisible();
    await expect($.crafter).toHaveAttribute("aria-checked", "true");
    await expect($.ingester).toHaveAttribute("aria-checked", "false");
    await expect($.composer).toBeVisible();
    await expect($.pane).toBeHidden();
    expect(urlParam(page, "mode")).toBeNull();

    await $.ingester.click();
    await expectUrlParam(page, "mode", "ingester");
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect($.crafter).toHaveAttribute("aria-checked", "false");
    await expect($.upload).toBeVisible();
    await expect($.composer).toBeHidden();

    await page.reload();
    await expect($.ingester).toHaveAttribute("aria-checked", "true", {
      timeout: 60_000,
    });
    await expect($.upload).toBeVisible();
    await expect($.composer).toBeHidden();

    await $.crafter.click();
    await expect($.crafter).toHaveAttribute("aria-checked", "true");
    await expect($.composer).toBeVisible();
    await expect($.pane).toBeHidden();
    await expect.poll(() => urlParam(page, "mode")).not.toBe("ingester");
  });

  test("?mode=ingester opens Ingester with the upload, and no composer", async ({
    page,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect($.pane).toBeVisible();
    await expect($.upload).toBeVisible();
    await expect($.dropZone).toBeVisible();
    await expect($.composer).toBeHidden();
  });

  test("a link with only ingestId opens Ingester on that ingest", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({ state: "valid" });
    await openApp(page, { ingestId: ingest.thread_id });
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect($.result).toHaveAttribute("data-status", "valid");
    await expect($.composer).toBeHidden();
  });

  test("switching keeps both threadId and ingestId, and each mode shows its own item", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const chat = backend.seedCrafterThread({
      title: "Fractions lesson",
      messages: [
        { type: "human", content: "Make a fractions lesson for grade 5." },
        { type: "ai", content: "Here is a fractions lesson plan." },
      ],
    });
    const ingest = backend.seedIngestThread({
      state: "needs_author_fixes",
      fileName: "geometry_biology_checkin.json",
    });
    await openApp(page, {
      mode: "ingester",
      threadId: chat.thread_id,
      ingestId: ingest.thread_id,
    });
    await expect($.result).toHaveAttribute("data-status", "needs_author_fixes");

    await $.crafter.click();
    await expect(
      page.getByText("Here is a fractions lesson plan."),
    ).toBeVisible();
    await expect($.result).toBeHidden();
    await expectUrlParam(page, "threadId", chat.thread_id);
    await expectUrlParam(page, "ingestId", ingest.thread_id);

    await $.ingester.click();
    await expect($.result).toHaveAttribute("data-status", "needs_author_fixes");
    await expect($.composer).toBeHidden();
    await expectUrlParam(page, "mode", "ingester");
    await expectUrlParam(page, "threadId", chat.thread_id);
    await expectUrlParam(page, "ingestId", ingest.thread_id);
  });

  test("the switch is a radio group that works from the keyboard", async ({
    page,
  }) => {
    const $ = ui(page);
    await openApp(page);
    await $.crafter.focus();
    await page.keyboard.press("ArrowRight");
    await expect($.ingester).toHaveAttribute("aria-checked", "true");
    await expect($.ingester).toBeFocused();
    await expectUrlParam(page, "mode", "ingester");
    await page.keyboard.press("ArrowLeft");
    await expect($.crafter).toHaveAttribute("aria-checked", "true");
    await expect($.composer).toBeVisible();
  });
});

// ---------------------------------------------------------------- history

test.describe("history, one list per mode", () => {
  test.use({ viewport: DESKTOP });

  test("Crafter lists only chats and Ingester only ingests, newest first, under History", async ({
    page,
    backend,
  }) => {
    const olderChat = backend.seedCrafterThread({
      title: "Fractions lesson",
      updatedMinutesAgo: 30,
    });
    const newerChat = backend.seedCrafterThread({
      title: "Algebra revision plan",
      updatedMinutesAgo: 10,
    });
    const olderIngest = backend.seedIngestThread({
      state: "valid",
      fileName: "photosynthesis_grade_8.json",
      updatedMinutesAgo: 20,
    });
    const newerIngest = backend.seedIngestThread({
      state: "needs_author_fixes",
      fileName: "geometry_biology_checkin.json",
      updatedMinutesAgo: 5,
    });
    // A stateless topic_import leftover: in neither list.
    backend.seedOtherGraphThread("topic_import", "topic_import leftover");

    await openApp(page, { chatHistoryOpen: "true" });
    await expect(historyHeading(page)).toBeVisible();
    await expect(page.getByText("Chat History")).toHaveCount(0);
    await expect
      .poll(() => historyIds(page))
      .toEqual([newerChat.thread_id, olderChat.thread_id]);
    await expect(historyRow(page, newerChat.thread_id)).toContainText(
      "Algebra revision plan",
    );
    expect(
      backend.calls.searches.some(
        (search) => search.metadata?.graph_id === CRAFTER_GRAPH_ID,
      ),
    ).toBe(true);

    await ui(page).ingester.click();
    await expect
      .poll(() => historyIds(page))
      .toEqual([newerIngest.thread_id, olderIngest.thread_id]);
    await expect(historyHeading(page)).toBeVisible();
    await expect(historyRow(page, newerIngest.thread_id)).toContainText(
      "geometry_biology_checkin.json",
    );
    await expect(historyPanel(page)).not.toContainText("topic_import leftover");
    expect(
      backend.calls.searches.some(
        (search) =>
          search.metadata?.graph_id === INGEST_GRAPH_ID && !search.ids,
      ),
    ).toBe(true);

    await ui(page).crafter.click();
    await expect
      .poll(() => historyIds(page))
      .toEqual([newerChat.thread_id, olderChat.thread_id]);
    await expect(historyHeading(page)).toBeVisible();
  });

  test("each mode keeps its own selected item", async ({ page, backend }) => {
    const $ = ui(page);
    const chat = backend.seedCrafterThread({
      title: "Fractions lesson",
      messages: [
        { type: "human", content: "Make a fractions lesson for grade 5." },
        { type: "ai", content: "Here is a fractions lesson plan." },
      ],
    });
    const ingest = backend.seedIngestThread({
      state: "valid",
      fileName: "photosynthesis_grade_8.json",
    });

    await openApp(page, { chatHistoryOpen: "true" });
    await historyRow(page, chat.thread_id).click();
    await expectUrlParam(page, "threadId", chat.thread_id);
    await expect(
      page.getByText("Here is a fractions lesson plan."),
    ).toBeVisible();
    await expect(historyRow(page, chat.thread_id)).toHaveAttribute(
      "data-thread-active",
      "true",
    );

    await $.ingester.click();
    await expect(historyRow(page, ingest.thread_id)).toHaveAttribute(
      "data-thread-active",
      "false",
    );
    await historyRow(page, ingest.thread_id).click();
    await expectUrlParam(page, "ingestId", ingest.thread_id);
    await expect($.result).toHaveAttribute("data-status", "valid");
    await expect(historyRow(page, ingest.thread_id)).toHaveAttribute(
      "data-thread-active",
      "true",
    );
    await expectUrlParam(page, "threadId", chat.thread_id);

    await $.crafter.click();
    await expect(historyRow(page, chat.thread_id)).toHaveAttribute(
      "data-thread-active",
      "true",
    );
    await expect(
      page.getByText("Here is a fractions lesson plan."),
    ).toBeVisible();

    await $.ingester.click();
    await expect(historyRow(page, ingest.thread_id)).toHaveAttribute(
      "data-thread-active",
      "true",
    );
    await expect($.result).toHaveAttribute("data-status", "valid");
  });

  test("New in Ingester clears ingestId and shows the upload; threadId stays", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const chat = backend.seedCrafterThread({ title: "Fractions lesson" });
    const ingest = backend.seedIngestThread({ state: "valid" });
    await openApp(page, {
      mode: "ingester",
      ingestId: ingest.thread_id,
      threadId: chat.thread_id,
      chatHistoryOpen: "true",
    });
    await expect($.result).toHaveAttribute("data-status", "valid");

    await historyNewButton(page).click();
    await expectUrlParam(page, "ingestId", null);
    await expect($.upload).toBeVisible();
    await expect($.result).toBeHidden();
    await expectUrlParam(page, "mode", "ingester");
    await expectUrlParam(page, "threadId", chat.thread_id);
  });

  test("the chat's open thread never shows in Ingester's list", async ({
    page,
    backend,
  }) => {
    const chat = backend.seedCrafterThread({ title: "Fractions lesson" });
    const ingest = backend.seedIngestThread({ state: "valid" });
    await openApp(page, {
      mode: "ingester",
      threadId: chat.thread_id,
      chatHistoryOpen: "true",
    });
    await expect.poll(() => historyIds(page)).toEqual([ingest.thread_id]);
    // Give the chat runtime time to hydrate its thread (it upserts into the shared list).
    await page.waitForTimeout(3_000);
    expect(await historyIds(page)).toEqual([ingest.thread_id]);
  });
});

// ---------------------------------------------------------------- the upload view

test.describe("the upload view checks the file first", () => {
  async function expectNothingSent(backend: IngestBackend) {
    expect(backend.calls.uploads).toEqual([]);
    expect(backend.calls.threadCreates).toEqual([]);
    expect(backend.ingestRunCreates()).toEqual([]);
    expect(
      backend.requests.filter((line) => line.includes("/api/ingest/upload")),
    ).toEqual([]);
  }

  test("a .md file is refused with the plain message, and nothing is uploaded", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, markdownUpload());
    await expect($.fileProblem).toContainText(FILE_MESSAGES.notJson);
    await expect($.enabledIngestButton).toHaveCount(0);
    await expectNothingSent(backend);
  });

  test("a .json over 10 MB is refused, and nothing is uploaded", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, oversizedUpload());
    await expect($.fileProblem).toContainText(FILE_MESSAGES.tooLarge);
    await expect($.enabledIngestButton).toHaveCount(0);
    await expectNothingSent(backend);
  });

  test("broken JSON names the line and column", async ({ page, backend }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, brokenJsonUpload());
    await expect($.fileProblem).toContainText("on line 3, column 3");
    await expect($.enabledIngestButton).toHaveCount(0);
    await expectNothingSent(backend);
  });

  test("a JSON file that isn't a topic is refused", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, notATopicUpload());
    await expect($.fileProblem).toContainText(FILE_MESSAGES.notTopic);
    await expectNothingSent(backend);
  });

  test("a topic shows its summary, with the daily budget beside Ingest topic", async ({
    page,
  }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, topicUpload());
    await expect($.fileSummary).toContainText(FIXTURE_TOPIC.name);
    await expect($.fileSummary).toContainText(TOPIC_FIXTURE);
    await expect($.fileSummary).toContainText(
      `${FIXTURE_TOPIC.questionSets} question sets`,
    );
    await expect($.fileSummary).toContainText(
      `${FIXTURE_TOPIC.questions} questions`,
    );
    await expect($.enabledIngestButton).toBeVisible();

    const budget = $.pane.getByTestId("daily-budget");
    await expect(budget).toBeVisible();
    await expect(budget).toHaveAttribute(
      "aria-label",
      /^Daily budget: \$3\.75 left of \$5/,
    );
    const [buttonBox, budgetBox] = await Promise.all([
      $.ingestButton.boundingBox(),
      budget.boundingBox(),
    ]);
    const centre = (box: NonNullable<typeof buttonBox>) =>
      box.y + box.height / 2;
    expect(Math.abs(centre(buttonBox!) - centre(budgetBox!))).toBeLessThan(32);

    // Another file replaces it.
    await chooseFile(page, notATopicUpload());
    await expect($.fileProblem).toContainText(FILE_MESSAGES.notTopic);
    await expect($.enabledIngestButton).toHaveCount(0);
  });

  test("drag and drop picks the file too", async ({ page }) => {
    const $ = ui(page);
    await openApp(page, { mode: "ingester" });
    await waitForHydration($.dropZone);
    const base64 = readFixture(TOPIC_FIXTURE).toString("base64");
    const dataTransfer = await page.evaluateHandle(
      ({ b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], name, { type: "application/json" }),
        );
        return transfer;
      },
      { b64: base64, name: TOPIC_FIXTURE },
    );
    await $.dropZone.dispatchEvent("dragenter", { dataTransfer });
    await $.dropZone.dispatchEvent("dragover", { dataTransfer });
    await $.dropZone.dispatchEvent("drop", { dataTransfer });
    await expect($.fileSummary).toContainText(FIXTURE_TOPIC.name);
  });

  test("the TopicCrafter skill is offered as a versioned zip", async ({
    page,
  }) => {
    await openApp(page, { mode: "ingester" });
    await expect(
      ui(page).pane.getByRole("link", {
        name: /Download the TopicCrafter skill/,
      }),
    ).toHaveAttribute("href", /\/skill\/TopicCrafter-v0\.1\.0\.zip$/);
  });
});

// ---------------------------------------------------------------- one ingest, start to finish

test.describe("one ingest, start to finish", () => {
  test.use({ viewport: DESKTOP });

  test("upload, thread, run, every step, then the result and the history row", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({
      stages: FIX_STAGES,
      stageMs: "manual",
      record: ({ threadId, input }) =>
        buildRecord("fixed", { threadId, fileName: input.file_name }),
    });
    await openApp(page, { mode: "ingester", chatHistoryOpen: "true" });
    await chooseFile(page, topicUpload());
    await expect($.fileSummary).toContainText(FIXTURE_TOPIC.name);
    await $.ingestButton.click();

    // The .json goes to the ingest upload route, and only there.
    await expect.poll(() => backend.calls.uploads.length).toBe(1);
    const upload = backend.calls.uploads[0]!;
    expect(upload.fileName).toBe(TOPIC_FIXTURE);
    expect(upload.size).toBe(readFixture(TOPIC_FIXTURE).length);
    expect(upload.url).toMatch(
      /^https:\/\/storage\.googleapis\.com\/test-bucket\/topic-ingest\/.+\.json$/,
    );

    // One thread, with the ingest's metadata.
    await expect.poll(() => backend.calls.threadCreates.length).toBe(1);
    const created = backend.calls.threadCreates[0]!;
    expect(created.body.metadata).toMatchObject({
      graph_id: "topic_ingest",
      thread_title: TOPIC_FIXTURE,
      ingest_file_name: TOPIC_FIXTURE,
      ingest_source_url: upload.url,
      ingest_stage: "queued",
      ingest_status: "queued",
    });
    const threadId = created.threadId;

    // One run on it, on topic_ingest, with the uploaded link.
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const run = backend.ingestRunCreates()[0]!;
    expect(run.threadId).toBe(threadId);
    expect(run.body.input).toEqual({
      source_url: upload.url,
      file_name: TOPIC_FIXTURE,
    });
    await expectUrlParam(page, "ingestId", threadId);
    await expectUrlParam(page, "mode", "ingester");

    // Progress, one stage at a time.
    await expect($.progress).toBeVisible();
    await expect(step(page, STEP_LABELS.read)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    expect(backend.advance(threadId)).toBe("checking");
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(step(page, STEP_LABELS.read)).toHaveAttribute(
      "data-step-state",
      "done",
    );
    await expect(step(page, STEP_LABELS.fix)).toHaveCount(0);
    // The graph has read the topic: its name replaces the file name.
    await expect($.pane).toContainText(FIXTURE_TOPIC.name);

    expect(backend.advance(threadId)).toBe("fixing");
    await expect(step(page, STEP_LABELS.fix)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(step(page, STEP_LABELS.recheck)).toHaveAttribute(
      "data-step-state",
      "pending",
    );
    expect(backend.advance(threadId)).toBe("rechecking");
    await expect(step(page, STEP_LABELS.recheck)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(step(page, STEP_LABELS.fix)).toHaveAttribute(
      "data-step-state",
      "done",
    );
    expect(backend.advance(threadId)).toBe("publishing");
    await expect(step(page, STEP_LABELS.finish)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(ui(page).steps).toHaveCount(5);
    expect(backend.advance(threadId)).toBe("done");

    // The result, read once from the thread state.
    await expect($.result).toHaveAttribute("data-status", "fixed");
    await expect($.result).toContainText(STATUS_TITLES.fixed);
    await expect($.progress).toBeHidden();
    const record = recordOf(backend.thread(threadId));
    const preview = $.result.getByRole("link", {
      name: ACTIONS.openPreview,
      exact: true,
    });
    await expect(preview).toHaveAttribute("href", record.result!.preview_link!);
    await expect(preview).toHaveAttribute("target", "_blank");
    expect(backend.calls.stateReads).toContain(threadId);

    // It is in Ingester's history.
    await expect(historyRow(page, threadId)).toContainText(TOPIC_FIXTURE, {
      timeout: 30_000,
    });

    // All of it without the graph's metadata writes: they never landed, as on dev.
    expect(backend.thread(threadId).metadata).toMatchObject({
      ingest_stage: "queued",
      ingest_status: "queued",
    });
    expect(backend.calls.runLists).toContain(threadId);

    // The topic never went near the chat's upload route or OpenAI.
    expect(backend.calls.chatUploads).toEqual([]);
    expect(backend.openAiRequests()).toEqual([]);
    expect(backend.calls.blocked).toEqual([]);
  });

  test("a topic with nothing to fix never shows the fix steps", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({ stages: PLAIN_STAGES, stageMs: "manual" });
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, topicUpload());
    await $.ingestButton.click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const threadId = backend.ingestRunCreates()[0]!.threadId;

    expect(backend.advance(threadId)).toBe("checking");
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect($.steps).toHaveCount(3);
    await expect(step(page, STEP_LABELS.finish)).toHaveAttribute(
      "data-step-state",
      "pending",
    );
    expect(backend.advance(threadId)).toBe("publishing");
    await expect(step(page, STEP_LABELS.finish)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(step(page, STEP_LABELS.fix)).toHaveCount(0);
    backend.finish(threadId);

    await expect($.result).toHaveAttribute("data-status", "valid");
    await expect(page.getByText(STEP_LABELS.fix)).toHaveCount(0);
    await expect(topicFileLinks(page)).toHaveCount(0);
  });

  test("the daily limit (429) keeps the upload and shows the chat's notice", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({
      reject: {
        status: 429,
        headers: { "x-user-limit-code": "DAILY_COST_LIMIT_EXCEEDED" },
        json: { detail: "DAILY_COST_LIMIT_EXCEEDED" },
      },
    });
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, topicUpload());
    await $.ingestButton.click();

    await expect(
      page.getByText(COPY.dailyLimitTitle, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(COPY.dailyLimitBody).first()).toBeVisible();
    await expect($.upload).toBeVisible();
    expect(urlParam(page, "ingestId")).toBeNull();
    // A budget rejection is not retried.
    expect(backend.ingestRunCreates()).toHaveLength(1);
  });

  test("a run that can't start lands on the thread as failed_to_start; Run again starts it", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({
      reject: {
        status: 400,
        json: { detail: "Assistant 'topic_ingest' not found" },
      },
    });
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, topicUpload());
    await $.ingestButton.click();

    await expect.poll(() => backend.calls.threadCreates.length).toBe(1);
    const threadId = backend.calls.threadCreates[0]!.threadId;
    await expectUrlParam(page, "ingestId", threadId);
    await expect($.result).toHaveAttribute("data-status", "failed_to_start");
    await expect($.result).toContainText(STATUS_TITLES.failed_to_start);

    // The default script: a valid topic, a few hundred ms per stage.
    await action($.result, PRIMARY_ACTION.failed_to_start).click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(2);
    const retry = backend.ingestRunCreates()[1]!;
    expect(retry.threadId).toBe(threadId);
    expect(retry.body.input?.source_url).toBe(backend.calls.uploads[0]!.url);
    await expect($.result).toHaveAttribute("data-status", "valid", {
      timeout: 30_000,
    });
    expect(backend.calls.uploads).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- one result per final status

test.describe("one result per final status", () => {
  const details: Record<
    (typeof FINAL_STATUSES)[number],
    (page: Page, thread: FakeThread) => Promise<void>
  > = {
    async valid(page, thread) {
      const $ = ui(page);
      const preview = $.result.getByRole("link", {
        name: ACTIONS.openPreview,
        exact: true,
      });
      await expect(preview).toHaveAttribute(
        "href",
        recordOf(thread).result!.preview_link!,
      );
      await expect(preview).toHaveAttribute("target", "_blank");
      await expect(topicFileLinks(page)).toHaveCount(0);
      await expect(action(page, ACTIONS.downloadReport)).toHaveCount(0);
      await expect(action(page, ACTIONS.runAgain)).toHaveCount(0);
    },
    async fixed(page) {
      const $ = ui(page);
      await expect(
        $.result.getByRole("link", { name: ACTIONS.openPreview, exact: true }),
      ).toHaveAttribute("target", "_blank");
      await expect(
        page.getByRole("link", { name: ACTIONS.downloadMd, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: ACTIONS.downloadJson, exact: true }),
      ).toBeVisible();
    },
    async needs_author_fixes(page) {
      const $ = ui(page);
      await expect(action($.result, ACTIONS.uploadNew)).toBeVisible();
      await expect($.pane).toContainText(COPY.reportInstructions);
      await expect($.pane).toContainText("Set 1, variant 1");
      await expect($.pane).toContainText(COPY.hintIssue);
      await expect(topicFileLinks(page)).toHaveCount(0);
    },
    async validation_incomplete(page) {
      const $ = ui(page);
      await expect($.result).toContainText(COPY.validationIncompleteBody);
      await expect(action(page, ACTIONS.downloadReport)).toHaveCount(0);
      await expect(action($.result, ACTIONS.runAgain)).toBeEnabled();
    },
    async updater_failed(page) {
      const $ = ui(page);
      await expect($.result).toContainText(COPY.updaterFailedNote);
      await expect($.pane).toContainText(COPY.hintIssue);
      // The raw warning stays under Technical details.
      await expect(page.getByText(/RuntimeError/)).toBeHidden();
    },
    async invalid_input(page) {
      const $ = ui(page);
      await expect($.result).toContainText(COPY.invalidInputBody);
      // The backend's raw wording stays folded away under Technical details.
      await expect(
        $.result.getByText("Could not read the topic:", { exact: false }),
      ).toBeHidden();
      await action($.result, ACTIONS.uploadDifferent).click();
      await expectUrlParam(page, "ingestId", null);
      await expect($.upload).toBeVisible();
      await expectUrlParam(page, "mode", "ingester");
    },
  };

  for (const status of FINAL_STATUSES) {
    test(`${status}: its title and its primary action`, async ({
      page,
      backend,
    }) => {
      const $ = ui(page);
      const ingest = backend.seedIngestThread({
        state: status,
        fileName: `${status}_topic.json`,
      });
      await openIngest(page, ingest);
      await expect($.result).toHaveAttribute("data-status", status);
      await expect($.result).toContainText(STATUS_TITLES[status]);
      const primary = action($.result, PRIMARY_ACTION[status]);
      await expect(primary).toBeVisible();
      await expect(primary).toBeEnabled();
      await details[status](page, ingest);
    });
  }

  test("an ended ingest is read once, then no longer polled", async ({
    page,
    backend,
  }) => {
    const ingest = backend.seedIngestThread({ state: "valid" });
    await openIngest(page, ingest);
    await expect(ui(page).result).toHaveAttribute("data-status", "valid");
    const polls = () =>
      backend.calls.searches.filter((search) =>
        search.ids?.includes(ingest.thread_id),
      ).length;
    const reads = () =>
      backend.calls.stateReads.filter((id) => id === ingest.thread_id).length;
    const before = { polls: polls(), reads: reads() };
    expect(before.reads).toBe(1);
    // The poll asks for the upload time too ("Uploaded <date>" on every visit).
    expect(
      backend.calls.searches.find((search) =>
        search.ids?.includes(ingest.thread_id),
      )?.select,
    ).toContain("created_at");
    await expect(page.getByTestId("ingest-topic-header")).toContainText(
      "Uploaded ",
    );
    // Longer than the 1.5 s busy cadence.
    await page.waitForTimeout(3_500);
    expect({ polls: polls(), reads: reads() }).toEqual(before);
  });
});

// ---------------------------------------------------------------- stalled and crashed runs

test.describe("stalled and crashed runs", () => {
  test("stalled: busy with no progress for 30 minutes says so; Run again waits", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "stalled",
      stage: "fixing",
      updatedMinutesAgo: 31,
    });
    await openIngest(page, ingest);
    await expect($.result).toHaveAttribute("data-status", "stalled");
    await expect($.result).toContainText(STATUS_TITLES.stalled);
    await expect($.result).toContainText(COPY.stalledBody);
    // The thread is still busy: Run again is shown but can't be pressed.
    await expect(action($.result, ACTIONS.runAgain)).toBeDisabled();
    await expect(action($.result, ACTIONS.uploadDifferent)).toBeEnabled();
    expect(backend.ingestRunCreates()).toEqual([]);
  });

  test("a busy thread updated a minute ago is not stalled", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "running",
      stage: "checking",
    });
    await openIngest(page, ingest);
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect($.result).toBeHidden();
  });

  test("a crashed run (thread status error) shows run_error, and Run again restarts it", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "error",
      stage: "checking",
    });
    await openIngest(page, ingest);
    await expect($.result).toHaveAttribute("data-status", "run_error");
    await expect($.result).toContainText(STATUS_TITLES.run_error);

    await action($.result, PRIMARY_ACTION.run_error).click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const call = backend.ingestRunCreates()[0]!;
    expect(call.threadId).toBe(ingest.thread_id);
    expect(call.body.input?.source_url).toBe(ingest.metadata.ingest_source_url);
    await expect($.result).toHaveAttribute("data-status", "valid", {
      timeout: 30_000,
    });
  });
});

// ---------------------------------------------------------------- Run again

test.describe("Run again", () => {
  test("a new run on the same thread with the same file, and no second press while it runs", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "validation_incomplete",
      fileName: "numbers_matter_warmup.json",
    });
    const sourceUrl = ingest.metadata.ingest_source_url;
    backend.queueRun({ stages: PLAIN_STAGES, stageMs: "manual" });
    await openIngest(page, ingest);

    const runAgain = $.result.getByRole("button", {
      name: ACTIONS.runAgain,
      exact: true,
    });
    await expect(runAgain).toBeEnabled();
    await runAgain.click();

    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const call = backend.ingestRunCreates()[0]!;
    expect(call.threadId).toBe(ingest.thread_id);
    expect(call.body.input).toEqual({
      source_url: sourceUrl,
      file_name: "numbers_matter_warmup.json",
    });
    // Same thread, same uploaded file: nothing new is created or uploaded.
    expect(backend.calls.threadCreates).toEqual([]);
    expect(backend.calls.uploads).toEqual([]);
    await expectUrlParam(page, "ingestId", ingest.thread_id);

    // While it runs: the steps, and no Run again that can be pressed.
    await expect($.progress).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: ACTIONS.runAgain,
        exact: true,
        disabled: false,
      }),
    ).toHaveCount(0);
    expect(backend.ingestRunCreates()).toHaveLength(1);

    backend.finish(ingest.thread_id);
    await expect($.result).toHaveAttribute("data-status", "valid");
    await expect($.result).toContainText(STATUS_TITLES.valid);
    expect(backend.ingestRunCreates()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the fallback (no metadata writes)

/** Resolves after the pane's next poll of `threadId` (its last answer has been shown by then). */
async function nextPoll(backend: IngestBackend, threadId: string) {
  const polls = () =>
    backend.calls.searches.filter((search) => search.ids?.includes(threadId))
      .length;
  const now = polls();
  await expect.poll(polls).toBeGreaterThan(now);
}

test.describe("progress and results without the graph's metadata writes", () => {
  test.use({ viewport: DESKTOP });

  test("a short run (invalid_input in under 2 s) shows its result at once", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({
      stages: ["load"],
      stageMs: 400,
      record: ({ threadId, input }) =>
        buildRecord("invalid_input", { threadId, fileName: input.file_name }),
    });
    await openApp(page, { mode: "ingester" });
    await chooseFile(page, topicUpload());
    await $.ingestButton.click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const started = Date.now();
    const threadId = backend.ingestRunCreates()[0]!.threadId;

    // Not after a 15 s grace period: the run list says the run is over.
    await expect($.result).toHaveAttribute("data-status", "invalid_input", {
      timeout: 6_000,
    });
    expect(Date.now() - started).toBeLessThan(6_000);
    await expect($.result).toContainText(STATUS_TITLES.invalid_input);
    expect(backend.thread(threadId).metadata.ingest_status).toBe("queued");
    expect(backend.calls.runLists).toContain(threadId);
    expect(backend.runsOf(threadId)[0]!.status).toBe("success");
  });

  test("Run again: the last run's state is never shown while the new run waits or resets", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "validation_incomplete",
      fileName: "numbers_matter_warmup.json",
    });
    const id = ingest.thread_id;
    backend.queueRun({
      pendingMs: "manual",
      stages: ["reset", "load", "validate", "report"],
      stageMs: "manual",
      record: ({ threadId, input }) =>
        buildRecord("needs_author_fixes", {
          threadId,
          fileName: input.file_name,
        }),
    });
    await openIngest(page, ingest);
    await expect($.result).toHaveAttribute(
      "data-status",
      "validation_incomplete",
    );
    await action($.result, ACTIONS.runAgain).click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    expect(backend.runsOf(id)[0]!.status).toBe("pending");

    const busyReads = () =>
      backend.calls.stateReadLog.filter(
        (read) => read.threadId === id && read.busy,
      );
    // Pending: busy, but the state is still the last run's (its record, next []).
    await expect
      .poll(
        () =>
          busyReads().filter((read) => read.hadRecord && !read.next.length)
            .length,
      )
      .toBeGreaterThan(0);
    await nextPoll(backend, id);
    await expect($.progress).toBeVisible();
    await expect($.result).toBeHidden();
    await expect(step(page, STEP_LABELS.read)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    await expect(step(page, STEP_LABELS.finish)).toHaveAttribute(
      "data-step-state",
      "pending",
    );

    // reset: the run has started; the last record is still in the state until it is cleared.
    expect(backend.advance(id)).toBe("reading");
    expect(backend.checkpoint(id).next).toEqual(["reset"]);
    await expect
      .poll(
        () =>
          busyReads().filter(
            (read) => read.hadRecord && read.next[0] === "reset",
          ).length,
      )
      .toBeGreaterThan(0);
    await nextPoll(backend, id);
    await expect($.result).toBeHidden();
    await expect(step(page, STEP_LABELS.read)).toHaveAttribute(
      "data-step-state",
      "active",
    );

    expect(backend.advance(id)).toBe("reading"); // load
    expect(backend.advance(id)).toBe("checking"); // validate
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    expect(backend.advance(id)).toBe("publishing"); // report
    await expect(step(page, STEP_LABELS.finish)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    expect(backend.advance(id)).toBe("done");
    await expect($.result).toHaveAttribute("data-status", "needs_author_fixes");
    await expect($.result).toContainText(STATUS_TITLES.needs_author_fixes);
  });

  test("a new ingest is in Ingester's history at once", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({ stages: PLAIN_STAGES, stageMs: "manual" });
    const older = backend.seedIngestThread({
      state: "valid",
      fileName: "photosynthesis_grade_8.json",
    });
    await openApp(page, { mode: "ingester", chatHistoryOpen: "true" });
    await expect.poll(() => historyIds(page)).toEqual([older.thread_id]);

    // From here the server leaves new threads out of the list: a row can only come from the pane.
    backend.hideNewThreadsFromLists = true;
    await chooseFile(page, topicUpload("fresh_topic.json"));
    await $.ingestButton.click();
    await expect.poll(() => backend.calls.threadCreates.length).toBe(1);
    const threadId = backend.calls.threadCreates[0]!.threadId;
    await expect
      .poll(() => historyIds(page), { timeout: 3_000 })
      .toEqual([threadId, older.thread_id]);
    await expect(historyRow(page, threadId)).toContainText("fresh_topic.json");
  });

  test("a poll refused with 401 asks to sign in again, and recovers", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "running",
      stage: "checking",
    });
    await openIngest(page, ingest);
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );

    backend.pollFailure = { status: 401, json: { detail: "Unauthorized" } };
    await expect($.pane.getByText(COPY.signIn)).toBeVisible();
    await expect($.pane.getByText(COPY.pollOffline)).toHaveCount(0);

    backend.pollFailure = null;
    await expect($.pane.getByText(COPY.signIn)).toHaveCount(0, {
      timeout: 20_000,
    });
    backend.finish(ingest.thread_id);
    await expect($.result).toHaveAttribute("data-status", "valid");
  });

  test("Run again follows a run another tab started, instead of starting a second one", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({ state: "validation_incomplete" });
    await openIngest(page, ingest);
    const runAgain = $.result.getByRole("button", {
      name: ACTIONS.runAgain,
      exact: true,
    });
    await expect(runAgain).toBeEnabled();

    // This page has read the result and stopped polling; another tab starts a run now.
    backend.startRunElsewhere(ingest.thread_id, {
      stages: PLAIN_STAGES,
      stageMs: "manual",
    });
    await runAgain.click();

    await expect($.progress).toBeVisible();
    await expect($.result).toBeHidden();
    expect(backend.ingestRunCreates()).toEqual([]);
    expect(backend.calls.threadPatches).toEqual([]);
    expect(backend.runsOf(ingest.thread_id)).toHaveLength(2);

    backend.finish(ingest.thread_id);
    await expect($.result).toHaveAttribute("data-status", "valid");
    expect(backend.ingestRunCreates()).toEqual([]);
  });
});

test.describe("when the runtime keeps the graph's metadata writes", () => {
  test.use({ viewport: DESKTOP, metadataWrites: true });

  test("progress comes from the metadata, and the state is read once, at the end", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    backend.queueRun({
      stages: FIX_STAGES,
      stageMs: "manual",
      record: ({ threadId, input }) =>
        buildRecord("fixed", { threadId, fileName: input.file_name }),
    });
    await openApp(page, { mode: "ingester", chatHistoryOpen: "true" });
    await chooseFile(page, topicUpload());
    await $.ingestButton.click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    const threadId = backend.ingestRunCreates()[0]!.threadId;
    await expectUrlParam(page, "ingestId", threadId);

    await expect(step(page, STEP_LABELS.read)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    for (const [stage, label] of [
      ["checking", STEP_LABELS.check],
      ["fixing", STEP_LABELS.fix],
      ["rechecking", STEP_LABELS.recheck],
      ["publishing", STEP_LABELS.finish],
    ] as const) {
      expect(backend.advance(threadId)).toBe(stage);
      await expect(step(page, label)).toHaveAttribute(
        "data-step-state",
        "active",
      );
      if (stage === "checking")
        await expect($.pane).toContainText(FIXTURE_TOPIC.name);
    }
    await expect($.steps).toHaveCount(5);
    expect(backend.advance(threadId)).toBe("done");

    await expect($.result).toHaveAttribute("data-status", "fixed");
    await expect(historyRow(page, threadId)).toContainText(TOPIC_FIXTURE, {
      timeout: 30_000,
    });
    expect(backend.thread(threadId).metadata).toMatchObject({
      ingest_stage: "done",
      ingest_status: "fixed",
    });
    // The metadata carried every stage, so the state wasn't read while busy; its final status
    // ended the run, so the run list wasn't needed.
    expect(
      backend.calls.stateReadLog.filter(
        (read) => read.threadId === threadId && read.busy,
      ),
    ).toEqual([]);
    expect(
      backend.calls.stateReadLog.filter((read) => read.threadId === threadId),
    ).toHaveLength(1);
    expect(backend.calls.runLists.filter((id) => id === threadId)).toEqual([]);
  });

  test("seeded results and Run again work the same", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "validation_incomplete",
      fileName: "numbers_matter_warmup.json",
    });
    backend.queueRun({ stages: PLAIN_STAGES, stageMs: "manual" });
    await openIngest(page, ingest);
    await expect($.result).toHaveAttribute(
      "data-status",
      "validation_incomplete",
    );
    await expect($.result).toContainText(COPY.validationIncompleteBody);

    await action($.result, ACTIONS.runAgain).click();
    await expect.poll(() => backend.ingestRunCreates().length).toBe(1);
    await expect($.progress).toBeVisible();
    expect(backend.advance(ingest.thread_id)).toBe("checking");
    await expect(step(page, STEP_LABELS.check)).toHaveAttribute(
      "data-step-state",
      "active",
    );
    backend.finish(ingest.thread_id);
    await expect($.result).toHaveAttribute("data-status", "valid");
    expect(backend.thread(ingest.thread_id).metadata.ingest_status).toBe(
      "valid",
    );
  });
});

// ---------------------------------------------------------------- downloads

test.describe("downloads", () => {
  test("the report for the assistant is the record's Markdown, named <file>_report.md", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const ingest = backend.seedIngestThread({
      state: "needs_author_fixes",
      fileName: "geometry_biology_checkin.json",
    });
    await openIngest(page, ingest);
    await expect($.result).toHaveAttribute("data-status", "needs_author_fixes");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      action($.result, ACTIONS.downloadReport).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      "geometry_biology_checkin_report.md",
    );
    expect(await readFile((await download.path())!, "utf8")).toBe(
      recordOf(ingest).result!.issue_report_md,
    );
    // Made in the browser: no server call.
    expect(backend.calls.topicFiles).toEqual([]);
    // The fixer left the topic as it was: no topic files to download.
    await expect(topicFileLinks(page)).toHaveCount(0);
  });

  test("fixed, with its matching .md: the .md and .json download through /api/topic-file", async ({
    page,
    backend,
  }) => {
    const ingest = backend.seedIngestThread({
      state: "fixed",
      fileName: "algebra_chemistry_revision.json",
    });
    const result = recordOf(ingest).result!;
    await openIngest(page, ingest);
    await expect(ui(page).result).toHaveAttribute("data-status", "fixed");

    const files = [
      {
        label: ACTIONS.downloadMd,
        url: result.topic_md_url!,
        name: "algebra_chemistry_revision.md",
      },
      {
        label: ACTIONS.downloadJson,
        url: result.topic_json_url!,
        name: "algebra_chemistry_revision.json",
      },
    ];
    for (const file of files) {
      const link = page.getByRole("link", { name: file.label, exact: true });
      const href = new URL(
        (await link.getAttribute("href")) ?? "",
        "http://app.invalid",
      );
      expect(href.pathname).toBe("/api/topic-file");
      expect(href.searchParams.get("url")).toBe(file.url);
      expect(href.searchParams.get("name")).toBe(file.name);

      // The click starts a browser download of that link, under the right name. (Chromium
      // doesn't let page routes answer a download, so its body is checked with a fetch below.)
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        link.click(),
      ]);
      expect(download.suggestedFilename()).toBe(file.name);
      expect(new URL(download.url()).pathname).toBe("/api/topic-file");
      expect(new URL(download.url()).searchParams.get("url")).toBe(file.url);

      // The same link, fetched by the page, returns the topic file as an attachment.
      const fetched = await page.evaluate(async (path) => {
        const response = await fetch(path);
        return {
          status: response.status,
          disposition: response.headers.get("content-disposition"),
          body: await response.text(),
        };
      }, `${href.pathname}${href.search}`);
      expect(fetched.status).toBe(200);
      expect(fetched.disposition).toContain(`filename="${file.name}"`);
      expect(fetched.body).toBe(backend.files.get(file.url)!.toString("utf8"));
    }
    expect(backend.calls.topicFiles).toEqual(
      files.map(({ url, name }) => ({ url, name })),
    );
  });

  test("no topic files when the fixer changed nothing, or couldn't make the .md", async ({
    page,
    backend,
  }) => {
    const $ = ui(page);
    const valid = backend.seedIngestThread({ state: "valid" });
    const fixedNoMd = backend.seedIngestThread({
      state: "fixed",
      recordOptions: { withMarkdown: false },
    });
    for (const [thread, status] of [
      [valid, "valid"],
      [fixedNoMd, "fixed"],
    ] as const) {
      await openIngest(page, thread);
      await expect($.result).toHaveAttribute("data-status", status);
      await expect(topicFileLinks(page)).toHaveCount(0);
    }
  });
});

// ---------------------------------------------------------------- phone width and dark theme

test.describe("phone width and dark theme", () => {
  for (const [device, size] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`upload, progress and result on ${device} in ${theme}`, async ({
        page,
        backend,
      }, testInfo) => {
        const $ = ui(page);
        await page.setViewportSize(size);
        await applyTheme(page, theme);
        const running = backend.seedIngestThread({
          state: "running",
          stage: "fixing",
          fileName: "algebra_chemistry_revision.json",
        });
        const done = backend.seedIngestThread({
          state: "needs_author_fixes",
          fileName: "geometry_biology_checkin.json",
        });

        // Upload
        await openApp(page, { mode: "ingester" });
        if (theme === "dark")
          await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        await expect($.modeSwitch).toBeInViewport();
        await chooseFile(page, topicUpload());
        await expect($.fileSummary).toBeVisible();
        await expect($.ingestButton).toBeInViewport();
        expect(await fitsWidth($.pane, size.width)).toBe(true);
        await screenshot(page, testInfo, `upload-${device}-${theme}`);

        // Progress
        await openIngest(page, running);
        await expect(step(page, STEP_LABELS.fix)).toHaveAttribute(
          "data-step-state",
          "active",
        );
        expect(await fitsWidth($.pane, size.width)).toBe(true);
        await screenshot(page, testInfo, `progress-${device}-${theme}`);

        // Result
        await openIngest(page, done);
        await expect($.result).toHaveAttribute(
          "data-status",
          "needs_author_fixes",
        );
        await expect(action($.result, ACTIONS.downloadReport)).toBeInViewport();
        expect(await fitsWidth($.pane, size.width)).toBe(true);
        await screenshot(page, testInfo, `result-${device}-${theme}`);

        // History at this width (a sheet on phones), with the same heading.
        if (device === "phone") {
          await $.historyToggle.click();
          await expect(historyHeading(page)).toBeVisible();
          await expect
            .poll(async () => (await historyIds(page)).sort())
            .toEqual([running.thread_id, done.thread_id].sort());
          await screenshot(page, testInfo, `history-${device}-${theme}`);
        }
      });
    }
  }
});
