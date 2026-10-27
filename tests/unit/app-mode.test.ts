import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_MODES,
  type AppMode,
  DEFAULT_MODE_ID,
  getAppMode,
  getModeParamToPin,
  getThreadSearchMetadata,
  resolveAppModeId,
} from "@/lib/app-mode";
import { INGEST_GRAPH_ID } from "@/lib/ingest/ingest-types";

describe("resolveAppModeId", () => {
  it.each([
    [{}, "crafter"],
    [{ mode: null, ingestId: null }, "crafter"],
    [{ mode: "", ingestId: "" }, "crafter"],
    [{ ingestId: "   " }, "crafter"],
    [{ mode: "crafter" }, "crafter"],
    [{ mode: "ingester" }, "ingester"],
    [{ mode: " Ingester " }, "ingester"],
    [{ ingestId: "thread-1" }, "ingester"],
    [{ mode: "crafter", ingestId: "thread-1" }, "crafter"],
    [{ mode: "ingester", ingestId: null }, "ingester"],
    [{ mode: "digitizer" }, "crafter"],
    [{ mode: "digitizer", ingestId: "thread-1" }, "ingester"],
    // Crafter's own id never picks a mode: it is the default anyway.
    [{ threadId: "chat-1" }, "crafter"],
    [{ threadId: "chat-1", ingestId: "thread-1" }, "ingester"],
    [{ mode: "crafter", threadId: "chat-1", ingestId: "thread-1" }, "crafter"],
  ] as const)("%j -> %s", (params, expected) => {
    expect(resolveAppModeId(params)).toBe(expected);
  });

  it("round-trips every mode's URL value", () => {
    for (const mode of APP_MODES) {
      expect(resolveAppModeId({ mode: mode.urlValue })).toBe(mode.id);
      expect(
        resolveAppModeId({ mode: mode.urlValue, ingestId: "thread-1" }),
      ).toBe(mode.id);
    }
  });
});

describe("getModeParamToPin", () => {
  it.each([
    // A link that chose Ingester through its id alone gets ?mode=ingester.
    [{ ingestId: "thread-1" }, "ingester"],
    [{ mode: null, ingestId: "thread-1" }, "ingester"],
    [{ mode: "", ingestId: "thread-1" }, "ingester"],
    [{ threadId: "chat-1", ingestId: "thread-1" }, "ingester"],
    // An unknown mode is replaced by the one on screen.
    [{ mode: "digitizer", ingestId: "thread-1" }, "ingester"],
    // A valid mode is never rewritten.
    [{ mode: "ingester", ingestId: "thread-1" }, null],
    [{ mode: " Ingester ", ingestId: "thread-1" }, null],
    [{ mode: "crafter", ingestId: "thread-1" }, null],
    [{ mode: "ingester" }, null],
    // Plain Crafter links stay as they are.
    [{}, null],
    [{ mode: null, ingestId: null }, null],
    [{ ingestId: "   " }, null],
    [{ threadId: "chat-1" }, null],
    [{ mode: "digitizer" }, null],
  ] as const)("%j -> %s", (params, expected) => {
    expect(getModeParamToPin(params)).toBe(expected);
  });

  it("pins exactly the mode the URL resolves to", () => {
    for (const mode of APP_MODES) {
      const params = { [mode.idParam]: "id-1" };
      const pin = getModeParamToPin(params);
      if (mode.id === DEFAULT_MODE_ID) {
        expect(pin).toBeNull();
      } else {
        expect(pin).toBe(mode.urlValue);
        expect(resolveAppModeId({ ...params, mode: pin })).toBe(mode.id);
        // Once pinned, clearing the id keeps the mode.
        expect(resolveAppModeId({ mode: pin })).toBe(mode.id);
        expect(getModeParamToPin({ ...params, mode: pin })).toBeNull();
      }
    }
  });
});

describe("getThreadSearchMetadata", () => {
  const base = getAppMode("crafter");

  it("filters on graph_id for a graph name", () => {
    expect(
      getThreadSearchMetadata({
        ...base,
        graphId: "o3_question_crafter_agent",
      }),
    ).toEqual({ graph_id: "o3_question_crafter_agent" });
    expect(getThreadSearchMetadata(getAppMode("ingester"))).toEqual({
      graph_id: INGEST_GRAPH_ID,
    });
  });

  it("filters on assistant_id for an assistant UUID", () => {
    const assistantId = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
    const mode: AppMode = { ...base, graphId: assistantId };
    expect(getThreadSearchMetadata(mode)).toEqual({
      assistant_id: assistantId,
    });
  });

  it("returns exactly one key", () => {
    for (const mode of APP_MODES) {
      expect(Object.keys(getThreadSearchMetadata(mode))).toHaveLength(1);
    }
  });
});

describe("APP_MODES", () => {
  it("has unique ids, URL values, id params and graphs", () => {
    for (const key of ["id", "urlValue", "idParam", "graphId"] as const) {
      const values = APP_MODES.map((mode) => mode[key]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("contains the default mode, and getAppMode finds every entry", () => {
    expect(APP_MODES.some((mode) => mode.id === DEFAULT_MODE_ID)).toBe(true);
    expect(DEFAULT_MODE_ID).toBe("crafter");
    for (const mode of APP_MODES) {
      expect(getAppMode(mode.id)).toBe(mode);
    }
  });

  it("lists Crafter then Ingester with their contract values", () => {
    expect(APP_MODES.map((mode) => mode.label)).toEqual([
      "Crafter",
      "Ingester",
    ]);
    expect(getAppMode("crafter")).toMatchObject({
      urlValue: "crafter",
      idParam: "threadId",
      pane: "chat",
    });
    expect(getAppMode("ingester")).toMatchObject({
      urlValue: "ingester",
      idParam: "ingestId",
      pane: "ingest",
      graphId: INGEST_GRAPH_ID,
    });
  });
});

describe("Crafter graph id", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to the QuestionCrafter graph", async () => {
    vi.stubEnv("NEXT_PUBLIC_ASSISTANT_ID", "");
    vi.resetModules();
    const { getAppMode: fresh } = await import("@/lib/app-mode");
    expect(fresh("crafter").graphId).toBe("o3_question_crafter_agent");
  });

  it("follows NEXT_PUBLIC_ASSISTANT_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_ASSISTANT_ID", "my_graph");
    vi.resetModules();
    const { getAppMode: fresh } = await import("@/lib/app-mode");
    expect(fresh("crafter").graphId).toBe("my_graph");
  });
});
