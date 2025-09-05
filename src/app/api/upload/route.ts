import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";
// Use Web FormData/Blob from undici (built-in in Next.js node runtime)

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
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
    const size = (file as any).size as number | undefined;
    if (typeof size === "number" && size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large", max_bytes: MAX_BYTES, content_length: size },
        { status: 413 },
      );
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { error: "Bucket not configured" },
        { status: 500 },
      );
    }

    // Read once into memory (<= 100MB) so we can both upload to GCS and optionally OpenAI
    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        {
          error: "File too large",
          max_bytes: MAX_BYTES,
          content_length: arrayBuffer.byteLength,
        },
        { status: 413 },
      );
    }
    const buf = Buffer.from(arrayBuffer);

    const storage = new Storage();
    const filename = `${uuidv4()}-${file.name}`;
    const gcsFile = storage.bucket(bucketName).file(filename);
    // Simple upload via save() using the in-memory buffer
    await gcsFile.save(buf, {
      contentType: file.type || "application/octet-stream",
      resumable: false,
      // Do not set object ACLs when Uniform Bucket-Level Access is enabled.
      // Public readability should be configured at the bucket IAM policy.
    });

    const gsUrl = `gs://${bucketName}/${filename}`;
    const httpsUrl = gsToHttps(gsUrl) as string;

    // Optionally upload PDFs to OpenAI when provider is OPENAI
    let openaiFileId: string | undefined = undefined;
    const provider = (process.env.MODEL_PROVIDER || "").toUpperCase();
    const isPdf = (file.type || "").toLowerCase() === "application/pdf";
    if (provider === "OPENAI" && isPdf) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        try {
          const form = new FormData();
          form.append(
            "purpose",
            process.env.OPENAI_FILES_PURPOSE || "assistants",
          );
          const expAnchor =
            process.env.OPENAI_FILES_EXPIRES_AFTER_ANCHOR || "created_at";
          const expSeconds = process.env.OPENAI_FILES_EXPIRES_AFTER_SECONDS
            ? Number(process.env.OPENAI_FILES_EXPIRES_AFTER_SECONDS)
            : 60 * 60 * 24 * 90; // 90 days default
          form.append("expires_after[anchor]", String(expAnchor));
          form.append("expires_after[seconds]", String(expSeconds));
          const blob = new Blob([buf], {
            type: file.type || "application/pdf",
          });
          form.append("file", blob, file.name || "upload.pdf");

          const uploadRes = await fetch("https://api.openai.com/v1/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          const data = await uploadRes.json().catch(() => undefined);
          if (uploadRes.ok && data?.id) {
            openaiFileId = data.id as string;
          } else {
            console.error("OpenAI upload failed", uploadRes.status, data);
          }
        } catch (err) {
          console.error("OpenAI upload error", err);
        }
      }
    }

    return NextResponse.json({
      gsUrl,
      httpsUrl,
      openaiFileId,
      mime_type: file.type,
      filename: file.name,
      size: size ?? buf.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
