import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    return NextResponse.json(
      { error: "Bucket not configured" },
      { status: 500 },
    );
  }
  const storage = new Storage();
  const filename = `${uuidv4()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await storage.bucket(bucketName).file(filename).save(buffer, {
    contentType: file.type,
  });
  const url = `gs://${bucketName}/${filename}`;
  return NextResponse.json({ url });
}
