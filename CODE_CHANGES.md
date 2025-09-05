# Multimodal Upload Refactor — Code Changes

## Problem Statement
- Large base64 attachments caused heavy payloads, slow uploads, and visible UI latency.
- LangChain’s OpenAI converter rejects `file` blocks when `source_type` is `url` (expects `base64` or `id`), causing runtime errors for PDFs.
- We needed a strategy that keeps client payloads small, interoperates cleanly with OpenAI, and stays flexible for other providers (e.g., Google).

## High-Level Solution
1) Upload every file once to GCS and return both `gs://` and `https://` paths.
2) If provider is OPENAI and the file is a PDF ≤ 100 MB, upload the same in-memory buffer to the OpenAI Files API and return `openaiFileId`.
3) Client constructs content blocks based on provider:
   - Images → URL blocks (`source_type: "url"`, `url: httpsUrl`).
   - PDFs → If OPENAI → ID blocks (`source_type: "id"`, `id: openaiFileId`); otherwise URL blocks.
4) Keep human-readable attachment info using HTTPS links for traceability.

## Detailed Changes (by file)

src/app/api/upload/route.ts
- Runtime: `nodejs`; long uploads allowed.
- Parse multipart form (`file`). Enforce 100 MB limit using `file.size` and buffer length guard.
- Read file into memory once (`await file.arrayBuffer()`), then:
  - Save to GCS via `file.save(buf, { contentType, resumable: false })`.
  - Important: DO NOT set `public: true` (Uniform Bucket-Level Access breaks object ACLs). Public access should be handled at the bucket level or via signed URLs.
  - Build `gsUrl` and derive `httpsUrl` as `https://storage.googleapis.com/<bucket>/<object>`.
- When `MODEL_PROVIDER=OPENAI` and `mime_type === application/pdf` and within 100 MB:
  - Create a Web `FormData`, append `purpose` and `expires_after[...]` fields.
  - Append file using a `Blob([buf], { type })` so `fetch` generates a correct multipart body.
  - POST to `https://api.openai.com/v1/files` with `Authorization: Bearer ${OPENAI_API_KEY}`.
  - If success, include `openaiFileId = data.id` in the response. If failure, log it but keep returning GCS URLs.
- Response shape now: `{ gsUrl, httpsUrl, openaiFileId?, mime_type, filename, size }`.

src/app/api/openai/upload/route.ts
- Uses the same Web `FormData` + `Blob` approach when proxying uploads by URL.
- Keeps validation and size guarding; returns `{ file_id }` on success, or structured error details.

src/lib/multimodal-utils.ts
- Introduced a single `upload(file)` call to `/api/upload` that returns `{ gsUrl, httpsUrl, openaiFileId?, ... }`.
- Construct `DataContentBlock` on the client:
  - Images → URL block with `httpsUrl` (smaller payload and fast preview).
  - PDFs:
    - If `NEXT_PUBLIC_MODEL_PROVIDER === "OPENAI"` and `openaiFileId` exists → `source_type: "id"`.
    - Otherwise → `source_type: "url"` using `httpsUrl`.
- Keep metadata `{ filename, gsUrl, httpsUrl }` for `ATTACHMENTS_INFO`.
- Added `isPreviewableContentBlock` for safe UI rendering (supports base64/url/id for images and files).

src/components/thread/index.tsx
- `ATTACHMENTS_INFO` lines now prefer `block.url` → `metadata.httpsUrl` → fallback to `gsUrl`.

src/components/thread/MultimodalPreview.tsx
- Updated to accept `DataContentBlock` instead of only base64.
- Image previews support both `base64` and `url` sources.
- PDF previews show a filename chip for `id` or `url` (no inline preview for `id`).

src/components/thread/ContentBlocksPreview.tsx
- Updated prop types to `DataContentBlock[]`.

src/components/thread/messages/human.tsx
- Display attachments using `isPreviewableContentBlock` (not just base64 checks).

.env.example
- Added placeholders for:
  - `GCS_BUCKET_NAME`
  - `MODEL_PROVIDER` and `NEXT_PUBLIC_MODEL_PROVIDER`
  - `OPENAI_API_KEY`
  - `OPENAI_FILES_PURPOSE`, `OPENAI_FILES_EXPIRES_AFTER_ANCHOR`, `OPENAI_FILES_EXPIRES_AFTER_SECONDS`

next.config.mjs
- Already allowed `storage.googleapis.com` for `next/image` and set `serverActions.bodySizeLimit` to `100mb`.

Dockerfile
- Accepts and exports `NEXT_PUBLIC_MODEL_PROVIDER` in addition to existing Next public variables.
- Container runs `node /app/server.js`. Cloud Run injects `PORT`; the app listens accordingly.

## Key Implementation Notes
- UBLA: When Uniform Bucket-Level Access is enabled for the GCS bucket, do not attempt object-level ACLs (avoid `public: true`). Make the bucket public via IAM if you need open-read previews, or switch to signed URLs.
- OpenAI Files API: Using Web `FormData` and `Blob` is crucial so the `file` part is recognized. Passing raw Node buffers with the `form-data` library caused `400` with `"'file' is a required property"`.
- Size cap: Enforced at 100 MB for simplicity and reliability.
- Interop: PDF as `id` for OPENAI avoids LangChain converter errors; images as URL blocks reduce payload size and render fast in the UI.

## Testing Performed
- Built Next app locally; verified uploads and previews for images (URL) and PDFs (ID on OPENAI, URL otherwise).
- Confirmed OpenAI upload succeeds using Web FormData/Blob and returns `openaiFileId`.
- Verified `ATTACHMENTS_INFO` includes HTTPS URLs.
- Tested multi-arch Docker builds and avoided single-arch overwrite to prevent exec format errors on Cloud Run.

## Known Limitations / Next Steps
- If bucket is private, previews require signed URLs (can add a server helper to return short-lived signed links). Current implementation assumes public access or suitable IAM policy.
- No inline PDF preview for `id` sources; UI shows filename chip as intended.
