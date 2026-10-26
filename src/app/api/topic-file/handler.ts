/**
 * GET /api/topic-file?url=<https link>&name=<file name>: a same-origin download of a topic `.json`
 * or `.md` from an ingest record (`result.topic_json_url`, `result.topic_md_url`).
 *
 * Only links that pass guards.ts are fetched; anything else is refused before any request is
 * made. The fetch follows no redirects, stops after 30 s and reads at most 25 MB.
 *
 *   200  the file, as an attachment named after `name` with the link's extension
 *   400  bad_url (no or unreadable link) / blocked_url (not an allowed storage link)
 *   404  not_found (storage says 403, 404 or 410)
 *   413  too_large (over 25 MB, declared or streamed)
 *   502  redirect_refused / download_failed (network, timeout, other storage errors)
 *
 * Errors are `{ error: { code, message } }` (ApiError). Every response is `Cache-Control: no-store`.
 */
import { NextResponse } from "next/server";

import type { ApiError } from "@/lib/ingest/ingest-types";

import {
  checkTopicFileUrl,
  contentDisposition,
  downloadFileName,
  FETCH_TIMEOUT_MS,
  loadTopicFileConfig,
  MAX_TOPIC_FILE_BYTES,
  MAX_URL_LENGTH,
  readCapped,
  TooLargeError,
  TOPIC_FILE_TYPES,
} from "./guards";

export const TOPIC_FILE_MESSAGES = {
  unavailable: "This topic file isn't available to download.",
  fetchFailed:
    "We couldn't fetch your topic file just now. Please try again in a moment.",
  tooLarge:
    "This topic file is bigger than 25 MB, so it can't be downloaded here.",
} as const;

type Env = Record<string, string | undefined>;

export interface TopicFileDeps {
  /** The fetch to use; the default is the global fetch at call time. */
  fetchImpl?: typeof fetch;
  env?: Env;
}

function apiError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function handleTopicFile(
  request: Request,
  deps: TopicFileDeps = {},
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  if (!raw?.trim() || raw.length > MAX_URL_LENGTH)
    return apiError(400, "bad_url", TOPIC_FILE_MESSAGES.unavailable);

  const config = loadTopicFileConfig(deps.env ?? process.env);
  const target = checkTopicFileUrl(raw, config);
  if (!target)
    return apiError(400, "blocked_url", TOPIC_FILE_MESSAGES.unavailable);

  const type = TOPIC_FILE_TYPES[target.kind];
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  let upstream: Response;
  try {
    upstream = await fetchImpl(target.url.toString(), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { accept: type.accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return apiError(502, "download_failed", TOPIC_FILE_MESSAGES.fetchFailed);
  }

  const discard = () => upstream.body?.cancel().catch(() => undefined);
  if (
    upstream.type === "opaqueredirect" ||
    (upstream.status >= 300 && upstream.status < 400)
  ) {
    await discard();
    return apiError(502, "redirect_refused", TOPIC_FILE_MESSAGES.fetchFailed);
  }
  if ([403, 404, 410].includes(upstream.status)) {
    await discard();
    return apiError(404, "not_found", TOPIC_FILE_MESSAGES.unavailable);
  }
  if (!upstream.ok) {
    await discard();
    return apiError(502, "download_failed", TOPIC_FILE_MESSAGES.fetchFailed);
  }
  // As /api/markdown-artifact does: the URL that answered must pass the same guards.
  if (upstream.url && !checkTopicFileUrl(upstream.url, config)) {
    await discard();
    return apiError(502, "redirect_refused", TOPIC_FILE_MESSAGES.fetchFailed);
  }

  let body: Uint8Array;
  try {
    body = await readCapped(upstream, MAX_TOPIC_FILE_BYTES);
  } catch (error) {
    return error instanceof TooLargeError
      ? apiError(413, "too_large", TOPIC_FILE_MESSAGES.tooLarge)
      : apiError(502, "download_failed", TOPIC_FILE_MESSAGES.fetchFailed);
  }

  const fileName = downloadFileName(
    params.get("name"),
    target.url,
    target.kind,
  );
  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": type.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
