import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo } from "react";
import { validate as isUuid } from "uuid";
import { INGEST_GRAPH_ID } from "@/lib/ingest/ingest-types";

export type AppModeId = "crafter" | "ingester";
export type AppPane = "chat" | "ingest";

export interface AppMode {
  id: AppModeId;
  /** Name in the mode menu, and on its button. */
  label: string;
  /** One line under the name in the mode menu. */
  description: string;
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
 * Every mode of the app, in menu order. A new mode (a later "Digitizer")
 * is one entry here plus its pane in the shell.
 */
export const APP_MODES: readonly AppMode[] = [
  {
    id: "crafter",
    label: "Crafter",
    description: "Plan and write questions with the agent",
    urlValue: "crafter",
    graphId:
      process.env.NEXT_PUBLIC_ASSISTANT_ID || "o3_question_crafter_agent",
    idParam: "threadId",
    pane: "chat",
  },
  {
    id: "ingester",
    label: "Ingester",
    description: "Check a TopicCrafter .json and preview it",
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

/** The URL parameters that decide the mode: `?mode=` and every mode's id parameter. */
export type AppModeUrlParams = { mode?: string | null } & Partial<
  Record<AppMode["idParam"], string | null>
>;

/**
 * Pure: ?mode= wins when valid; else a link carrying another mode's id (an
 * `ingestId`, with no mode) opens that mode; else Crafter.
 */
export function resolveAppModeId(params: AppModeUrlParams): AppModeId {
  const fromUrl = findModeByUrlValue(params.mode);
  if (fromUrl) return fromUrl.id;
  const fromId = APP_MODES.find(
    (mode) => mode.id !== DEFAULT_MODE_ID && !!params[mode.idParam]?.trim(),
  );
  return fromId?.id ?? DEFAULT_MODE_ID;
}

/**
 * Pure: the `?mode=` value to write into the URL, or null. Only a link that
 * picked a mode through its id alone (`?ingestId=` with no valid `mode`) gets
 * one, so the mode stays when that id is later cleared (New, Upload a
 * different file). A plain Crafter link never gains `?mode=`.
 */
export function getModeParamToPin(params: AppModeUrlParams): string | null {
  if (findModeByUrlValue(params.mode)) return null;
  const id = resolveAppModeId(params);
  return id === DEFAULT_MODE_ID ? null : getAppMode(id).urlValue;
}

/** Upstream agent-chat-ui's pattern: a UUID graphId filters on assistant_id, otherwise on graph_id. */
export function getThreadSearchMetadata(mode: AppMode): Record<string, string> {
  return isUuid(mode.graphId)
    ? { assistant_id: mode.graphId }
    : { graph_id: mode.graphId };
}

// Static key maps so every caller shares the same nuqs subscriptions.
const MODE_ID_PARAMS = Object.fromEntries(
  APP_MODES.map((mode) => [mode.idParam, parseAsString]),
) as Record<AppMode["idParam"], typeof parseAsString>;

const MODE_URL_PARAMS = { mode: parseAsString, ...MODE_ID_PARAMS };

export function useAppMode(): {
  mode: AppMode;
  setMode: (id: AppModeId) => void;
} {
  const [params, setParams] = useQueryStates(MODE_URL_PARAMS);
  const mode = getAppMode(resolveAppModeId(params));

  // Always written explicitly, so a link with an ingestId can still show
  // Crafter. Both thread ids stay in the URL, so switching back returns the
  // user to where they were.
  const setMode = useCallback(
    (id: AppModeId) => {
      void setParams({ mode: getAppMode(id).urlValue });
    },
    [setParams],
  );

  return useMemo(() => ({ mode, setMode }), [mode, setMode]);
}

/**
 * Call once, in the shell. Writes `?mode=` (replacing the history entry) when
 * a link chose its mode through an id alone; see `getModeParamToPin`.
 */
export function usePinModeParam(): void {
  const [params, setParams] = useQueryStates(MODE_URL_PARAMS);
  const pin = getModeParamToPin(params);
  useEffect(() => {
    if (pin) void setParams({ mode: pin }, { history: "replace" });
  }, [pin, setParams]);
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

/** The Ingester's active ingest (`?ingestId=`). */
export function useIngestId(): [string | null, (id: string | null) => void] {
  return useModeThreadId(getAppMode("ingester"));
}
