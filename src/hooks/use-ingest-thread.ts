"use client";

/**
 * One ingest = one LangGraph thread on the `topic_ingest` graph.
 *
 * start:    upload the .json (/api/ingest/upload) -> threads.create -> runs.create -> ingestId.
 * poll:     threads.search({ ids: [id], select }) every 1.5 s while the run is going, paused while
 *           the tab is hidden. Thread values are never read in the loop.
 * ended:    one threads.getState(id) for `values.record`, then the result view; polling stops.
 * runAgain: a new run on the same thread with the same uploaded file.
 *
 * Talks to LangGraph only through `createClient` (the existing IAP-minted JWT flow).
 */

import { useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getApiKey } from "@/lib/api-key";
import {
  INGEST_GRAPH_ID,
  INGEST_POLL_SELECT,
  type ApiError,
  type IngestStateValues,
  type IngestThreadSnapshot,
  type IngestUploadResponse,
  type IngestView,
} from "@/lib/ingest/ingest-types";
import { isFixStage } from "@/lib/ingest/progress";
import { isRunEnded, threadToView } from "@/lib/ingest/record-view";
import { FILE_MESSAGES } from "@/lib/ingest/topic-file";
import { getUserLimitNotice } from "@/lib/user-limit-error";
import { createClient } from "@/providers/client";

export type IngestLimitNotice = NonNullable<
  ReturnType<typeof getUserLimitNotice>
>;

export interface IngestThreadApi {
  /** The view of the current `ingestId` (never a previous one). */
  view: IngestView | null;
  /** An ingestId is set and its first answer hasn't come back yet. */
  loading: boolean;
  /** A plain sentence: a poll that couldn't reach the platform, or a start / run-again failure. */
  error: string | null;
  /** The thread doesn't exist, or isn't the creator's. */
  notFound: boolean;
  /** The daily-limit (429) notice from the last start / run-again. */
  limitNotice: IngestLimitNotice | null;
  /** start() or runAgain() is in flight. */
  starting: boolean;
  /** When this tab started the current run (ms), for the elapsed timer; null when unknown. */
  startedAt: number | null;
  start(file: File, text: string): Promise<void>;
  runAgain(): Promise<void>;
}

/** The chat runtime's busy cadence. */
const POLL_MS = 1500;
/** Once it looks stalled, keep an eye on it, gently. */
const STALLED_POLL_MS = 15_000;
const BACKOFF_MS = [3000, 5000, 10_000];

const POLL_OFFLINE = "We couldn't reach the platform. Trying again…";
const OFFLINE =
  "We couldn't reach the platform. Please check your internet connection and try again.";
const GENERIC = "Something went wrong on our side. Please try again.";
const SIGN_IN =
  "Your sign-in has expired. Please reload the page and sign in again.";
const CONFIG =
  "The platform isn't set up correctly yet. Please let the Cerebry team know.";

class UploadError extends Error {}

/**
 * When this page started a run, by thread id. Module-level, so the "just started" grace rule
 * (record-view's START_GRACE_MS) and the elapsed timer survive the pane unmounting when the
 * creator switches to Crafter and back.
 */
const RUN_STARTS = new Map<string, number>();

function httpStatusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** A thread id the server can't look up (unknown, malformed, or someone else's). */
function isMissingThread(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status === 400 || status === 404 || status === 422;
}

function actionMessage(error: unknown): string {
  if (error instanceof UploadError) return error.message;
  const status = httpStatusOf(error);
  if (status === undefined) return OFFLINE;
  if (status === 401 || status === 403) return SIGN_IN;
  return GENERIC;
}

function showLimitToast(notice: IngestLimitNotice) {
  // The same notice the chat shows (Stream.tsx).
  toast.error(notice.title, {
    id: "user-limit",
    description: notice.description,
    closeButton: true,
    duration: 5000,
    position: "top-center",
    richColors: true,
  });
}

