export const MAX_IMAGE_ATTACHMENTS = 20;
export const MAX_PDF_ATTACHMENTS = 2;
export const MAX_PDF_PAGES = 64;
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function pdfPageLimitMessage(pages: number) {
  return `PDF attachments may contain at most ${MAX_PDF_PAGES} pages combined; received ${pages}. Select fewer pages or split the source before uploading.`;
}
