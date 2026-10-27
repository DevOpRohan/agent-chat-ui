import { describe, expect, it } from "vitest";

import { INGEST_FINAL_STATUSES } from "@/lib/ingest/ingest-types";
import {
  FAILED_TO_START,
  friendlyWarning,
  friendlyWarnings,
  IMPORT_STATUSES,
  isFinalStatus,
  KEEP_IN_STEP_TITLE,
  plainInvalidInputMessage,
  PREVIEW_HINT,
  REPORT_DOWNLOAD_LABEL,
  REPORT_INSTRUCTIONS,
  RUN_ERROR,
  STALLED_COPY,
  statusCopy,
  UPDATED_FILES_NEXT_STEPS,
  UPDATED_FILES_TEXT,
  UPDATED_FILES_TITLE,
} from "@/lib/ingest/status-copy";

// ".json" is fine: creators know their files by that name. JSON as a word, codes and tool names are not.
const JARGON =
  /(?<!\.)\bjson\b|\bcode\b|\bCT\b|status|graph|updater|langgraph|latex|parser|lambda|_/i;

describe("statusCopy", () => {
  it("has plain copy and exactly one primary action for every status", () => {
    const expected = {
      valid: ["Your topic is ready.", "open_preview"],
      fixed: [
        "We fixed a few small formatting issues. Your topic is ready.",
        "open_preview",
      ],
      needs_author_fixes: [
        "A few things need your attention.",
        "download_report",
      ],
      updater_failed: ["A few things need your attention.", "download_report"],
      validation_incomplete: ["We couldn't finish checking.", "try_again"],
      invalid_input: ["We couldn't read this file.", "upload_new"],
    } as const;
    for (const status of IMPORT_STATUSES) {
      const copy = statusCopy(status);
      expect(copy.status).toBe(status);
      expect(copy.title).toBe(expected[status][0]);
      expect(copy.primaryAction).toBe(expected[status][1]);
      for (const text of [
        copy.title,
        copy.body,
        copy.badge,
        copy.note ?? "",
        copy.nextSteps ?? "",
      ]) {
        expect(text, `${status}: "${text}"`).not.toMatch(JARGON);
      }
    }
  });

  it("uses one colour per meaning: green ready, amber attention, blue retry, red only for unreadable files", () => {
    expect(statusCopy("valid").tone).toBe("success");
    expect(statusCopy("fixed").tone).toBe("success");
    expect(statusCopy("needs_author_fixes").tone).toBe("attention");
    expect(statusCopy("updater_failed").tone).toBe("attention");
    expect(statusCopy("validation_incomplete").tone).toBe("retry");
    expect(statusCopy("failed_to_start").tone).toBe("retry");
    expect(STALLED_COPY.tone).toBe("retry");
    expect(statusCopy("invalid_input").tone).toBe("error");
    const reds = IMPORT_STATUSES.filter((s) => statusCopy(s).tone === "error");
    expect(reds).toEqual(["invalid_input"]);
  });

  it("offers the report for the assistant: primary when issues remain, 'keep in step' when fixed, never when the check couldn't finish", () => {
    expect(REPORT_DOWNLOAD_LABEL).toBe("Download report for your assistant");
    expect(statusCopy("needs_author_fixes").report).toBe("primary");
    expect(statusCopy("updater_failed").report).toBe("primary");
    expect(statusCopy("fixed").report).toBe("keep_in_step");
    expect(KEEP_IN_STEP_TITLE).toBe("Keep your own copy in step");
    expect(statusCopy("validation_incomplete").report).toBe("none");
    expect(statusCopy("valid").report).toBe("none");
  });

  it("offers topic files only as the updated .md and .json pair, in plain words", () => {
    expect(UPDATED_FILES_TITLE).toBe("Your updated topic files");
    expect(UPDATED_FILES_TEXT).toMatch(
      /your old \.md and \.json are out of date/,
    );
    // Further changes start from the new files, not the creator's old copies.
    expect(UPDATED_FILES_TEXT).toMatch(
      /For any further changes, work on these new files/,
    );
    expect(UPDATED_FILES_NEXT_STEPS).toMatch(/updated \.md and \.json below/);
    expect(UPDATED_FILES_NEXT_STEPS).toMatch(
      /work on these from now on, not your old copies/,
    );
    for (const text of [UPDATED_FILES_TEXT, UPDATED_FILES_NEXT_STEPS])
      expect(text).not.toMatch(JARGON);
    for (const status of IMPORT_STATUSES)
      expect(statusCopy(status)).not.toHaveProperty("topicJson");
  });

  it("says the preview opens in a new tab, and what to do while it is being prepared", () => {
    expect(PREVIEW_HINT).toBe(
      "The preview opens in a new tab. If it says it's still being prepared, wait a minute, then refresh that tab.",
    );
  });

  it("tells the creator what to do next when issues remain", () => {
    expect(statusCopy("needs_author_fixes").nextSteps).toBe(
      "Give this report and your topic's .md file to your assistant (TopicCrafter), ask it to fix only these issues, then upload the new .json here.",
    );
    expect(statusCopy("updater_failed").nextSteps).toBe(REPORT_INSTRUCTIONS);
    expect(statusCopy("updater_failed").note).toMatch(
      /automatic fix step didn't work this time/,
    );
    expect(statusCopy("needs_author_fixes").showIssues).toBe(true);
  });

  it("validation_incomplete says the topic isn't the problem", () => {
    expect(statusCopy("validation_incomplete").body).toContain(
      "Our checking service was busy. Your topic isn't the problem.",
    );
  });

  it("invalid_input shows the backend's message, without its prefix or placeholders", () => {
    const copy = statusCopy(
      "invalid_input",
      "Could not read the topic: the file is not valid JSON (line 1, column 1: Expecting value)",
    );
    expect(copy.body).toBe(
      "The file is not valid JSON (line 1, column 1: Expecting value).",
    );
    expect(plainInvalidInputMessage("Could not read the topic: ")).toBe(
      statusCopy("invalid_input").body,
    );
    expect(
      plainInvalidInputMessage(
        "Could not read the topic: The platform takes only the .json file. Upload <topic_name>.json, which your assistant made",
      ),
    ).toBe(
      "The platform takes only the .json file. Upload the .json file, which your assistant made.",
    );
  });

  it("failed_to_start (set by this app) shows the stored plain message and offers a new upload", () => {
    const copy = statusCopy(
      "failed_to_start",
      "We can't reach the checking service right now. Please try again in a few minutes.",
    );
    expect(copy.title).toBe("We couldn't start the ingestion.");
    expect(copy.body).toBe(
      "We can't reach the checking service right now. Please try again in a few minutes.",
    );
    expect(copy.primaryAction).toBe("upload_again");
    expect(copy.report).toBe("none");
    expect(STALLED_COPY.title).toBe("This is taking longer than expected.");
  });

  it("falls back safely for an unknown status", () => {
    expect(statusCopy("something_new").status).toBe("unknown");
    expect(statusCopy(undefined).primaryAction).toBe("upload_new");
  });
});