async function uploadTopicFile(
  file: File,
  text: string,
): Promise<IngestUploadResponse> {
  const form = new FormData();
  // Upload exactly the text that passed the browser's checks (BOM already stripped).
  form.append(
    "file",
    new Blob([text], { type: "application/json" }),
    file.name,
  );
  let response: Response;
  try {
    response = await fetch("/api/ingest/upload", {
      method: "POST",
      body: form,
      cache: "no-store",
    });
  } catch {
    throw new UploadError(OFFLINE);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message = (body as Partial<ApiError> | undefined)?.error?.message;
    if (typeof message === "string" && message.trim())
      throw new UploadError(message);
    if (response.status === 413) throw new UploadError(FILE_MESSAGES.tooLarge);
    if (response.status === 415) throw new UploadError(FILE_MESSAGES.notJson);
    // IAP answers an expired session with a redirect page instead of JSON.
    if (response.status === 401 || response.status === 403)
      throw new UploadError(SIGN_IN);
    throw new UploadError(GENERIC);
  }
  const value = body as Partial<IngestUploadResponse> | undefined;
  if (
    !value ||
    typeof value.url !== "string" ||
    !value.url.startsWith("https://")
  )
    throw new UploadError(GENERIC);
  return {
    url: value.url,
    fileName:
      typeof value.fileName === "string" && value.fileName.trim()
        ? value.fileName
        : file.name,
    size: typeof value.size === "number" ? value.size : file.size,
  };
}

function metadataOf(
  snapshot: IngestThreadSnapshot | null,
): Record<string, unknown> {
  const metadata = snapshot?.metadata;
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
}

