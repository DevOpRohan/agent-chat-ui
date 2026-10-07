import { NextRequest, NextResponse } from "next/server";
import { MAX_PDF_ATTACHMENTS, MAX_UPLOAD_BYTES } from "@/lib/attachment-limits";
import {
  isPdfFile,
  PdfValidationError,
  readPdfPageCount,
  requirePdfPageBudget,
} from "@/lib/pdf-page-count";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const files = (await req.formData()).getAll("files");
    if (
      !files.length ||
      files.length > MAX_PDF_ATTACHMENTS ||
      files.some(
        (file) => !(file instanceof File) || !isPdfFile(file.type, file.name),
      )
    ) {
      return NextResponse.json(
        { error: "Select one or two PDF files to check their page count." },
        { status: 400 },
      );
    }
    const pageCounts: number[] = [];
    // At most two files; avoid holding both 100MB inputs in parser subprocesses together.
    for (const file of files as File[]) {
      if (file.size > MAX_UPLOAD_BYTES)
        throw new PdfValidationError(
          "File too large. The maximum size is 100MB.",
          "ATTACHMENT_TOO_LARGE",
          413,
        );
      pageCounts.push(
        await readPdfPageCount(Buffer.from(await file.arrayBuffer())),
      );
    }
    const totalPages = pageCounts.reduce((sum, pages) => sum + pages, 0);
    requirePdfPageBudget(totalPages);
    return NextResponse.json({
      page_counts: pageCounts,
      total_pages: totalPages,
    });
  } catch (error) {
    if (error instanceof PdfValidationError)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    return NextResponse.json(
      {
        error:
          "Could not check PDF pages. Please try again with a readable PDF.",
      },
      { status: 400 },
    );
  }
}
