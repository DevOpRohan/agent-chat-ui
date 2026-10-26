import { describe, expect, it } from "vitest";

import { deriveProgress, STEP_LABELS } from "@/lib/ingest/progress";

const states = (stage?: string, fixSeen = false) =>
  Object.fromEntries(
    deriveProgress({ stage, fixSeen }).steps.map((s) => [s.id, s.state]),
  );

describe("deriveProgress (from the record's stage)", () => {
  it("starts with reading the topic, without the fix steps", () => {
    const progress = deriveProgress({ stage: "queued" });
    expect(progress.steps.map((s) => s.label)).toEqual([
      "Reading your topic",
      "Checking every question",
      "Preparing your preview",
    ]);
    expect(progress.active).toBe("read");
    expect(progress.fixing).toBe(false);
    expect(states("reading")).toEqual({
      read: "active",
      check: "pending",
      finish: "pending",
    });
    expect(states(undefined)).toEqual({
      read: "active",
      check: "pending",
      finish: "pending",
    });
  });

  it("checks every question", () => {
    expect(states("checking")).toEqual({
      read: "done",
      check: "active",
      finish: "pending",
    });
  });

  it("shows the fix steps only once the graph enters fixing", () => {
    const progress = deriveProgress({ stage: "fixing" });
    expect(progress.fixing).toBe(true);
    expect(progress.steps.map((s) => [s.id, s.state])).toEqual([
      ["read", "done"],
      ["check", "done"],
      ["fix", "active"],
      ["recheck", "pending"],
      ["finish", "pending"],
    ]);
    expect(progress.steps.find((s) => s.id === "fix")?.label).toBe(
      STEP_LABELS.fix,
    );
  });

  it("re-checks after fixing", () => {
    expect(states("rechecking")).toEqual({
      read: "done",
      check: "done",
      fix: "done",
      recheck: "active",
      finish: "pending",
    });
  });

  it("prepares the preview after a clean check (no fix steps)", () => {
    expect(states("publishing")).toEqual({
      read: "done",
      check: "done",
      finish: "active",
    });
  });

  it("keeps the fix steps (done) at publishing once fixing was seen", () => {
    expect(states("publishing", true)).toEqual({
      read: "done",
      check: "done",
      fix: "done",
      recheck: "done",
      finish: "active",
    });
  });
});
