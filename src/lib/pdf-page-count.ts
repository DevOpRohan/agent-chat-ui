import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PDF_PAGES,
  MAX_UPLOAD_BYTES,
  pdfPageLimitMessage,
} from "./attachment-limits";

export class PdfValidationError extends Error {
  constructor(
    message: string,
    public readonly code = "PDF_PAGE_COUNT_UNAVAILABLE",
    public readonly status = 422,
  ) {
    super(message);
  }
}

export function isPdfFile(type: string, name: string, bytes?: Buffer) {
  return (
    type.toLowerCase().split(";")[0] === "application/pdf" ||
    /\.pdf$/i.test(name) ||
    Boolean(bytes?.subarray(0, 1024).includes(Buffer.from("%PDF-")))
  );
}

export function requirePdfPageBudget(pages: number) {
  if (pages > MAX_PDF_PAGES)
    throw new PdfValidationError(
      pdfPageLimitMessage(pages),
      "PDF_PAGE_LIMIT_EXCEEDED",
    );
}

export async function readPdfPageCount(bytes: Buffer): Promise<number> {
  if (bytes.length > MAX_UPLOAD_BYTES)
    throw new PdfValidationError(
      "File too large. The maximum size is 100MB.",
      "ATTACHMENT_TOO_LARGE",
      413,
    );
  const unavailable = () =>
    new PdfValidationError(
      "Could not verify PDF page count. Use an unencrypted, readable PDF.",
    );
  let directory: string | undefined;
  try {
    // A seekable file avoids pdfinfo buffering the entire input from stdin.
    directory = await mkdtemp(join(tmpdir(), "pdf-page-count-"));
    const path = join(directory, "source.pdf");
    await writeFile(path, bytes, { mode: 0o600 });
    // Count only: no rendering, extraction, OCR or external service.
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        "pdfinfo",
        [path],
        {
          timeout: 10_000,
          maxBuffer: 64 * 1024,
          env: { ...process.env, LC_ALL: "C" },
        },
        (error, stdout) => {
          if (error) reject(unavailable());
          else resolve(stdout);
        },
      );
    });
    const matches = [...output.matchAll(/^Pages:[ \t]+(\d+)[ \t]*$/gm)];
    const pages = matches.length === 1 ? Number(matches[0][1]) : NaN;
    if (
      !Number.isSafeInteger(pages) ||
      pages < 1 ||
      /^Encrypted:\s+yes\b/im.test(output)
    )
      throw unavailable();
    return pages;
  } catch {
    throw unavailable();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
