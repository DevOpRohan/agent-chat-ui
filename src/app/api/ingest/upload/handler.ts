/**
 * POST /api/ingest/upload: the topic .json of one ingest goes to the app's GCS bucket, and the
 * browser gets its https link for the `topic_ingest` run (`source_url`).
 *
 * The file goes to the bucket and nowhere else: this route has no other upload path, no model
 * provider settings and no third-party calls. The chat's /api/upload is a separate route.
 *
 * Checks (the browser runs the same ones first, with the same words):
 *   - one multipart field `file`                  400 missing_file / multiple_files
 *   - the name ends in .json                      415 not_json
 *   - at most 10 MB                               413 too_large
 *   - not empty                                   400 empty
 *   - UTF-8 JSON (a leading BOM is dropped)       400 invalid_json
 *   - GCS_BUCKET_NAME is set and valid            500 not_configured
 *   - the write succeeds                          503 storage_unavailable
 *
 * Saved as `topic-ingest/<uuid>.json`, `application/json; charset=utf-8`. 200 returns
 * `{ url, fileName, size }` (IngestUploadResponse); errors return `{ error: { code, message } }`.
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import type { ApiError, IngestUploadResponse } from "@/lib/ingest/ingest-types";
import {
  brokenJsonMessage,
  FILE_MESSAGES,
  MAX_TOPIC_BYTES,
  stripBom,
} from "@/lib/ingest/topic-file";

import { saveTopicJson, type SaveTopicJson } from "./save-topic-json";

export const INGEST_OBJECT_PREFIX = "topic-ingest/";
export const TOPIC_JSON_CONTENT_TYPE = "application/json; charset=utf-8";
/** Multipart framing adds little; a body far over the file limit is refused before it is parsed. */
export const MAX_REQUEST_BYTES = MAX_TOPIC_BYTES + 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
/** GCS bucket names: lowercase letters, digits, dots, dashes and underscores. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export const UPLOAD_MESSAGES = {
  missingFile: "Please choose your topic's .json file to upload.",
  notConfigured:
    "The platform isn't set up correctly yet. Please let the Cerebry team know.",
  storageUnavailable:
    "We can't save your upload right now. Please try again in a few minutes.",
  generic: "Something went wrong on our side. Please try again.",
} as const;

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Env = Record<string, string | undefined>;

export interface IngestUploadDeps {
  /** The storage write; the default writes to GCS. */
  save?: SaveTopicJson;
  /** Environment to read GCS_BUCKET_NAME from; the default is process.env. */
  env?: Env;
  /** Object id generator; the default is a random UUID. */
  newId?: () => string;
}

function apiError(
  status: number,
  code: string,
  message: string,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: NO_STORE },
  );
}

/** The file's own name, without any folder part, at most 255 characters. */
function baseName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  return Array.from(last.trim()).slice(0, MAX_FILE_NAME_LENGTH).join("");
}

function isUploadedFile(value: FormDataEntryValue | undefined): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as File).name === "string"
  );
}

export async function handleIngestUpload(
  request: Request,
  deps: IngestUploadDeps = {},
): Promise<Response> {
  const env = deps.env ?? process.env;
  const save = deps.save ?? saveTopicJson;
  const newId = deps.newId ?? randomUUID;

  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES)
      return apiError(413, "too_large", FILE_MESSAGES.tooLarge);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "missing_file", UPLOAD_MESSAGES.missingFile);
    }
    const entries = form.getAll("file");
    if (entries.length > 1)
      return apiError(400, "multiple_files", FILE_MESSAGES.oneFile);
    const file = entries[0];
    if (!isUploadedFile(file))
      return apiError(400, "missing_file", UPLOAD_MESSAGES.missingFile);

    const fileName = baseName(file.name);
    if (!fileName.toLowerCase().endsWith(".json"))
      return apiError(415, "not_json", FILE_MESSAGES.notJson);
    if (file.size > MAX_TOPIC_BYTES)
      return apiError(413, "too_large", FILE_MESSAGES.tooLarge);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_TOPIC_BYTES)
      return apiError(413, "too_large", FILE_MESSAGES.tooLarge);

    let text: string;
    try {
      text = stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return apiError(400, "invalid_json", brokenJsonMessage());
    }
    if (!text.trim()) return apiError(400, "empty", FILE_MESSAGES.empty);
    try {
      JSON.parse(text);
    } catch {
      return apiError(400, "invalid_json", brokenJsonMessage());
    }

    const bucket = env.GCS_BUCKET_NAME?.trim() ?? "";
    if (!BUCKET_NAME.test(bucket))
      return apiError(500, "not_configured", UPLOAD_MESSAGES.notConfigured);

    const objectName = `${INGEST_OBJECT_PREFIX}${newId()}.json`;
    const body = Buffer.from(text, "utf8");
    try {
      await save({
        bucket,
        objectName,
        body,
        contentType: TOPIC_JSON_CONTENT_TYPE,
      });
    } catch (error) {
      console.error(
        "[ingest-upload] storage write failed:",
        error instanceof Error ? error.message : String(error),
      );
      return apiError(
        503,
        "storage_unavailable",
        UPLOAD_MESSAGES.storageUnavailable,
      );
    }

    const response: IngestUploadResponse = {
      url: `https://storage.googleapis.com/${bucket}/${objectName}`,
      fileName,
      size: body.byteLength,
    };
    return NextResponse.json(response, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error(
      "[ingest-upload] unexpected error:",
      error instanceof Error ? error.message : String(error),
    );
    return apiError(500, "internal", UPLOAD_MESSAGES.generic);
  }
}