describe("run_error (set by this app when the run ended without a record)", () => {
  it("reads exactly like validation_incomplete, under its own status", () => {
    const base = statusCopy("validation_incomplete");
    expect(RUN_ERROR).toBe("run_error");
    expect(statusCopy(RUN_ERROR)).toEqual({ ...base, status: "run_error" });
    expect(statusCopy(RUN_ERROR).title).toBe("We couldn't finish checking.");
    expect(statusCopy(RUN_ERROR).primaryAction).toBe("try_again");
    expect(statusCopy(RUN_ERROR).tone).toBe("retry");
    expect(statusCopy(RUN_ERROR).badge).toBe("Couldn't finish");
    // No new sentences: a message never replaces the copy.
    expect(statusCopy(RUN_ERROR, "Traceback: boom").body).toBe(base.body);
    expect(
      friendlyWarnings({ status: RUN_ERROR, warnings: [], hasPreview: false }),
    ).toEqual([]);
  });
});

describe("isFinalStatus", () => {
  it("accepts the graph's six statuses and this app's failed_to_start and run_error", () => {
    expect(IMPORT_STATUSES).toEqual(INGEST_FINAL_STATUSES);
    for (const status of IMPORT_STATUSES)
      expect(isFinalStatus(status)).toBe(true);
    expect(isFinalStatus(FAILED_TO_START)).toBe(true);
    expect(isFinalStatus(RUN_ERROR)).toBe(true);
    for (const status of ["queued", "processing", "unknown", "", undefined, 1])
      expect(isFinalStatus(status)).toBe(false);
  });
});

describe("warnings", () => {
  it("turns backend warnings into soft, plain notes", () => {
    expect(friendlyWarning("Preview link unavailable: HTTPError: 502")).toBe(
      "The preview isn't available right now.",
    );
    expect(
      friendlyWarning("Could not save the topic JSON: ClientError: denied"),
    ).toMatch(/couldn't save a copy/);
    expect(friendlyWarning("The topic updater saved no changes.")).toBe(
      "Our automatic fix step didn't change anything.",
    );
    expect(
      friendlyWarning(
        "Could not save the topic Markdown: ValueError: the topic .md does not convert back",
      ),
    ).toMatch(/couldn't make the updated \.md/);
    expect(friendlyWarning("Something odd: KeyError 'x'")).toMatch(
      /Technical details/,
    );
  });

  it("adds a note when a ready topic has no preview, and drops repeats", () => {
    expect(
      friendlyWarnings({ status: "valid", warnings: [], hasPreview: false }),
    ).toEqual(["The preview isn't available right now."]);
    expect(
      friendlyWarnings({
        status: "valid",
        warnings: ["Preview link unavailable: Timeout"],
        hasPreview: false,
      }),
    ).toEqual(["The preview isn't available right now."]);
    expect(
      friendlyWarnings({ status: "valid", warnings: [], hasPreview: true }),
    ).toEqual([]);
  });

  it("doesn't repeat the updater_failed note", () => {
    expect(
      friendlyWarnings({
        status: "updater_failed",
        warnings: ["Topic updater failed: RuntimeError: boom"],
        hasPreview: false,
      }),
    ).toEqual([]);
  });
});

describe("the importer's match-explanation warning", () => {
  it("is worded plainly, not as the generic note", () => {
    const text = friendlyWarning(
      "6 matching pairs have no explanation. We added a blank one so your topic can be created; ask your assistant to write a short explanation for every match next time.",
    );
    expect(text).toMatch(/matching pairs had no explanation/);
    expect(
      friendlyWarning(
        "1 matching pair has no explanation. We added a blank one",
      ),
    ).toBe(text);
  });
});
