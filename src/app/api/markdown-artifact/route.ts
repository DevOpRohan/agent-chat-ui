import { isIP } from "node:net";

import { NextRequest, NextResponse } from "next/server";

const MAX_MARKDOWN_PREVIEW_BYTES = 512_000;

function buildTextResponse(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function isPrivateIpAddress(hostname: string): boolean {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [first, second] = hostname.split(".").map((part) => Number(part));
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

function isDisallowedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    isPrivateIpAddress(normalized)
  );
}

function normalizeMarkdownUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (isDisallowedHostname(parsed.hostname)) {
      return null;
    }

    if (!parsed.pathname.toLowerCase().endsWith(".md")) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const markdownUrl = normalizeMarkdownUrl(
    request.nextUrl.searchParams.get("url"),
  );

  if (!markdownUrl) {
    return buildTextResponse(
      "url must be a valid public HTTP(S) .md URL",
      400,
    );
  }

  let response: Response;
  try {
    response = await fetch(markdownUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/markdown, text/plain;q=0.9, */*;q=0.1",
      },
    });
  } catch {
    return buildTextResponse("Failed to fetch markdown artifact", 502);
  }

  if (!response.ok) {
    return buildTextResponse(
      `Markdown artifact request failed (${response.status})`,
      response.status >= 500 ? 502 : response.status,
    );
  }

  const resolvedUrl = normalizeMarkdownUrl(response.url || markdownUrl);
  if (!resolvedUrl) {
    return buildTextResponse("Resolved markdown artifact URL is invalid", 502);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_MARKDOWN_PREVIEW_BYTES
  ) {
    return buildTextResponse(
      "Markdown artifact is too large to preview in the artifact pane",
      413,
    );
  }

  const markdownText = await response.text();
  const markdownBytes = new TextEncoder().encode(markdownText).length;
  if (markdownBytes > MAX_MARKDOWN_PREVIEW_BYTES) {
    return buildTextResponse(
      "Markdown artifact is too large to preview in the artifact pane",
      413,
    );
  }

  if (!markdownText.trim()) {
    return buildTextResponse("Markdown artifact is empty", 422);
  }

  return new NextResponse(markdownText, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
