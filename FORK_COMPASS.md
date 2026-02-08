# Fork Compass — Agent Chat UI Customizations

_Last updated: 2026-02-08_  
_Branch: codex/dark_mode_exp_branch_  
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
- **Fork status:** 53 commits ahead
- **Files changed vs upstream:** 67
- **Net diff vs upstream:** +5603 / -692 lines

Tracking anchor commits:

- **Fork HEAD:** `44fe615`
- **Upstream main:** `1a0e8af`

---

## 2.1) Recent Fork Changes Since Upstream Sync (2026-01-22)

- 2026-02-08: Sync browser tab/app icons to Question Crafter branding by explicitly declaring metadata icon links (SVG, PNG sizes, ICO, apple-touch) and generating matching assets to avoid stale favicon caches across browsers. Files: `src/app/layout.tsx`, `src/app/favicon.ico`, `public/favicon-32x32.png`, `public/favicon-16x16.png`, `public/apple-touch-icon.png`.
- 2026-02-08: Improve markdown link readability in dark mode by adding dedicated light/dark link color tokens and applying them in markdown rendering so plain URLs remain visually distinct from body text. Files: `src/app/globals.css`, `src/components/thread/markdown-styles.css`, `src/components/thread/markdown-text.tsx`.
- 2026-02-08: Add full light/dark theme support with persistent toggle UX (`next-themes`) in setup and chat headers, migrate core chat/history/tool-call/agent-inbox surfaces to semantic theme tokens, and add a dedicated dark variant for the Question Crafter logo. Files: `src/app/layout.tsx`, `src/components/theme/theme-provider.tsx`, `src/components/theme/theme-toggle.tsx`, `src/components/icons/question-crafter.tsx`, `src/providers/Stream.tsx`, `src/components/thread/index.tsx`, `src/components/thread/history/index.tsx`, `src/components/thread/messages/ai.tsx`, `src/components/thread/messages/tool-calls.tsx`, `src/components/thread/messages/generic-interrupt.tsx`, `src/components/thread/MultimodalPreview.tsx`, `src/components/thread/markdown-styles.css`, `src/components/thread/agent-inbox/index.tsx`, `src/components/thread/agent-inbox/components/state-view.tsx`, `src/components/thread/agent-inbox/components/thread-actions-view.tsx`, `src/components/thread/agent-inbox/components/inbox-item-input.tsx`, `src/components/thread/agent-inbox/components/thread-id.tsx`, `src/components/thread/agent-inbox/components/tool-call-table.tsx`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-08: Stabilize final assistant streaming after intermediate/tool activity by preventing same-tail-message regressions during stream-to-history handoff. Added a non-regressive tail AI snapshot hook and Playwright continuity coverage. Files: `src/hooks/use-stable-stream-messages.ts`, `src/components/thread/index.tsx`, `src/components/thread/messages/ai.tsx`, `tests/final-stream-continuity.spec.ts`, `FORK_COMPASS.md`.
- 2026-02-08: Switch to local Inter font assets via `@fontsource/inter` to avoid build-time Google Fonts fetch failures in Docker builds. Files: `package.json`, `pnpm-lock.yaml`, `src/app/layout.tsx`, `src/app/globals.css`.
- 2026-02-07: Remove logo background fill for transparent assets (no square background in UI). Files: `public/question-crafter-logo.svg`, `public/logo.svg`, `public/question-crafter-logo.png`, `src/components/icons/question-crafter.tsx`, `src/app/favicon.ico`.
- 2026-02-07: Sync updated logo SVG across all assets and React icon, regenerate PNG + favicon. Files: `public/question-crafter-logo.svg`, `public/logo.svg`, `public/question-crafter-logo.png`, `src/components/icons/question-crafter.tsx`, `src/app/favicon.ico`.
- 2026-02-06: Refresh Question Crafter branding assets to the selected balanced co-author mark and simplify the icon by removing the outer nested containers (inner symbol only). Also add alternate icon source under `public/branding/`; history-row rename save/cancel controls are compact icon actions for lower width. Files: `public/logo.svg`, `public/question-crafter-logo.svg`, `public/question-crafter-logo.png`, `public/branding/question-crafter-icon-option-1-collab.svg`, `src/components/icons/question-crafter.tsx`, `src/components/thread/history/index.tsx`, `FORK_COMPASS.md`.
- 2026-02-06: Add manual thread naming on history rows (pencil icon with inline editor); persists names via `threads.update(...metadata.thread_title)` and prioritizes custom names in history labels. Also adds a clear `New` action in history headers (desktop + mobile sheet). Files: `src/components/thread/history/index.tsx`, `src/providers/Thread.tsx`, `src/lib/thread-metadata.ts`, `src/components/thread/index.tsx`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-06: Add thread history lazy loading in 20-thread batches with bottom-of-list scroll fetch and inline `Loading more history...` spinner indicator (desktop + mobile sheet). Files: `src/providers/Thread.tsx`, `src/components/thread/history/index.tsx`, `src/providers/Stream.tsx`, `README.md`, `FORK_COMPASS.md`.
- 2026-02-06: Prevent intermediate artifact portal over-rendering by mounting intermediate artifact slot content only when open, and suppress benign React `#185` stream errors from showing as user-facing failure toasts. Files: `src/components/thread/messages/ai.tsx`, `src/components/thread/index.tsx`, `FORK_COMPASS.md`.
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
- `src/components/thread/messages/ai.tsx`
- `src/hooks/use-thread-last-seen.ts`
- `src/hooks/use-stable-stream-messages.ts`
- `src/lib/thread-metadata.ts`
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
- Tail AI message rendering now applies a monotonic guard for the active thread/branch so final assistant text does not shrink if SDK history refetch temporarily returns a shorter snapshot than live stream output.
- Benign React `#185` stream errors are filtered from the generic run-error toast path to avoid false failure alerts for users.
- Header/setup branding now uses `Question Crafter` title text with the fork logo.
- App metadata now declares explicit favicon + app icon links (`svg`, `16/32 png`, `ico`, and `apple-touch-icon`) with versioned URLs to prevent stale browser icon caches after logo updates.
- App-wide theme switching now uses `next-themes` with a persistent light/dark toggle in the setup and main chat headers.
- The `Question Crafter` logo now supports explicit light/dark variants and switches automatically with active theme.
- Core chat/history/tool-call/interrupt/agent-inbox surfaces were migrated off hard-coded light grays to semantic theme tokens for readable dark mode.
- Thread history rows now include a contextual rename action (pencil icon with inline editor); saving writes `thread_title` metadata through the LangGraph SDK `threads.update(...)` API.
- Rename inline editor uses compact icon actions (`check` / `close`) instead of text buttons to reduce row width.
- History label resolution now prioritizes user-defined thread titles (`thread_title`, then `title`) before fallback preview text.
- Thread history list is enabled and controlled by `THREAD_HISTORY_ENABLED`.
- History search no longer gates by assistant/graph; the backend ownership filter scopes results per-user.
- Thread history items show run-in-progress spinners and unseen completion dots using localStorage last-seen tracking.
- History polling now uses a lighter `/threads/search` payload (`select` fields, no `values`), pauses when history is not visible, pauses while the tab is hidden, and avoids rerenders when thread signatures have not changed.
- History list lazy-loads metadata in 20-thread batches on downward scroll and shows an inline `Loading more history...` spinner while the next batch fetches.

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
- `src/components/thread/messages/ai.tsx`
- `src/components/thread/history/index.tsx`
- `src/components/theme/theme-provider.tsx`
- `src/components/theme/theme-toggle.tsx`
- `src/hooks/use-thread-last-seen.ts`
- `src/hooks/use-stable-stream-messages.ts`
- `src/lib/thread-metadata.ts`
- `src/lib/thread-activity.ts`

