# Fork Compass — Agent Chat UI Customizations

_Last updated: 2026-02-06_  
_Branch: main_  
_Upstream: langchain-ai/agent-chat-ui (upstream/main)_

This document is a high-detail map of how this fork diverges from the upstream Agent Chat UI. It is designed so a new developer can quickly understand what was customized, why it exists, and where to edit it.

## Table of Contents
- [1) Executive Summary](#1-executive-summary)
- [2) Diff Snapshot (Upstream vs Fork)](#2-diff-snapshot-upstream-vs-fork)
- [2.1) Recent Fork Changes Since Upstream Sync (2026-01-22)](#21-recent-fork-changes-since-upstream-sync-2026-01-22)
- [3) Customization Map (by area)](#3-customization-map-by-area)
  - [3.1 Upload Pipeline (GCS + OpenAI Files)](#31-upload-pipeline-gcs--openai-files)
    - [3.1.1 Implementation Notes & Limits](#311-implementation-notes--limits)
  - [3.2 Multimodal Content Blocks & Previews](#32-multimodal-content-blocks--previews)
  - [3.3 Thread Submission Behavior (recursion + disconnects)](#33-thread-submission-behavior-recursion--disconnects)
  - [3.4 UX Polish & Rendering Tweaks](#34-ux-polish--rendering-tweaks)
  - [3.5 Configuration & Deployment](#35-configuration--deployment)
  - [3.6 Documentation Added](#36-documentation-added)
- [4) File Navigation Index](#4-file-navigation-index)
- [5) Fork-only Commit Log](#5-fork-only-commit-log)
- [6) Notes / Known Deviations](#6-notes--known-deviations)

---

## 1) Executive Summary
This fork focuses on **efficient multimodal uploads, IAP-backed auth for direct LangGraph calls, OpenAI-compatible PDF handling, deployment readiness, and a few UX tweaks**. The biggest architectural changes are a new **server-side upload pipeline** (GCS + optional OpenAI Files) and a **frontend token mint endpoint** that validates IAP headers and issues LangGraph JWTs so the browser can call LangGraph directly.

Key differences in one sentence:
- **Uploads now go to GCS first (and optionally OpenAI), IAP JWTs are validated and exchanged for LangGraph JWTs, content blocks are URL/ID-based, and the UI and submission configs were adjusted for reliability and UX.**
Recent post-sync changes (after 2026-01-22) include **re-enabling thread history list**, **removing assistant/graph gating for history (owner-only)**, **removing stream health polling**, **removing stream auto-reconnect**, and **documentation updates**.

---

## 2) Diff Snapshot (Upstream vs Fork)
- **Upstream status:** 0 commits behind
- **Fork status:** 20 commits ahead
- **Files changed vs upstream:** 25
- **Net diff vs upstream:** +1873 / -190 lines

Tracking anchor commits:
- **Fork HEAD:** `fbd3d13`
- **Upstream main:** `1a0e8af`

---

## 2.1) Recent Fork Changes Since Upstream Sync (2026-01-22)
- 2026-02-06: Rebrand in-app UI title/header/logo from `Agent Chat` to `Question Crafter` across setup, main thread header, and page metadata. Files: `src/providers/Stream.tsx`, `src/components/thread/index.tsx`, `src/app/layout.tsx`, `src/components/icons/question-crafter.tsx`, `public/logo.svg`.
- 2026-02-06: Aggregate consecutive AI/tool intermediate content into a single `Intermediate Step` launcher per turn (instead of per message), with streaming header status + spinner (`thinking...` / `calling ...`) and ordered content preserved for tool calls/results and reasoning blocks. Files: `src/components/thread/messages/ai.tsx`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-06: Add assistant-message reasoning preview UI. When `reasoning` content blocks are present, the chat shows a compact “Thinking” panel with the latest 500 characters (stream-updating as content updates). Files: `src/components/thread/messages/ai.tsx`, `README.md`.
- 2026-02-06: Optimize thread history refresh path: `threads.search` now requests a lightweight selected field set (no `values`), thread labels are read from thread metadata preview, polling pauses when the history panel is closed or the tab is hidden, and redundant thread-list rerenders are skipped when signatures are unchanged. Files: `src/providers/Thread.tsx`, `src/components/thread/history/index.tsx`, `src/components/thread/index.tsx`.
- 2026-02-06: Reject same-thread concurrent sends with explicit toast UX and backend-safe run policy (`multitaskStrategy: "reject"` on all run-creating submits). Added preflight thread busy check in composer and new submit-guard Playwright coverage. Files: `src/components/thread/index.tsx`, `src/components/thread/messages/human.tsx`, `src/components/thread/agent-inbox/components/thread-actions-view.tsx`, `src/components/thread/agent-inbox/hooks/use-interrupted-actions.tsx`, `tests/submit-guard.spec.ts`, `tests/history-spinner-qa.spec.ts`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-06: Add Playwright one-time manual auth setup and QA spinner-focused E2E coverage for history/cancel synchronization and inactive-thread behavior. Files: `playwright.config.ts`, `tests/auth.setup.ts`, `tests/history-spinner-qa.spec.ts`, `tests/thread-history.spec.ts`, `tests/reconnect.spec.ts`, `package.json`, `README.md`.
- 2026-02-05: Add thread history activity indicators (busy spinner + unseen completion dot) with localStorage last-seen tracking and light polling. Files: `src/components/thread/history/index.tsx`, `src/hooks/use-thread-last-seen.ts`, `src/lib/thread-activity.ts`, `src/components/thread/index.tsx`.
- 2026-02-05: Reduce thread history fetch limit from 100 to 20 for faster loads. Files: `src/providers/Thread.tsx`, `FORK_COMPASS.md`.
- 2026-02-05: Highlight the active thread in history with a darker background. Files: `src/components/thread/history/index.tsx`, `FORK_COMPASS.md`.
- 2026-02-06: Sync history busy spinner with local run state and scope cancel/loading UI to the run-owning thread during rapid thread switches. Files: `src/components/thread/index.tsx`, `src/components/thread/history/index.tsx`, `src/hooks/use-thread-busy.ts`, `src/lib/thread-activity.ts`, `FORK_COMPASS.md`.
- 2026-02-03: Re-enable thread history list now that ownership is enforced. Files: `src/lib/constants.ts`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-03: Thread history search now relies on owner filtering only (no assistant/graph gating). Files: `src/providers/Thread.tsx`, `FORK_COMPASS.md`.
- 2026-02-03: Add IAP-backed auth token endpoint + client token cache; remove API passthrough; update docs.
- 2026-02-02: Remove stream auto-reconnect (buggy). Files: `src/providers/Stream.tsx`, `FORK_COMPASS.md`.
- 2026-01-29: Disable thread history list until ownership. Files: `src/components/thread/history/index.tsx`, `src/lib/constants.ts`, `src/providers/Stream.tsx`, `src/providers/Thread.tsx`, `README.md`, `FORK_COMPASS.md`.
- 2026-01-29: Remove stream health polling. Files: `src/providers/Stream.tsx`; removed `src/hooks/useStreamHealthCheck.ts`, `plan.md`.
- 2026-01-29: Add fork agent instructions. Files: `AGENTS.md`.
- 2026-01-29: Update deployment docs. Files: `DEPLOYMENT_GUIDE.md`.
- 2026-01-29: Consolidate fork docs. Files: `FORK_COMPASS.md`, `README.md`; removed `CODE_CHANGES.md`.

---

## 3) Customization Map (by area)

### 3.1 Upload Pipeline (GCS + OpenAI Files)
**What changed:** Uploads are handled server-side, stored in GCS, and optionally forwarded to OpenAI Files API for PDFs when `MODEL_PROVIDER=OPENAI`.

**Why:**
- Avoids large base64 payloads in messages.
- Makes PDFs OpenAI-compatible using file IDs (LangChain converter rejects URL-based `file` blocks for OpenAI).
- Keeps upload logic centralized with size validation and metadata handling.

**Primary files:**
- `src/app/api/upload/route.ts`
- `src/app/api/openai/upload/route.ts`

**Key behaviors:**
- `/api/upload` accepts multipart `file`, enforces 100MB max, uploads to GCS, and returns `{ gsUrl, httpsUrl, openaiFileId?, ... }`.
- When `MODEL_PROVIDER=OPENAI` and file is PDF, server uploads to OpenAI Files API in-memory and returns `openaiFileId`.
- `/api/openai/upload` supports URL-based OpenAI file uploads and returns file metadata to the client.

**Operational knobs:**
- `GCS_BUCKET_NAME` (server)
- `MODEL_PROVIDER` and `NEXT_PUBLIC_MODEL_PROVIDER`
- `OPENAI_API_KEY` and `OPENAI_FILES_*`

---

#### 3.1.1 Implementation Notes & Limits
- **Size cap:** 100MB enforced twice (file size + buffer length). Returns `413` with `{ max_bytes, content_length }`.
- **In-memory upload:** Files are read once into memory and uploaded to GCS via `file.save(...)` with `resumable: false`.
- **Uniform Bucket-Level Access (UBLA):** Object ACLs are not set. Public access must be handled at the bucket IAM policy, or use signed URLs.
- **OpenAI Files:** PDFs use Web `FormData` + `Blob` (not Node `form-data`) to avoid OpenAI rejecting the `file` field. Expiry defaults to ~90 days unless overridden by `OPENAI_FILES_EXPIRES_AFTER_*`.
- **Failure mode:** If OpenAI upload fails, the API still returns GCS URLs so uploads remain usable for non-OpenAI paths.
- **/api/openai/upload path:** Performs an optional `HEAD` check for size, then downloads the file and uploads it to OpenAI; returns structured error info on failures.
- **Preview limitation:** ID-based PDF blocks render as filename chips (no inline PDF preview). URL PDFs use a filename chip as well.

---

### 3.2 Multimodal Content Blocks & Previews
**What changed:** The client now constructs **URL/ID-based blocks** instead of base64 for images/PDFs. UI previews handle URL-based images and ID-based PDFs.

**Primary files:**
- `src/lib/multimodal-utils.ts`
- `src/hooks/use-file-upload.tsx`
- `src/components/thread/MultimodalPreview.tsx`
- `src/components/thread/ContentBlocksPreview.tsx`

**Key behaviors:**
- `fileToContentBlock` calls `/api/upload`, then creates:
  - **Images:** `{ type: "image", source_type: "url", url: httpsUrl }`
  - **PDFs (OpenAI):** `{ type: "file", source_type: "id", id: openaiFileId }`
  - **PDFs (others):** `{ type: "file", source_type: "url", url: httpsUrl }`
- Added `ExtendedContentBlock` and `isPreviewableContentBlock` to support base64 + URL + ID formats.
- Preview components now support URL-based images and ID-based PDFs.

---

### 3.3 Thread Submission Behavior (recursion + disconnects)
**What changed:** Thread submissions pass a recursion limit and keep the run alive on disconnect.

**Primary files:**
- `src/lib/constants.ts`
- `src/components/thread/index.tsx`
- `src/components/thread/messages/human.tsx`
- `src/components/thread/agent-inbox/hooks/use-interrupted-actions.tsx`
- `src/providers/Stream.tsx`

**Key behaviors:**
- `DEFAULT_AGENT_RECURSION_LIMIT` is read from `NEXT_PUBLIC_AGENT_RECURSION_LIMIT` (fallback 50).
- All `thread.submit` calls include:
  - `config: { recursion_limit: DEFAULT_AGENT_RECURSION_LIMIT }`
  - `multitaskStrategy: "reject"`
  - `onDisconnect: "continue"`

---

### 3.4 UX Polish & Rendering Tweaks
**What changed:** Small but important UX changes, especially around uploads and tool-call formatting.

**Primary files:**
- `src/hooks/use-file-upload.tsx`
- `src/components/thread/index.tsx`
- `src/components/thread/history/index.tsx`
- `src/hooks/use-thread-last-seen.ts`
- `src/lib/thread-activity.ts`
- `src/components/thread/messages/tool-calls.tsx`
- `src/components/thread/messages/human.tsx`

**Key behaviors:**
- Upload flow now exposes `isUploading` and disables inputs while files upload.
- Upload label shows spinner + “Uploading...”
- Tool call results render in scrollable `<pre>` blocks with prettier JSON formatting.
- Human message bubble alignment adjusted (removed `text-right`).
- Composer now rejects same-thread sends while the thread is still running and shows a warning toast; draft text/files are preserved for retry.
- Conflict-like run errors (busy/conflict/409) surface with a dedicated “active run” toast instead of a generic error message.
- Assistant messages now render a compact “Thinking” panel when `reasoning` content blocks are present, showing the latest 500 characters.
- Intermediate reasoning/tool content now routes through one `Intermediate Step` launcher in the chat message area and renders full ordered details in the right artifact pane, including tool calls, tool results, and streaming status text.
- Intermediate launchers now aggregate contiguous AI/tool message blocks into one per turn, reducing repeated cards during parallel/interleaved tool execution.
- Header/setup branding now uses `Question Crafter` title text with the fork logo.
- Thread history list is enabled and controlled by `THREAD_HISTORY_ENABLED`.
- History search no longer gates by assistant/graph; the backend ownership filter scopes results per-user.
- Thread history items show run-in-progress spinners and unseen completion dots using localStorage last-seen tracking.
- History polling now uses a lighter `/threads/search` payload (`select` fields, no `values`), pauses when history is not visible, pauses while the tab is hidden, and avoids rerenders when thread signatures have not changed.

---

### 3.5 Configuration & Deployment
**What changed:** Build/deploy setup now supports **direct LangGraph calls with IAP-backed JWT auth**, plus GCS uploads and standalone Next output.

**Primary files:**
- `next.config.mjs`
- `.env.example`
- `Dockerfile`
- `package.json`
- `src/app/api/auth/token/route.ts`
- `src/lib/auth-token.ts`
- `src/lib/iap-keys.ts`

**Key behaviors:**
- Next output set to `standalone` for containerized deploys.
- `serverActions.bodySizeLimit` increased to `100mb`.
- `images.remotePatterns` allows `storage.googleapis.com` for URL-based image previews.
- Dockerfile accepts build args for all `NEXT_PUBLIC_*` variables used at build time.
- `/api/auth/token` validates IAP signed headers and mints LangGraph JWTs (HS256).
- `NEXT_PUBLIC_AUTH_MODE=iap` hides the API key UI and enables auth header injection.
- API passthrough dependency removed; `NEXT_PUBLIC_API_URL` now points directly to LangGraph.
- Added deps: `@google-cloud/storage`, `form-data`, `jose`.

---

### 3.6 Documentation Added
**What changed:** Added internal docs to explain uploads and deployment.

**Primary files:**
- `FORK_COMPASS.md` — this guide (includes upload refactor details).
- `DEPLOYMENT_GUIDE.md` — multi-arch build + Cloud Run steps.
- `README.md` — updated env vars and pointers to new docs.
- `AGENTS.md` — fork-specific agent instructions.

---

## 4) File Navigation Index
Use this as a jump list when editing or debugging:

**Uploads & provider logic**
- `src/app/api/upload/route.ts`
- `src/app/api/openai/upload/route.ts`
- `src/lib/multimodal-utils.ts`
- `src/hooks/use-file-upload.tsx`

**UI preview components**
- `src/components/thread/MultimodalPreview.tsx`
- `src/components/thread/ContentBlocksPreview.tsx`

**Auth & tokens**
- `src/app/api/auth/token/route.ts`
- `src/lib/auth-token.ts`
- `src/lib/iap-keys.ts`

**Thread submission and run behavior**
- `src/components/thread/index.tsx`
- `src/components/thread/messages/human.tsx`
- `src/components/thread/agent-inbox/hooks/use-interrupted-actions.tsx`
- `src/lib/constants.ts`
- `src/providers/Stream.tsx`

**UI formatting tweaks**
- `src/components/thread/messages/tool-calls.tsx`
- `src/components/thread/history/index.tsx`
- `src/hooks/use-thread-last-seen.ts`
- `src/lib/thread-activity.ts`

**Config, build, deploy**
- `next.config.mjs`
- `.env.example`
- `Dockerfile`
- `package.json`

**Docs**
- `FORK_COMPASS.md`
- `DEPLOYMENT_GUIDE.md`
- `README.md`
- `AGENTS.md`

---

## 5) Fork-only Commit Log
Commits unique to this fork (upstream/main..HEAD):
- `fbd3d13` fix: remove stream auto-reconnect
- `645cbdb` Updated Deployment
- `7e75347` fix: stream auto-reconnect on page refresh
- `4fc9b47` Added agents.md
- `a3a8de5` fix: disable thread history list until ownership
- `2934dfd` docs: consolidate fork customization notes
- `b73a84a` chore: remove stream health polling
- `659c943` Merge upstream/main: SDK 1.0 + upstream fixes
- `93be0c5` feat: add stream health polling for stale connection detection (later removed)
- `faafbf2` improve tool call formatting
- `9087615` Make agent recursion limit configurable
- `9d6c559` Ensure thread submissions continue on disconnect
- `38a0bac` Upload UX: show spinner and disable inputs while files upload
- `2a9e2a3` feat(multimodal,deploy): efficient uploads + OpenAI file IDs; add deployment docs and env plumbing
- `68d0685` Merge pull request #3 from hars008/fix/text-alignment
- `f339e1b` corrected text alignment
- `be88ac1` Updated nect.confing.mjs file for production grade docker deployment
- `a618a1e` Added Docker File
- `383d0e6` Merge pull request #1 from DevOpRohan/codex/modify-agent-chat-ui-to-add-gcs-file-metadata
- `6338f64` Add GCS upload and attachment metadata

---

## 6) Notes / Known Deviations
- **Polling removed:** A stream health polling hook was added and later removed. Current behavior relies on `onDisconnect: "continue"`.
- **Docs consolidated:** `CODE_CHANGES.md` was removed in favor of this document.
- **Tracked build artifact:** `tsconfig.tsbuildinfo` is currently tracked in git (from upstream diff list). Consider removing if you want a clean repo.
- **OpenAI vs non-OpenAI:** PDF blocks use `source_type: "id"` only when OpenAI is the provider; otherwise they use URL blocks.
- **Private buckets:** If the GCS bucket is private, previews require signed URLs or IAM policy changes (current flow assumes public-read or equivalent).
- **Auth flow:** API passthrough is removed; the frontend now mints JWTs via `/api/auth/token` after validating IAP headers and calls LangGraph directly.

---

For deployment steps, open `DEPLOYMENT_GUIDE.md`.
