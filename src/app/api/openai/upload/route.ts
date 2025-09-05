import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300; // allow long uploads

// Convert gs://bucket/object to https://storage.googleapis.com/bucket/object
function gsToHttps(gsUrl: string | undefined): string | undefined {
  if (!gsUrl) return undefined;
  if (!gsUrl.startsWith("gs://")) return gsUrl;
  const without = gsUrl.slice("gs://".length);
  const idx = without.indexOf("/");
  if (idx === -1) return undefined;
  const bucket = without.slice(0, idx);
  const object = without.slice(idx + 1);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url?: string;
      gcsUrl?: string;
      filename?: string;
      mime_type?: string;
      purpose?: string;
      expires_after?: { anchor?: string; seconds?: number };
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 },
      );
    }

    const MAX_BYTES = Number(process.env.OPENAI_UPLOAD_MAX_BYTES || 100 * 1024 * 1024); // 100MB

    const httpsUrl = body.url || gsToHttps(body.gcsUrl);
    if (!httpsUrl) {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    // Optional HEAD to check size early
    try {
      const head = await fetch(httpsUrl, { method: "HEAD" });
      const len = head.headers.get("content-length");
      if (len && Number(len) > MAX_BYTES) {
        return NextResponse.json(
          {
            error: "File too large",
            max_bytes: MAX_BYTES,
            content_length: Number(len),
          },
          { status: 413 },
        );
      }
    } catch {/* ignore */}

    // Download whole file into Buffer (simple and reliable for <= 100MB)
    const fileRes = await fetch(httpsUrl);
    if (!fileRes.ok) {
      const txt = await fileRes.text().catch(() => "");
      return NextResponse.json(
        { error: "Failed to fetch file", upstream_status: fileRes.status, upstream_body: txt },
        { status: 400 },
      );
    }
    const ab = await fileRes.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large", max_bytes: MAX_BYTES, content_length: ab.byteLength },
        { status: 413 },
      );
    }
    const buf = Buffer.from(ab);
    const contentType = body.mime_type || fileRes.headers.get("content-type") || "application/octet-stream";

    // Build multipart form using Web FormData/Blob
    const form = new FormData();
    form.append("purpose", body.purpose || process.env.OPENAI_FILES_PURPOSE || "assistants");
    const expAnchor = body.expires_after?.anchor ?? process.env.OPENAI_FILES_EXPIRES_AFTER_ANCHOR ?? "created_at";
    const expSeconds = body.expires_after?.seconds ?? (process.env.OPENAI_FILES_EXPIRES_AFTER_SECONDS ? Number(process.env.OPENAI_FILES_EXPIRES_AFTER_SECONDS) : 60 * 60 * 24 * 90);
    form.append("expires_after[anchor]", String(expAnchor));
    form.append("expires_after[seconds]", String(expSeconds));
    const blob = new Blob([buf], { type: contentType });
    form.append("file", blob, body.filename || "upload");

    const uploadRes = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await uploadRes.json();
    if (!uploadRes.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "Failed to upload to OpenAI", openai_status: uploadRes.status, openai_raw: data },
        { status: 500 },
      );
    }

    return NextResponse.json({
      file_id: data.id,
      filename: data.filename,
      bytes: data.bytes,
      purpose: data.purpose,
      created_at: data.created_at,
      expires_at: data.expires_at,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
