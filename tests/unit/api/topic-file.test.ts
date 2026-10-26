import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/topic-file/route";
import {
  bucketOf,
  checkTopicFileUrl,
  contentDisposition,
  DEFAULT_ALLOWED_BUCKETS,
  downloadFileName,
  loadTopicFileConfig,
  MAX_TOPIC_FILE_BYTES,
} from "@/app/api/topic-file/guards";

const BUCKET = "question_crafter_public";
const JSON_URL = `https://storage.googleapis.com/${BUCKET}/topic-ingest/0b6c2f0e-6f4e-4a1e-9d55-3d3f1c1a2b3c.json`;
const S3_JSON_URL =
  "https://transferredv2-cerebry-ai-topic-jsons.s3.ap-southeast-1.amazonaws.com/topic_import_abc.json";
const S3_MD_URL =
  "https://transferredv2-cerebry-ai-topic-jsons.s3.ap-southeast-1.amazonaws.com/topic_import_abc.md";
const TOPIC = '{"topic_name":"Photosynthesis (Grade 8)","cts":[]}';

const fetchMock = vi.fn<typeof fetch>();

function call(url: string | undefined, name?: string) {
  const params = new URLSearchParams();
  if (url !== undefined) params.set("url", url);
  if (name !== undefined) params.set("name", name);
  return GET(new Request(`http://app.test/api/topic-file?${params}`));
}

async function errorOf(response: Response) {
  return (
    (await response.json()) as { error: { code: string; message: string } }
  ).error;
}

