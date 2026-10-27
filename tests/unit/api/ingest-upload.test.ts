import http from "node:http";
import https from "node:https";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleIngestUpload,
  MAX_REQUEST_BYTES,
  UPLOAD_MESSAGES,
} from "@/app/api/ingest/upload/handler";
import type { TopicJsonObject } from "@/app/api/ingest/upload/save-topic-json";
import { FILE_MESSAGES, MAX_TOPIC_BYTES } from "@/lib/ingest/topic-file";

/** What the fake GCS client received (the real route, with only @google-cloud/storage faked). */
const gcsWrites: {
  bucket: string;
  object: string;
  body: Buffer;
  options: Record<string, unknown>;
}[] = [];

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket(bucket: string) {
      return {
        file(object: string) {
          return {
            save: async (body: Buffer, options: Record<string, unknown>) => {
              gcsWrites.push({ bucket, object, body, options });
            },
          };
        },
      };
    }
  },
}));

const { POST } = await import("@/app/api/ingest/upload/route");

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ROUTE_DIR = path.join(ROOT, "src/app/api/ingest/upload");
const BUCKET = "question_crafter_public";
const TOPIC =
  '{"topic_name":"Photosynthesis (Grade 8)","cts":[{"ct_key":"a"}]}';
const OBJECT_NAME =
  /^topic-ingest\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

function uploadRequest(
  files: { content: BlobPart; name: string; type?: string }[],
  init: { headers?: Record<string, string> } = {},
): Request {
  const form = new FormData();
  for (const file of files)
    form.append(
      "file",
      new File([file.content], file.name, {
        type: file.type ?? "application/json",
      }),
    );
  return new Request("http://app.test/api/ingest/upload", {
    method: "POST",
    body: form,
    headers: init.headers,
  });
}

function fakeSave() {
  const saved: TopicJsonObject[] = [];
  const save = vi.fn(async (object: TopicJsonObject) => {
    saved.push(object);
  });
  return { saved, save };
}

async function errorOf(response: Response) {
  return (
    (await response.json()) as { error: { code: string; message: string } }
  ).error;
}

const env = { GCS_BUCKET_NAME: BUCKET };

