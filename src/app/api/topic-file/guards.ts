/**
 * Guards of GET /api/topic-file: which links the server may fetch, and how the attachment is
 * named. Ported from topic-ingester's src/server/topic-download.ts (hosts, no user info, no
 * redirects, 30 s, 25 MB) and /api/markdown-artifact (re-check the resolved URL), plus a bucket
 * allow-list, so the route can't be used to make the server fetch arbitrary URLs (SSRF).
 *
 * A link is accepted only when all of these hold:
 *   - https, no user name or password, at most 4096 characters;
 *   - the host matches TOPIC_JSON_ALLOWED_HOSTS (exact host, ".suffix", or "host:port");
 *   - the bucket is GCS_BUCKET_NAME or one of TOPIC_JSON_ALLOWED_BUCKETS. The bucket is the first
 *     path segment (storage.googleapis.com/<bucket>/..., S3 path style, a host listed exactly), or
 *     the host's first part for virtual-hosted S3 (<bucket>.s3.<region>.amazonaws.com) and GCS
 *     (<bucket>.storage.googleapis.com);
 *   - the path ends in .json or .md (that also picks the attachment's type and extension).
 */

/** Topic files are at most 10 MB; a fixed copy may be pretty-printed, so allow some room. */
export const MAX_TOPIC_FILE_BYTES = 25 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_URL_LENGTH = 4096;

/**
 * Storage hosts the topic files may come from: GCS (the uploaded file, kept by a valid topic) and
 * S3 (where the backend's artifacts lane saves fixed topics and their .md). Same default as the
 * standalone app's TOPIC_JSON_ALLOWED_HOSTS. A host passes only together with an allowed bucket.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = [
  "storage.googleapis.com",
  ".amazonaws.com",
];

/** The backend's public topic bucket (S3, ap-southeast-1). GCS_BUCKET_NAME is always added. */
export const DEFAULT_ALLOWED_BUCKETS: readonly string[] = [
  "transferredv2-cerebry-ai-topic-jsons",
];

export interface TopicFileConfig {
  allowedHosts: string[];
  allowedBuckets: string[];
}

type Env = Record<string, string | undefined>;

function list(value: string | undefined): string[] | undefined {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** Read at request time, so one image serves every environment. */
export function loadTopicFileConfig(env: Env = process.env): TopicFileConfig {
  const allowedHosts = list(env.TOPIC_JSON_ALLOWED_HOSTS) ?? [
    ...DEFAULT_ALLOWED_HOSTS,
  ];
  const buckets = new Set(
    list(env.TOPIC_JSON_ALLOWED_BUCKETS) ?? DEFAULT_ALLOWED_BUCKETS,
  );
  const uploadBucket = env.GCS_BUCKET_NAME?.trim().toLowerCase();
  if (uploadBucket) buckets.add(uploadBucket);
  return { allowedHosts, allowedBuckets: [...buckets] };
}

export function hostAllowed(url: URL, rules: readonly string[]): boolean {
  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase(); // with the port, if any
  return rules.some((rule) => {
    if (rule.startsWith("."))
      return (
        hostname.endsWith(rule) &&
        hostname.length > rule.length &&
        url.port === ""
      );
    return rule.includes(":")
      ? host === rule
      : hostname === rule && url.port === "";
  });
}

const S3_HOST =
  /^(?:(.+)\.)?s3(?:[.-](?!website)(?:dualstack\.)?[a-z0-9-]+)?\.amazonaws\.com$/;
const GCS_VIRTUAL_HOST = /^(.+)\.storage\.googleapis\.com$/;

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").slice(1);
}

/** `/<bucket>/<key...>` → the bucket, when there is a key after it. */
function bucketFromPath(url: URL): string | null {
  const [first, ...rest] = pathSegments(url);
  if (!first || !rest.join("/")) return null;
  try {
    return decodeURIComponent(first);
  } catch {
    return null;
  }
}

/**
 * The storage bucket a link points into, or null when it has none. GCS and S3 hosts are read by
 * their own URL styles. Any other host is read as `/<bucket>/<key>` only when it is listed exactly
 * in `rules` (a host matched by a ".suffix" rule alone, such as an API Gateway host under
 * .amazonaws.com, is not storage and has no bucket).
 */
export function bucketOf(
  url: URL,
  rules: readonly string[] = [],
): string | null {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "storage.googleapis.com") return bucketFromPath(url);
  const s3 = S3_HOST.exec(hostname);
  if (s3 && !s3[1]) return bucketFromPath(url);
  const virtualBucket = s3 ? s3[1] : GCS_VIRTUAL_HOST.exec(hostname)?.[1];
  if (virtualBucket) return pathSegments(url).join("/") ? virtualBucket : null;
  const listedExactly = rules.some(
    (rule) => !rule.startsWith(".") && hostAllowed(url, [rule]),
  );
  return listedExactly ? bucketFromPath(url) : null;
}

export type TopicFileKind = "json" | "md";

export const TOPIC_FILE_TYPES = {
  json: {
    contentType: "application/json; charset=utf-8",
    accept: "application/json",
  },
  md: {
    contentType: "text/markdown; charset=utf-8",
    accept: "text/markdown, text/plain",
  },
} as const;

export interface AllowedTopicFile {
  url: URL;
  kind: TopicFileKind;
  bucket: string;
}

/** The link, parsed, when it is safe to fetch; else null. */
export function checkTopicFileUrl(
  raw: unknown,
  config: TopicFileConfig,
): AllowedTopicFile | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!hostAllowed(url, config.allowedHosts)) return null;
  const bucket = bucketOf(url, config.allowedHosts);
  if (!bucket || !config.allowedBuckets.includes(bucket)) return null;
  const path = url.pathname.toLowerCase();
  const kind: TopicFileKind | null = path.endsWith(".json")
    ? "json"
    : path.endsWith(".md")
      ? "md"
      : null;
  if (!kind) return null;
  url.hash = "";
  return { url, kind, bucket };
}

// Control characters, characters that file systems refuse, and bidirectional overrides
// (which can make "evil.exe" look like "exe.json").
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f"*/:<>?\\|‎‏‪-‮⁦-⁩]/g;
const MAX_NAME_LENGTH = 120;

function cleanStem(raw: string | null | undefined): string {
  if (!raw) return "";
  let stem = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
  stem = stem.replace(UNSAFE_NAME_CHARS, "").trim();
  stem = stem.replace(/\.(json|md)$/i, "");
  stem = stem.replace(/^\.+/, "").replace(/[.\s]+$/, "");
  return Array.from(stem).slice(0, MAX_NAME_LENGTH).join("").trim();
}

function lastSegment(url: URL): string {
  const last = pathSegments(url).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * The attachment's name: `name` when given (else the link's file name, else "topic"), made safe,
 * with the extension of the link's type (`.json` or `.md`).
 */
export function downloadFileName(
  name: string | null | undefined,
  url: URL,
  kind: TopicFileKind,
): string {
  const stem = cleanStem(name) || cleanStem(lastSegment(url)) || "topic";
  return `${stem}.${kind}`;
}

/** `attachment` with an ASCII fallback name and the exact UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export class TooLargeError extends Error {
  constructor() {
    super("topic file is over the size cap");
    this.name = "TooLargeError";
  }
}

/** The body, read up to `cap` bytes; throws TooLargeError past it (declared or streamed). */
export async function readCapped(
  response: Response,
  cap: number = MAX_TOPIC_FILE_BYTES,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => undefined);
    throw new TooLargeError();
  }
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.byteLength > cap) throw new TooLargeError();
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