export function useIngestThread(
  ingestId: string | null,
  setIngestId: (id: string | null) => void,
): IngestThreadApi {
  const envApiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL;
  const [apiUrl] = useQueryState("apiUrl", {
    defaultValue: envApiUrl || "",
  });

  const [view, setViewState] = useState<IngestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<IngestLimitNotice | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const apiUrlRef = useRef(apiUrl || envApiUrl || "");
  apiUrlRef.current = apiUrl || envApiUrl || "";
  const ingestIdRef = useRef(ingestId);
  ingestIdRef.current = ingestId;
  const setIngestIdRef = useRef(setIngestId);
  setIngestIdRef.current = setIngestId;

  /** Bumped on every id change, run restart and unmount: older async answers are dropped. */
  const sessionRef = useRef(0);
  /** The thread the current poll session belongs to (null: nothing to poll). */
  const pollIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The session whose request is in flight (one at a time per session). */
  const inFlightRef = useRef<number | null>(null);
  /** The run has ended: the next tick reads the record instead of polling. */
  const endedRef = useRef(false);
  /** Nothing more to do for this id (record read, or not found). */
  const stoppedRef = useRef(false);
  const failuresRef = useRef(0);
  const fixSeenRef = useRef(false);
  const snapshotRef = useRef<IngestThreadSnapshot | null>(null);
  const viewRef = useRef<IngestView | null>(null);
  /** The thread start() just created, so the pane shows progress before the first poll. */
  const seedRef = useRef<{
    threadId: string;
    snapshot: IngestThreadSnapshot;
  } | null>(null);
  const actionRef = useRef(false);

  const commitView = useCallback((next: IngestView | null) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  const getClient = useCallback(() => {
    const url = apiUrlRef.current;
    if (!url) return null;
    return createClient(url, getApiKey() ?? undefined);
  }, []);

  // The poll machine. Refs only, so the functions below never go stale.
  const schedule = useCallback((session: number, ms: number) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void tickRef.current(session), ms);
  }, []);

  const tickRef = useRef<(session: number) => Promise<void>>(async () => {});
  tickRef.current = async (session: number) => {
    const id = pollIdRef.current;
    if (!id || session !== sessionRef.current || stoppedRef.current) return;
    // Paused while the tab is hidden; the visibility listener resumes it.
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    )
      return;
    if (inFlightRef.current === session) return;
    const client = getClient();
    if (!client) {
      setError(CONFIG);
      return;
    }
    inFlightRef.current = session;
    try {
      if (!endedRef.current) {
        const rows = await client.threads.search({
          ids: [id],
          limit: 1,
          select: [...INGEST_POLL_SELECT],
        });
        if (session !== sessionRef.current) return;
        if (seedRef.current?.threadId === id) seedRef.current = null;
        const thread = rows[0] as unknown as IngestThreadSnapshot | undefined;
        if (!thread) {
          stoppedRef.current = true;
          setError(null);
          setNotFoundId(id);
          commitView(null);
          return;
        }
        snapshotRef.current = thread;
        failuresRef.current = 0;
        setError(null);
        const stage = metadataOf(thread).ingest_stage;
        if (typeof stage === "string" && isFixStage(stage))
          fixSeenRef.current = true;
        const started = RUN_STARTS.get(id);
        if (!isRunEnded(thread, { startedAt: started })) {
          const next = threadToView({
            thread,
            fixSeen: fixSeenRef.current,
            startedAt: started,
          });
          commitView(next);
          schedule(
            session,
            next.phase === "stalled" ? STALLED_POLL_MS : POLL_MS,
          );
          return;
        }
        endedRef.current = true;
      }

      // The run has ended: read the record once.
      const state = await client.threads.getState<IngestStateValues>(id);
      if (session !== sessionRef.current) return;
      const thread = snapshotRef.current ?? { thread_id: id, status: "idle" };
      const values = (state?.values ?? undefined) as
        | IngestStateValues
        | undefined;
      stoppedRef.current = true;
      failuresRef.current = 0;
      setError(null);
      commitView(
        threadToView({
          thread,
          values,
          fixSeen: fixSeenRef.current,
          startedAt: RUN_STARTS.get(id),
        }),
      );
    } catch (caught) {
      if (session !== sessionRef.current) return;
      if (isMissingThread(caught)) {
        stoppedRef.current = true;
        setError(null);
        setNotFoundId(id);
        commitView(null);
        return;
      }
      failuresRef.current += 1;
      setError(POLL_OFFLINE);
      schedule(
        session,
        BACKOFF_MS[Math.min(failuresRef.current - 1, BACKOFF_MS.length - 1)]!,
      );
    } finally {
      if (inFlightRef.current === session) inFlightRef.current = null;
    }
  };

  /** A fresh poll session for one thread (a new id, or a new run on it). */
  const restartPolling = useCallback(
    (id: string) => {
      sessionRef.current += 1;
      pollIdRef.current = id;
      clearTimeout(timerRef.current);
      endedRef.current = false;
      stoppedRef.current = false;
      failuresRef.current = 0;
      schedule(sessionRef.current, 0);
    },
    [schedule],
  );

  /** Stops polling and drops every pending answer. */
  const stopPolling = useCallback(() => {
    sessionRef.current += 1;
    pollIdRef.current = null;
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Resume right away when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        pollIdRef.current &&
        !stoppedRef.current
      )
        schedule(sessionRef.current, 0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [schedule]);

  // A new id (a new ingest, or one opened from history): start over.
  useEffect(() => {
    fixSeenRef.current = false;
    snapshotRef.current = null;
    setError(null);
    setNotFoundId(null);
    setLimitNotice(null);
    if (!ingestId) {
      stopPolling();
      seedRef.current = null;
      setStartedAt(null);
      commitView(null);
      return;
    }
    setStartedAt(RUN_STARTS.get(ingestId) ?? null);
    // Kept until the first poll answers (a dev-mode effect re-run must still find it).
    const seed =
      seedRef.current?.threadId === ingestId ? seedRef.current : null;
    if (!seed) seedRef.current = null;
    if (seed) {
      snapshotRef.current = seed.snapshot;
      commitView(
        threadToView({
          thread: seed.snapshot,
          fixSeen: false,
          startedAt: RUN_STARTS.get(ingestId),
        }),
      );
    } else {
      commitView(null);
    }
    restartPolling(ingestId);
    return stopPolling;
  }, [ingestId, commitView, restartPolling, stopPolling]);

  const start = useCallback(
    async (file: File, text: string) => {
      if (actionRef.current) return;
      actionRef.current = true;
      setStarting(true);
      setError(null);
      setLimitNotice(null);
      const fail = (caught: unknown) => {
        const notice = getUserLimitNotice(caught);
        if (notice) showLimitToast(notice);
        if (!mountedRef.current) return;
        if (notice) setLimitNotice(notice);
        else setError(actionMessage(caught));
      };
      try {
        const client = getClient();
        if (!client) {
          setError(CONFIG);
          return;
        }
        let upload: IngestUploadResponse;
        let threadId: string;
        let created: IngestThreadSnapshot;
        try {
          upload = await uploadTopicFile(file, text);
          const fileName = upload.fileName;
          const thread = await client.threads.create({
            metadata: {
              graph_id: INGEST_GRAPH_ID,
              thread_title: fileName,
              ingest_file_name: fileName,
              ingest_source_url: upload.url,
              ingest_stage: "queued",
              ingest_status: "queued",
            },
          });
          threadId = thread.thread_id;
          created = thread as unknown as IngestThreadSnapshot;
        } catch (caught) {
          fail(caught);
          return;
        }

        const at = Date.now();
        try {
          await client.runs.create(threadId, INGEST_GRAPH_ID, {
            input: { source_url: upload.url, file_name: upload.fileName },
            onDisconnect: "continue",
          });
        } catch (caught) {
          const notice = getUserLimitNotice(caught);
          if (notice) {
            // Daily limit: stay on the upload panel with the notice. The thread is kept; in
            // history it shows that it didn't start, with Run again for later.
            fail(caught);
            return;
          }
          // Land on the thread anyway: its page explains that it didn't start (failed_to_start).
          RUN_STARTS.delete(threadId);
          setIngestIdRef.current(threadId);
          return;
        }
        RUN_STARTS.set(threadId, at);
        seedRef.current = {
          threadId,
          snapshot: {
            ...created,
            status: "busy",
            updated_at: new Date(at).toISOString(),
            metadata: {
              ...metadataOf(created),
              ingest_stage: "queued",
              ingest_status: "queued",
            },
          },
        };
        setIngestIdRef.current(threadId);
      } finally {
        actionRef.current = false;
        if (mountedRef.current) setStarting(false);
      }
    },
    [getClient],
  );

  const runAgain = useCallback(async () => {
    const id = ingestIdRef.current;
    const current = viewRef.current;
    if (!id || !current || current.threadId !== id || actionRef.current) return;
    if (current.busy || current.phase === "running") return;
    const sourceUrl = current.sourceUrl;
    if (!sourceUrl) return;
    const fileName = current.topic.fileName || "topic.json";
    const client = getClient();
    if (!client) {
      setError(CONFIG);
      return;
    }
    actionRef.current = true;
    setStarting(true);
    setError(null);
    setLimitNotice(null);
    const fail = (caught: unknown) => {
      const notice = getUserLimitNotice(caught);
      if (notice) showLimitToast(notice);
      if (!mountedRef.current || ingestIdRef.current !== id) return;
      if (notice) setLimitNotice(notice);
      else setError(actionMessage(caught));
    };
    const previous = metadataOf(snapshotRef.current);
    try {
      const queued = { ingest_stage: "queued", ingest_status: "queued" };
      try {
        await client.threads.update(id, { metadata: queued });
      } catch (caught) {
        fail(caught);
        return;
      }
      const at = Date.now();
      try {
        await client.runs.create(id, INGEST_GRAPH_ID, {
          input: { source_url: sourceUrl, file_name: fileName },
          onDisconnect: "continue",
        });
      } catch (caught) {
        // The run didn't start: put the last result's metadata back (best effort), so the
        // thread keeps showing that result.
        const revert: Record<string, unknown> = {};
        if (typeof previous.ingest_stage === "string")
          revert.ingest_stage = previous.ingest_stage;
        if (typeof previous.ingest_status === "string")
          revert.ingest_status = previous.ingest_status;
        if (Object.keys(revert).length)
          void client.threads
            .update(id, { metadata: revert })
            .catch(() => undefined);
        fail(caught);
        return;
      }
      RUN_STARTS.set(id, at);
      if (!mountedRef.current || ingestIdRef.current !== id) return;
      fixSeenRef.current = false;
      // Fresh `updated_at`: the last run's would read as stalled (isThreadStalled).
      const snapshot: IngestThreadSnapshot = {
        ...(snapshotRef.current ?? { thread_id: id }),
        status: "busy",
        updated_at: new Date(at).toISOString(),
        metadata: { ...previous, ...queued },
      };
      snapshotRef.current = snapshot;
      setStartedAt(at);
      commitView(
        threadToView({ thread: snapshot, fixSeen: false, startedAt: at }),
      );
      restartPolling(id);
    } finally {
      actionRef.current = false;
      if (mountedRef.current) setStarting(false);
    }
  }, [commitView, getClient, restartPolling]);

  const currentView =
    view && ingestId && view.threadId === ingestId ? view : null;
  const notFound = !!ingestId && notFoundId === ingestId;
  return {
    view: currentView,
    loading: !!ingestId && !currentView && !notFound,
    error,
    notFound,
    limitNotice,
    starting,
    startedAt: ingestId ? startedAt : null,
    start,
    runAgain,
  };
}