describe("POST /api/ingest/upload", () => {
  it("saves the topic as topic-ingest/<uuid>.json and returns its storage link", async () => {
    const { saved, save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content: TOPIC, name: "photosynthesis_grade_8.json" }]),
      { save, env },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      url: string;
      fileName: string;
      size: number;
    };

    expect(saved).toHaveLength(1);
    const [object] = saved;
    expect(object!.bucket).toBe(BUCKET);
    expect(object!.objectName).toMatch(OBJECT_NAME);
    expect(object!.contentType).toBe("application/json; charset=utf-8");
    expect(object!.body.toString("utf8")).toBe(TOPIC);
    expect(body).toEqual({
      url: `https://storage.googleapis.com/${BUCKET}/${object!.objectName}`,
      fileName: "photosynthesis_grade_8.json",
      size: Buffer.byteLength(TOPIC),
    });
  });

  it("gives every upload its own object", async () => {
    const { saved, save } = fakeSave();
    for (let i = 0; i < 2; i++)
      await handleIngestUpload(
        uploadRequest([{ content: TOPIC, name: "t.json" }]),
        { save, env },
      );
    expect(saved[0]!.objectName).not.toBe(saved[1]!.objectName);
  });

  it("accepts .JSON in any case and drops a leading byte order mark", async () => {
    const { saved, save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content: `\uFEFF${TOPIC}`, name: "Topic.JSON" }]),
      { save, env },
    );
    expect(response.status).toBe(200);
    expect(saved[0]!.body.toString("utf8")).toBe(TOPIC);
    expect(saved[0]!.body[0]).toBe(0x7b); // "{"
  });

  it("keeps only the file's own name", async () => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content: TOPIC, name: "C:\\Users\\me\\topic.json" }]),
      { save, env },
    );
    expect(((await response.json()) as { fileName: string }).fileName).toBe(
      "topic.json",
    );
  });

  it("refuses the .md with the plain 'upload the .json' message", async () => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([
        {
          content: "# Topic: Photosynthesis\n",
          name: "photosynthesis_grade_8.md",
          type: "text/markdown",
        },
      ]),
      { save, env },
    );
    expect(response.status).toBe(415);
    expect(await errorOf(response)).toEqual({
      code: "not_json",
      message: FILE_MESSAGES.notJson,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a file over 10 MB", async () => {
    const { save } = fakeSave();
    const big = `{"x":"${"a".repeat(MAX_TOPIC_BYTES)}"}`;
    const response = await handleIngestUpload(
      uploadRequest([{ content: big, name: "big.json" }]),
      { save, env },
    );
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toEqual({
      code: "too_large",
      message: FILE_MESSAGES.tooLarge,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses a body declared far over the limit before reading it", async () => {
    const { save } = fakeSave();
    const request = new Request("http://app.test/api/ingest/upload", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(MAX_REQUEST_BYTES + 1) },
    });
    const formData = vi.spyOn(request, "formData");
    const response = await handleIngestUpload(request, { save, env });
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  /**
   * A multipart upload sent as a chunked stream: no Content-Length, like a client that streams its
   * body. `pulled` counts the bytes the route asked for.
   */
  function chunkedUpload(parts: { name: string; size: number }) {
    const boundary = "----e2e-chunked-boundary";
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${parts.name}"\r\n` +
        "Content-Type: application/json\r\n\r\n",
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    const chunk = 64 * 1024;
    const state = { pulled: 0, cancelled: false };
    let sent = 0;
    let stage: "head" | "file" | "tail" | "done" = "head";
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        let piece: Uint8Array;
        if (stage === "head") {
          piece = head;
          stage = "file";
        } else if (stage === "file") {
          const size = Math.min(chunk, parts.size - sent);
          piece = new Uint8Array(size).fill(0x20);
          if (sent === 0) piece[0] = 0x7b; // "{"
          sent += size;
          if (sent >= parts.size) {
            piece[size - 1] = 0x7d; // "}"
            stage = "tail";
          }
        } else if (stage === "tail") {
          piece = tail;
          stage = "done";
        } else {
          controller.close();
          return;
        }
        state.pulled += piece.byteLength;
        controller.enqueue(piece);
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const request = new Request("http://app.test/api/ingest/upload", {
      method: "POST",
      body: stream,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return { request, state };
  }

  it("refuses a chunked body without Content-Length once it passes the limit, without reading on", async () => {
    const { save } = fakeSave();
    const { request, state } = chunkedUpload({
      name: "huge.json",
      size: 50 * 1024 * 1024,
    });
    expect(request.headers.get("content-length")).toBeNull();
    const response = await handleIngestUpload(request, { save, env });
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toEqual({
      code: "too_large",
      message: FILE_MESSAGES.tooLarge,
    });
    // It stopped right after the limit (one chunk over at most), instead of buffering 50 MB.
    expect(state.pulled).toBeGreaterThan(MAX_REQUEST_BYTES);
    expect(state.pulled).toBeLessThanOrEqual(MAX_REQUEST_BYTES + 128 * 1024);
    expect(state.cancelled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("takes a chunked body without Content-Length within the limit", async () => {
    const { saved, save } = fakeSave();
    const { request } = chunkedUpload({ name: "streamed.json", size: 300_000 });
    expect(request.headers.get("content-length")).toBeNull();
    const response = await handleIngestUpload(request, { save, env });
    expect(response.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body.byteLength).toBe(300_000);
  });

  it("counts the bytes even when Content-Length understates them", async () => {
    const { save } = fakeSave();
    const { request: streamed } = chunkedUpload({
      name: "huge.json",
      size: MAX_REQUEST_BYTES + 1,
    });
    const request = new Request(streamed, {
      headers: {
        "content-type": streamed.headers.get("content-type")!,
        "content-length": "1000",
      },
    });
    expect(request.headers.get("content-length")).toBe("1000");
    const response = await handleIngestUpload(request, { save, env });
    expect(response.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", '{"topic_name": "x",}'],
    ["Markdown renamed to .json", "# Topic: Photosynthesis\n"],
    ["bytes that aren't UTF-8", new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])],
  ])("refuses %s", async (_label, content) => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content, name: "topic.json" }]),
      { save, env },
    );
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("invalid_json");
    expect(error.message).toMatch(/formatting mistake/);
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses an empty file", async () => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content: "  \n", name: "topic.json" }]),
      { save, env },
    );
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      code: "empty",
      message: FILE_MESSAGES.empty,
    });
  });

  it("needs a file", async () => {
    const { save } = fakeSave();
    const form = new FormData();
    form.append("file", "not a file");
    const noFile = await handleIngestUpload(
      new Request("http://app.test/api/ingest/upload", {
        method: "POST",
        body: form,
      }),
      { save, env },
    );
    expect(noFile.status).toBe(400);
    expect((await errorOf(noFile)).code).toBe("missing_file");

    const notMultipart = await handleIngestUpload(
      new Request("http://app.test/api/ingest/upload", {
        method: "POST",
        body: TOPIC,
        headers: { "content-type": "application/json" },
      }),
      { save, env },
    );
    expect(notMultipart.status).toBe(400);
    expect(await errorOf(notMultipart)).toEqual({
      code: "missing_file",
      message: UPLOAD_MESSAGES.missingFile,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("takes one file at a time", async () => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([
        { content: TOPIC, name: "a.json" },
        { content: TOPIC, name: "b.json" },
      ]),
      { save, env },
    );
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      code: "multiple_files",
      message: FILE_MESSAGES.oneFile,
    });
  });

  it.each([
    ["missing", {}],
    ["blank", { GCS_BUCKET_NAME: "  " }],
    ["not a bucket name", { GCS_BUCKET_NAME: "gs://bucket/path" }],
  ])("is not_configured when the bucket is %s", async (_label, badEnv) => {
    const { save } = fakeSave();
    const response = await handleIngestUpload(
      uploadRequest([{ content: TOPIC, name: "topic.json" }]),
      { save, env: badEnv },
    );
    expect(response.status).toBe(500);
    expect(await errorOf(response)).toEqual({
      code: "not_configured",
      message: UPLOAD_MESSAGES.notConfigured,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("says storage is unavailable when the write fails, without details", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const save = vi.fn(async () => {
      throw new Error("403 caller does not have storage.objects.create access");
    });
    const response = await handleIngestUpload(
      uploadRequest([{ content: TOPIC, name: "topic.json" }]),
      { save, env },
    );
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toEqual({
      code: "storage_unavailable",
      message: UPLOAD_MESSAGES.storageUnavailable,
    });
    consoleError.mockRestore();
  });
});

describe("the ingest upload never reaches OpenAI", () => {
  const outbound: string[] = [];

  beforeEach(() => {
    gcsWrites.length = 0;
    outbound.length = 0;
    // Settings that make the chat's /api/upload call OpenAI Files: they must change nothing here.
    vi.stubEnv("GCS_BUCKET_NAME", BUCKET);
    vi.stubEnv("MODEL_PROVIDER", "OPENAI");
    vi.stubEnv("NEXT_PUBLIC_MODEL_PROVIDER", "OPENAI");
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-a-real-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          input instanceof Request ? input.url : String(input as URL | string);
        outbound.push(url);
        if (url.includes("api.openai.com"))
          throw new Error(`request to OpenAI during an ingest upload: ${url}`);
        return new Response("{}", { status: 200 });
      }),
    );
    const record =
      (original: typeof https.request) =>
      (...args: unknown[]) => {
        const [first] = args;
        const target =
          typeof first === "string" || first instanceof URL
            ? String(first)
            : String(
                (first as { hostname?: string; host?: string })?.hostname ??
                  (first as { host?: string })?.host,
              );
        outbound.push(target);
        return (original as (...a: unknown[]) => http.ClientRequest)(...args);
      };
    vi.spyOn(https, "request").mockImplementation(
      record(https.request) as typeof https.request,
    );
    vi.spyOn(http, "request").mockImplementation(
      record(http.request) as typeof http.request,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the file in GCS and sends no request to api.openai.com", async () => {
    const response = await POST(
      uploadRequest([{ content: TOPIC, name: "photosynthesis_grade_8.json" }]),
    );
    expect(response.status).toBe(200);
    expect(outbound.filter((url) => url.includes("api.openai.com"))).toEqual(
      [],
    );
    // Nothing leaves the server at all except the (faked) GCS write.
    expect(outbound).toEqual([]);
    expect(gcsWrites).toHaveLength(1);
    expect(gcsWrites[0]).toMatchObject({
      bucket: BUCKET,
      options: {
        contentType: "application/json; charset=utf-8",
        resumable: false,
      },
    });
    expect(gcsWrites[0]!.object).toMatch(OBJECT_NAME);
    const body = (await response.json()) as { url: string };
    expect(body.url).toBe(
      `https://storage.googleapis.com/${BUCKET}/${gcsWrites[0]!.object}`,
    );
  });

  it("returns no OpenAI file id, whatever the settings", async () => {
    const response = await POST(
      uploadRequest([{ content: TOPIC, name: "topic.json" }]),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["fileName", "size", "url"]);
  });

  it("has no OpenAI code path in its source", () => {
    const files = readdirSync(ROUTE_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual([
      "handler.ts",
      "route.ts",
      "save-topic-json.ts",
    ]);
    // The route's own files, and every app module they load at run time (type-only imports
    // are erased by the compiler, so they carry no code).
    const sources = files.map((f) => path.join(ROUTE_DIR, f));
    for (const file of [...sources]) {
      const text = readFileSync(file, "utf8");
      for (const [, spec] of text.matchAll(
        /import\s+(?!type\b)[^;]*?from\s+"(@\/[^"]+)"/g,
      ))
        sources.push(path.join(ROOT, "src", `${spec!.slice(2)}.ts`));
    }
    expect(sources.map((f) => path.relative(ROOT, f)).sort()).toEqual([
      "src/app/api/ingest/upload/handler.ts",
      "src/app/api/ingest/upload/route.ts",
      "src/app/api/ingest/upload/save-topic-json.ts",
      "src/lib/ingest/topic-file.ts",
    ]);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/openai/i);
      expect(text, file).not.toMatch(/OPENAI_|MODEL_PROVIDER|\/api\/openai/);
      // No HTTP calls of its own: the only thing that leaves the server is the GCS write.
      expect(text, file).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
