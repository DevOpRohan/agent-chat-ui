import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { useCallback, useMemo } from "react";
import { validate as isUuid } from "uuid";
import { INGEST_GRAPH_ID } from "@/lib/ingest/ingest-types";

export type AppModeId = "crafter" | "ingester";
export type AppPane = "chat" | "ingest";

export interface AppMode {
  id: AppModeId;
  /** Text on the mode switch. */
  label: string;
  /** Value of `?mode=`. */
  urlValue: string;
  /** Graph (or assistant) whose threads make up this mode's history. */
  graphId: string;
  /** URL parameter holding this mode's active thread id. */
  idParam: "threadId" | "ingestId";
  /** Which pane the shell draws for this mode. */
  pane: AppPane;
}

/**
 * Every mode of the app, in switch order. A new mode (a later "Digitizer")
 * is one entry here plus its pane in the shell.
 */
export const APP_MODES: readonly AppMode[] = [
  {
    id: "crafter",
    label: "Crafter",
    urlValue: "crafter",
    graphId:
      process.env.NEXT_PUBLIC_ASSISTANT_ID || "o3_question_crafter_agent",
    idParam: "threadId",
    pane: "chat",
  },
  {
    id: "ingester",
    label: "Ingester",
    urlValue: "ingester",
    graphId: INGEST_GRAPH_ID,
    idParam: "ingestId",
    pane: "ingest",
  },
];

export const DEFAULT_MODE_ID: AppModeId = "crafter";

const MODES_BY_ID = new Map(APP_MODES.map((mode) => [mode.id, mode]));

export function getAppMode(id: AppModeId): AppMode {
  return MODES_BY_ID.get(id) ?? MODES_BY_ID.get(DEFAULT_MODE_ID)!;
}

function findModeByUrlValue(value: string | null | undefined): AppMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return APP_MODES.find((mode) => mode.urlValue === normalized) ?? null;
}

/** Pure: ?mode= wins when valid; else a link with ingestId (and no mode) opens Ingester; else Crafter. */
export function resolveAppModeId(params: {
  mode?: string | null;
  ingestId?: string | null;
}): AppModeId {
  const fromUrl = findModeByUrlValue(params.mode);
  if (fromUrl) return fromUrl.id;
  if (params.ingestId?.trim()) return "ingester";
  return DEFAULT_MODE_ID;
}

/** Upstream agent-chat-ui's pattern: a UUID graphId filters on assistant_id, otherwise on graph_id. */
export function getThreadSearchMetadata(mode: AppMode): Record<string, string> {
  return isUuid(mode.graphId)
    ? { assistant_id: mode.graphId }
    : { graph_id: mode.graphId };
}

// One static key map so every caller shares the same nuqs subscriptions.
const MODE_ID_PARAMS = Object.fromEntries(
  APP_MODES.map((mode) => [mode.idParam, parseAsString]),
) as Record<AppMode["idParam"], typeof parseAsString>;

export function useAppMode(): {
  mode: AppMode;
  setMode: (id: AppModeId) => void;
} {
  const [modeParam, setModeParam] = useQueryState("mode");
  const [ingestId] = useQueryState("ingestId");
  const mode = getAppMode(resolveAppModeId({ mode: modeParam, ingestId }));

  // Always written explicitly, so a link with an ingestId can still show
  // Crafter. Both thread ids stay in the URL, so switching back returns the
  // user to where they were.
  const setMode = useCallback(
    (id: AppModeId) => {
      void setModeParam(getAppMode(id).urlValue);
    },
    [setModeParam],
  );

  return useMemo(() => ({ mode, setMode }), [mode, setMode]);
}

/** The active thread id of a mode, read/written in the URL with nuqs (threadId or ingestId). */
export function useModeThreadId(
  mode: AppMode,
): [string | null, (id: string | null) => void] {
  const [ids, setIds] = useQueryStates(MODE_ID_PARAMS);
  const { idParam } = mode;
  const setId = useCallback(
    (id: string | null) => {
      void setIds({ [idParam]: id });
    },
    [idParam, setIds],
  );
  return [ids[idParam] ?? null, setId];
}

export function useIngestId(): [string | null, (id: string | null) => void] {
  return useModeThreadId(getAppMode("ingester"));
}