beforeEach(() => {
  vi.stubEnv("GCS_BUCKET_NAME", BUCKET);
  vi.stubEnv("TOPIC_JSON_ALLOWED_HOSTS", "");
  vi.stubEnv("TOPIC_JSON_ALLOWED_BUCKETS", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(
    async () => new Response(TOPIC, { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("GET /api/topic-file", () => {
  it("sends an allowed .json as an attachment named after the topic", async () => {
    const response = await call(JSON_URL, "photosynthesis_grade_8.json");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(JSON_URL);
    expect(init).toMatchObject({ redirect: "manual", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"photosynthesis_grade_8.json\"; filename*=UTF-8''photosynthesis_grade_8.json",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(
      String(Buffer.byteLength(TOPIC)),
    );
    expect(await response.text()).toBe(TOPIC);
  });

  it("sends an allowed .md from the backend's topic bucket as Markdown", async () => {
    fetchMock.mockResolvedValue(
      new Response("# Topic: Photosynthesis (Grade 8)\n", { status: 200 }),
    );
    const response = await call(S3_MD_URL, "photosynthesis_grade_8");
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(S3_MD_URL);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toContain(
      'filename="photosynthesis_grade_8.md"',
    );
    expect(await response.text()).toBe("# Topic: Photosynthesis (Grade 8)\n");
  });

  it("gives the file the link's extension, whatever the name says", async () => {
    fetchMock.mockImplementation(
      async () => new Response("# T\n", { status: 200 }),
    );
    const md = await call(S3_MD_URL, "photosynthesis_grade_8.json");
    expect(md.headers.get("content-disposition")).toContain(
      'filename="photosynthesis_grade_8.md"',
    );
    const json = await call(S3_JSON_URL, "notes.exe");
    expect(json.headers.get("content-disposition")).toContain(
      'filename="notes.exe.json"',
    );
  });

  it("names the file after the link when no name is given", async () => {
    const response = await call(S3_JSON_URL);
    expect(response.headers.get("content-disposition")).toContain(
      'filename="topic_import_abc.json"',
    );
  });

  it.each([
    ["plain http", JSON_URL.replace("https:", "http:")],
    ["another host", "https://evil.example.com/question_crafter_public/t.json"],
    [
      "a look-alike host",
      `https://storage.googleapis.com.evil.example/${BUCKET}/t.json`,
    ],
    ["another bucket", "https://storage.googleapis.com/someone-else/t.json"],
    [
      "another S3 bucket",
      "https://attacker-bucket.s3.ap-southeast-1.amazonaws.com/t.json",
    ],
    [
      "a non-storage AWS host with an allowed bucket in its path",
      "https://abc123.execute-api.us-east-1.amazonaws.com/transferredv2-cerebry-ai-topic-jsons/t.json",
    ],
    ["the bucket with no object", `https://storage.googleapis.com/${BUCKET}/`],
    [
      "credentials in the URL",
      `https://user:pass@storage.googleapis.com/${BUCKET}/t.json`,
    ],
    ["a port", `https://storage.googleapis.com:8443/${BUCKET}/t.json`],
    [
      "a file that isn't .json or .md",
      `https://storage.googleapis.com/${BUCKET}/t.pdf`,
    ],
    [
      "a .json only in the query",
      `https://storage.googleapis.com/${BUCKET}/t?x=.json`,
    ],
    ["the metadata server", "http://169.254.169.254/computeMetadata/v1/a.json"],
    ["a non-http scheme", "file:///etc/passwd.json"],
    ["a gs:// link", `gs://${BUCKET}/topic-ingest/a.json`],
  ])("refuses %s without fetching anything", async (_label, url) => {
    const response = await call(url, "topic.json");
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("blocked_url");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no link", undefined],
    ["a blank link", "   "],
    ["a link that is too long", `${JSON_URL}?${"a".repeat(5000)}`],
  ])("is bad_url for %s, without fetching anything", async (_label, url) => {
    const response = await call(url);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("bad_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows no redirect", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    const response = await call(JSON_URL);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe("redirect_refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer from a URL that isn't allowed", async () => {
    const answer = new Response(TOPIC, { status: 200 });
    Object.defineProperty(answer, "url", {
      value: "https://evil.example.com/t.json",
    });
    fetchMock.mockResolvedValue(answer);
    const response = await call(JSON_URL);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe("redirect_refused");
  });

  it("refuses a file declared over 25 MB", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(MAX_TOPIC_FILE_BYTES + 1) },
      }),
    );
    const response = await call(JSON_URL);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("too_large");
  });

  it("stops reading a file that streams past 25 MB", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent > 40) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const response = await call(JSON_URL);
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe("too_large");
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(27);
  });

  it.each([403, 404, 410])(
    "is not_found when storage says %i",
    async (status) => {
      fetchMock.mockResolvedValue(new Response("no", { status }));
      const response = await call(JSON_URL);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toEqual({
        code: "not_found",
        message: "This topic file isn't available to download.",
      });
    },
  );

  it("reports other storage failures plainly", async () => {
    fetchMock.mockImplementation(
      async () => new Response("nope", { status: 500 }),
    );
    const failed = await call(JSON_URL);
    expect(failed.status).toBe(502);
    expect((await errorOf(failed)).message).toMatch(
      /couldn't fetch your topic file/,
    );

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const unreachable = await call(JSON_URL);
    expect(unreachable.status).toBe(502);
    expect((await errorOf(unreachable)).code).toBe("download_failed");
  });
});

describe("loadTopicFileConfig", () => {
  it("allows GCS and S3 hosts, the backend's topic bucket and the upload bucket by default", () => {
    expect(loadTopicFileConfig({ GCS_BUCKET_NAME: BUCKET })).toEqual({
      allowedHosts: ["storage.googleapis.com", ".amazonaws.com"],
      allowedBuckets: [...DEFAULT_ALLOWED_BUCKETS, BUCKET],
    });
  });

  it("reads comma lists, and always keeps the upload bucket", () => {
    expect(
      loadTopicFileConfig({
        GCS_BUCKET_NAME: BUCKET,
        TOPIC_JSON_ALLOWED_HOSTS: " Storage.googleapis.com ,, ",
        TOPIC_JSON_ALLOWED_BUCKETS: "core2-public, other",
      }),
    ).toEqual({
      allowedHosts: ["storage.googleapis.com"],
      allowedBuckets: ["core2-public", "other", BUCKET],
    });
  });

  it("can turn S3 off", async () => {
    vi.stubEnv("TOPIC_JSON_ALLOWED_HOSTS", "storage.googleapis.com");
    const response = await call(S3_JSON_URL);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("checkTopicFileUrl", () => {
  const config = {
    allowedHosts: [
      "storage.googleapis.com",
      ".amazonaws.com",
      "files.example.org",
    ],
    allowedBuckets: [BUCKET, "transferredv2-cerebry-ai-topic-jsons"],
  };

  it("reads the bucket of each storage URL style", () => {
    const bucket = (url: string) => bucketOf(new URL(url), config.allowedHosts);
    expect(bucket(JSON_URL)).toBe(BUCKET);
    expect(bucket(S3_JSON_URL)).toBe("transferredv2-cerebry-ai-topic-jsons");
    expect(bucket("https://b.s3.amazonaws.com/k.json")).toBe("b");
    expect(bucket("https://s3.ap-southeast-1.amazonaws.com/b/k.json")).toBe(
      "b",
    );
    expect(bucket("https://b.storage.googleapis.com/k.json")).toBe("b");
    expect(bucket("https://files.example.org/b/k.json")).toBe("b");
    expect(
      bucket("https://x.execute-api.us-east-1.amazonaws.com/b/k.json"),
    ).toBeNull();
    expect(
      bucket("https://b.s3-website-us-east-1.amazonaws.com/k.json"),
    ).toBeNull();
  });

  it("keeps the query (object versions) and drops the fragment", () => {
    const checked = checkTopicFileUrl(`${S3_JSON_URL}?versionId=abc#x`, config);
    expect(checked?.url.toString()).toBe(`${S3_JSON_URL}?versionId=abc`);
    expect(checked?.kind).toBe("json");
  });

  it("allows a listed host:port exactly", () => {
    const local = { allowedHosts: ["127.0.0.1:28190"], allowedBuckets: ["b"] };
    expect(
      checkTopicFileUrl("https://127.0.0.1:28190/b/t.md", local)?.kind,
    ).toBe("md");
    expect(
      checkTopicFileUrl("https://127.0.0.1:8080/b/t.md", local),
    ).toBeNull();
    expect(
      checkTopicFileUrl("http://127.0.0.1:28190/b/t.md", local),
    ).toBeNull();
  });
});

describe("attachment names", () => {
  const url = new URL(JSON_URL);

  it("builds a safe Content-Disposition", () => {
    expect(contentDisposition('a"b.json')).toBe(
      "attachment; filename=\"a_b.json\"; filename*=UTF-8''a%22b.json",
    );
    expect(contentDisposition("Topic (v2)'s.json")).toBe(
      "attachment; filename=\"Topic__v2__s.json\"; filename*=UTF-8''Topic%20%28v2%29%27s.json",
    );
  });

  it("drops folders, control and direction characters, and hidden-file dots", () => {
    expect(downloadFileName("../../etc/passwd", url, "json")).toBe(
      "passwd.json",
    );
    expect(downloadFileName("a\r\nb‮gnp.json", url, "json")).toBe("abgnp.json");
    expect(downloadFileName("...env", url, "md")).toBe("env.md");
    expect(downloadFileName("Fotosíntesis (8º)", url, "md")).toBe(
      "Fotosíntesis (8º).md",
    );
  });

  it("falls back to the link's name, then to 'topic'", () => {
    expect(downloadFileName("  ", url, "json")).toBe(
      "0b6c2f0e-6f4e-4a1e-9d55-3d3f1c1a2b3c.json",
    );
    expect(downloadFileName("", new URL("https://h/b/.json"), "json")).toBe(
      "topic.json",
    );
  });

  it("keeps names to 120 characters", () => {
    expect(downloadFileName("x".repeat(500), url, "json")).toBe(
      `${"x".repeat(120)}.json`,
    );
  });
});
