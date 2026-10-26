/**
 * Links and file names for an ingest's downloads.
 *
 * The topic `.json` and `.md` the graph saved are on Google Cloud Storage (the uploaded file) or on
 * the backend's artifacts storage (S3 by default: the files the fixer changed). The browser never
 * fetches them itself: it links to the app's own `/api/topic-file` route, which fetches only
 * allow-listed links (host and bucket, see `src/app/api/topic-file/guards.ts`), caps the size and
 * returns an attachment with the given name. `isTopicFileUrl` is the browser's half of that
 * allow-list, with the route's default hosts: a link that fails it is never offered. Buckets are
 * checked only on the server, where they are configured.
 *
 * The report for the creator's assistant is made in the browser from the record's Markdown, with
 * no server call. File names match the standalone topic-ingester app: `<downloadName>.json`,
 * `<downloadName>.md` and `<downloadName>_report.md`, where `downloadName` comes from
 * `downloadBaseName` in topic-file.ts.
 */

/**
 * Hosts the topic files may come from, as in the route's default `TOPIC_JSON_ALLOWED_HOSTS`: an
 * exact host, or `.suffix` for any host under it. Default https port only.
 */
export const TOPIC_FILE_HOSTS: readonly string[] = [
  "storage.googleapis.com",
  ".amazonaws.com",
];

function hostAllowed(host: string): boolean {
  return TOPIC_FILE_HOSTS.some((allowed) =>
    allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed,
  );
}

/**
 * True for an `https` link to a `.json` or `.md` file on an allowed storage host, with no user
 * name or password.
 */
export function isTopicFileUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  // `host` carries a non-default port, so "storage.googleapis.com:8443" is refused.
  if (!hostAllowed(parsed.host.toLowerCase())) return false;
  return /\.(json|md)$/i.test(parsed.pathname);
}

/** Same-origin download link for a topic file: `/api/topic-file?url=…&name=…`. */
export function topicFileHref(url: string, fileName: string): string {
  return `/api/topic-file?url=${encodeURIComponent(url)}&name=${encodeURIComponent(fileName)}`;
}

/** `<downloadName>.json` or `<downloadName>.md`, as the standalone app named the topic files. */
export function topicFileName(
  downloadName: string,
  kind: "json" | "md",
): string {
  return `${downloadName}.${kind}`;
}

/** `<downloadName>_report.md`, as the standalone app named the report for the assistant. */
export function reportFileName(downloadName: string): string {
  return `${downloadName}_report.md`;
}

/**
 * Saves text as a file in the browser (a Blob behind a temporary `<a download>`). Returns false,
 * doing nothing, where there is no document (server rendering).
 */
export function downloadTextFile(
  text: string,
  fileName: string,
  type = "text/markdown;charset=utf-8",
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined")
    return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}