**E2E coverage**

- `tests/final-stream-continuity.spec.ts`

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

**Branding assets**

- `public/logo.svg`
- `public/question-crafter-logo.svg`
- `public/question-crafter-logo.png`
- `public/favicon-32x32.png`
- `public/favicon-16x16.png`
- `public/apple-touch-icon.png`
- `public/branding/question-crafter-icon-option-1-collab.svg`
- `src/components/icons/question-crafter.tsx`

---

## 5) Fork-only Commit Log

Commits unique to this fork (upstream/main..HEAD):

- `44fe615` fix(branding): sync favicon and apple icon assets
- `b9ad64f` docs: refresh fork compass after markdown link contrast fix
- `a95bf63` fix(ui): restore markdown link contrast in dark mode
- `3d52ae1` feat(ui): add experimental dark mode toggle and themed logo
- `c8add70` fix(stream): stabilize final assistant output after intermediate steps
- `4612151` fix(build): use local inter font
- `33bdc62` docs: refresh fork compass snapshot
- `4b10f0c` fix(branding): remove logo background fill
- `e8d8ed8` docs: refresh fork compass after logo sync
- `d363602` fix(branding): sync updated logo svg across assets
- `496d328` fix(branding): remove logo outer containers and update favicon
- `a2239ce` docs: refresh fork compass snapshot after branding updates
- `1d0a8ec` feat(ui): move thread actions to history and refresh branding
- `f35cea4` fix(ui): stop intermediate spinner when final text starts
- `3e924cd` fix(ui): remove extra gap under intermediate step blocks
- `8afba89` fix: reduce intermediate artifact churn and ignore benign react 185 toast
- `e31c75a` docs: refresh fork compass snapshot and commit log
- `55ddaac` feat(ui): aggregate intermediate steps and rebrand to Question Crafter
- `837bd7f` fix: align intermediate steps ordering and tool-result actions
- `4702da1` feat: group reasoning and tool calls under intermediate steps
- `dae70b2` fix: guard regenerate while thread is running
- `e3e5984` feat: add scrollable thinking panel with sticky bottom
- `2997990` fix: preserve interleaved reasoning and tool call order
- `1b3fdb4` fix: parse reasoning summary blocks for thinking preview
- `030d8cc` fix: reject concurrent thread sends and harden stream UX
- `3ab7f0e` feat: improve thread run UX and add playwright QA coverage
- `df0fb50` fix: reconnect stream on mount
- `e66f66b` Revert "docs: update develop LangGraph URL"
- `9815ffa` docs: update develop LangGraph URL
- `eea6103` feat: add IAP auth and direct LangGraph calls
- `209bdf9` test: add Playwright e2e setup
- `3f29185` chore: update fork compass and clean build artifacts
- `fbd3d13` fix: remove stream auto-reconnect
- `645cbdb` Updated Deployment
- `7e75347` fix: stream auto-reconnect on page refresh
- `4fc9b47` Added agents.md
- `a3a8de5` fix: disable thread history list until ownership
- `2934dfd` docs: consolidate fork customization notes
- `b73a84a` chore: remove stream health polling
- `659c943` Merge upstream/main: SDK 1.0 + upstream fixes
- `93be0c5` feat: add stream health polling for stale connection detection
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
