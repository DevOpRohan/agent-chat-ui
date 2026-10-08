import { SignJWT } from "jose";

const RECEIPT_ISSUER = "agent-chat-ui/pdf-page-count";
const RECEIPT_AUDIENCE = "questioncrafter/pdf-page-count";
const RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;

function encodeObjectName(name: string) {
  return encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function generationPinnedGcsUrl(
  bucket: string,
  object: string,
  generation: unknown,
): string | undefined {
  if (typeof generation !== "string" || !/^[1-9]\d*$/.test(generation))
    return undefined;
  return `https://storage.googleapis.com/${bucket}/${encodeObjectName(object)}?generation=${generation}`;
}

function isCanonicalPinnedGcsUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.match(/^\/([^/]+)\/(.+)$/);
    if (!path || url.searchParams.size !== 1) return false;
    return (
      value ===
      generationPinnedGcsUrl(
        path[1],
        decodeURIComponent(path[2]),
        url.searchParams.get("generation"),
      )
    );
  } catch {
    return false;
  }
}

// The receipt is metadata only. A separate audience prevents use as an auth token.
export async function signPdfPageCountReceipt(
  pageCount: number,
  url: string,
  fileId?: string,
): Promise<string | undefined> {
  const secret = process.env.LANGGRAPH_AUTH_JWT_SECRET;
  if (
    !secret ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    !isCanonicalPinnedGcsUrl(url)
  )
    return undefined;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    purpose: "pdf-page-count",
    version: 1,
    page_count: pageCount,
    url,
    ...(fileId ? { file_id: fileId } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(RECEIPT_ISSUER)
    .setAudience(RECEIPT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + RECEIPT_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}
