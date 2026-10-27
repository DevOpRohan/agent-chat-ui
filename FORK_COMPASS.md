# Fork Compass — Agent Chat UI Customizations

_Last updated: 2026-10-27_
_Branch: develop (CT terminology update on base `12cddde`; mode dropdown on `fix/mode-menu`)_
_Runtime release: PR #7 (`597dcb8`, source `15f6f1c`)_
_Upstream project: langchain-ai/agent-chat-ui_

This document is the current map of fork-specific behavior in this worktree. The poll-first runtime is now the source-of-truth baseline for the fork, alongside the existing fork features that still matter: GCS/OpenAI uploads, IAP-backed auth, thread history, artifact rendering, HITL flows, and the Crafter | Ingester modes (section 4.7).

## 1) Executive Summary

This fork now uses a poll-first chat runtime as its default architecture.

- No SSE token streaming is used in the app runtime, which avoids holding browser/server token streams open for long-running agent work.
- The selected thread is reconciled from LangGraph REST APIs (`threads.get`, `threads.getState`, `threads.getHistory`, `runs.list`, `runs.cancel`).
- Refresh/remount/network recovery works by resuming polling while the backend thread remains `busy`.
- Cross-tab behavior is backend-driven only. If a thread is `busy`, every tab shows the same working state and blocks duplicate sends.
- This is the preferred path for long-running runs and Cloud Run/service scalability because clients hydrate from backend state instead of joining or rejoining a live stream.
- Existing fork behavior for uploads, OpenAI PDF handling, recursion limits, `onDisconnect: "continue"`, thread history, artifact cards, and HITL resume/edit/regenerate is preserved.

## 2) Diff Snapshot

`origin/main` has been promoted to the poll runtime baseline:

- Source branch: `codex/poll-runtime`
- Baseline commit: `99d0aa8` (`docs: clarify poll runtime submit UX`)
- Parent fork baseline: `a9179f4`
- Migration commits included on `main`: `51d28c9`, `99d0aa8`

Navigator refinement baseline (fetched 2026-09-08):

- `origin/main`: `e868177` (merged navigator PR #5).
- Local upstream reference: `3165738`; this pinned baseline has 81 fork-only commits and a merge-base diff of 91 files, 12,437 insertions, 1,430 deletions (`git diff upstream/main...e868177 --shortstat`).
- Branch snapshot including this PR: 82 fork-only commits; 91 files changed, 12930 insertions(+), 1430 deletions(-) (`git diff upstream/main...HEAD --shortstat`).
- Refinement: updates the navigator, thread shell, deterministic browser coverage, README, this compass, scratchpad, and release guidance. Runtime, upload, authentication, and dependency behavior are unchanged.

Daily-budget implementation snapshot (2026-10-08):

- Runtime source `ca5faf6`: 86 fork-only commits against the pinned `upstream/main`; 95 files changed, 13,868 insertions and 1,476 deletions (`git diff upstream/main...ca5faf6 --shortstat`). Release documentation follows in a separate commit.

Attachment-limit implementation snapshot (2026-10-08):

- Parent `06ef3a7`: 87 fork-only commits; 95 files changed, 13,899 insertions and 1,475 deletions against pinned `upstream/main`.
- Runtime source `15f6f1c`: 88 fork-only commits; 96 files changed, 14,276 insertions and 1,572 deletions against pinned `upstream/main` (`git diff upstream/main...15f6f1c --shortstat`). PR #7 merged the identical tree as `597dcb8`; release documentation follows separately.
- The change consolidates three upload paths and adds deterministic picker/drop/paste, in-flight, removal, failure, oversized retry and mobile coverage.

Combined PDF-page implementation snapshot (2026-10-08):

- Runtime source `bf51fb3`: 91 fork-only commits against pinned `upstream/main`; 103 files changed, 15,178 insertions and 1,573 deletions (`git diff upstream/main...bf51fb3 --shortstat`). PR #8 merged the identical tree as `89efa8c`. It adds local actual-byte page counting and 12 focused page-budget scenarios. Final transport refinement `b20943e` (93 fork-only commits; 103 files changed, 15,198 insertions and 1,573 deletions) sends one PDF per preflight request; PR #9 merged its identical tree as `a7e19cf`.

Verified-count metadata snapshot (2026-10-08):

- Runtime source `baa71bd`: 95 fork-only commits against pinned `upstream/main`; 104 files changed, 15,549 insertions and 1,573 deletions (`git diff upstream/main...baa71bd --shortstat`). PR #10 merged the identical tree as `8374d10`.

Crafter | Ingester modes snapshot (2026-10-26):

- Branch `feat/crafter-ingester-modes` from `origin/main` `a5720d5`: 13 commits; 76 files changed, 20884 insertions(+), 154 deletions(-) (`git diff a5720d5...HEAD --shortstat`). New files are mostly `src/lib/ingest/*`, `src/components/ingester/*`, the two API routes, unit tests and the Playwright spec; `src/providers/Stream.tsx` is unchanged.

CT terminology release snapshot (2026-10-27):

- Develop base `12cddde`, followed by the CT terminology commit: 113 fork-only commits against the pinned `upstream/main`. Release diff: 170 files changed, 36839 insertions(+), 2496 deletions(-).

Recent fork-only commit log:

- `feat: mode dropdown in the top bar, and plain updated-files copy` (`fix/mode-menu`, on develop `8e61163`): the Crafter | Ingester switch becomes a dropdown in place of the logo and title; "Your updated topic files" says to work on the new files for further changes.

- `fix: use CT and variant terminology in Ingester` (develop): CT/CTs in summaries, type badges, issue/report labels and validation messages; variants keep their existing `question_no` identities. Includes updated expectations and documentation.

- `feat/crafter-ingester-modes` (PR to `main`): contract types and vitest; ported Ingester logic; JSON-only ingest upload, topic file download and skill zip; typed topic model; Crafter | Ingester switch with per-mode history; Ingester pane and hook; Playwright spec; docs.

- `baa71bd`: `feat: reuse verified PDF page counts through signed metadata` — generation-pinned sources, domain-separated receipts, native metadata preservation and model-readable PAGE_COUNT.

- `b20943e`: `fix: preflight PDF page counts in separate requests` — singleton requests avoid a combined HTTP/1 body limit while retaining atomic combined-page admission.

- `bf51fb3`: `fix: enforce a combined 64-page PDF attachment budget` — count-only preflight, both direct upload guards, atomic reservations, verified page metadata and backend rejection notices.

- `15f6f1c`: `fix: cap composer attachments at 20 images and 2 PDFs` — shared picker/drop/paste admission, in-flight reservations, visible independent counters and final retry validation.

- `ca5faf6`: `fix: show used budget arc with concise tooltip` — neutral track, used-percentage arc and exactly two tooltip lines.
- `37a3f23`: `feat: tuck daily budget into a compact composer control` — footer placement, hover/focus/touch details and semantic thresholds.
- `40e060f`: `feat: show daily budget and durable limit notifications` — current-day balance ring, extra credits, midnight IST reset, five-second quota notices and preserved drafts.

- This PR: `feat: refine conversation navigation for desktop and touch` — quiet ticks, tapered previews, searchable outline, and contextual resize grips.
- `e868177`: Merge navigator PR #5.
- `8fe2775`: `feat: add conversation turn navigator` — preview and jump between user turns.
- `7c5f73d`: `docs: mark poll runtime as source of truth`
- `99d0aa8`: `docs: clarify poll runtime submit UX`
- `51d28c9`: `feat: migrate chat runtime to poll-first execution`

## 3) Recent Change

- 2026-10-27: The top bar drops the Question Crafter logo and title. In their place, a **mode menu** names the current mode (Crafter or Ingester) and opens a menu with both modes, each with one line about what it does. The empty-chat welcome (logo and "Question Crafter") is unchanged. To start a new chat or ingest, use New in History (the logo used to do this). Ingester's "Your updated topic files" card now says plainly to work on the new files for any further changes.

- 2026-10-26: Add a **Crafter | Ingester** mode switch. Ingester checks a TopicCrafter `.json` on the backend's thread-based `topic_ingest` graph (one LangGraph thread per ingest), shows progress and the result in its own pane, and lists ingests in its own History (filtered by `graph_id`; Crafter's history now lists only Crafter threads). The JSON-only `/api/ingest/upload` has no OpenAI path. Heading is "History" in every mode. See section 4.7.

- 2026-09-08: Refine conversation navigation with uniform 12px resting ticks and tapered hover/focus expansion. Show controls only for overflowing conversations with at least three turns. Use an outline sheet on touch/narrow panes, with search for 12+ turns and a desktop outline shortcut for long chats. Hold reading position while exploring the outline; restore keyboard focus on close. Pane grips appear only on hover/focus/drag.

- 2026-09-07: Add a compact conversation navigator for three or more visible user turns. Markers preview the prompt and first assistant text, track reading position, and jump within the chat scroll container. Keyboard navigation, attachment-only prompts, reduced motion, bounded long lists, pane resizing, and thread switching are supported. Hidden messages never enter previews.

- 2026-05-17: Promote `codex/poll-runtime` to `origin/main` and `origin/develop` as the source-of-truth branch baseline and refresh this compass so poll-first runtime is documented as the default architecture.
- 2026-03-16: Replace the stream-driven runtime with a polling runtime. The app now creates runs with `client.runs.create`, polls thread/run state on a fixed schedule, resumes polling after refresh/remount, removes reconnect/finalization/observer-mode machinery, simplifies active UX to `Working on your query...`, deletes stream-only hooks/libs/tests, and keeps branch/checkpoint metadata through local history processing. Main files: `src/providers/Stream.tsx`, `src/lib/thread-branching.ts`, `src/components/thread/index.tsx`, `src/components/thread/messages/ai.tsx`, `src/components/thread/messages/human.tsx`, `src/components/thread/history/index.tsx`, `src/lib/thread-activity.ts`, `tests/polling-refresh.spec.ts`.

## 4) Customization Map

### 4.1 Upload Pipeline

What stays fork-specific:

- Uploads are handled server-side.
- Files are stored in GCS and returned as `gs://` plus HTTPS URLs.
- PDFs use OpenAI Files IDs when `MODEL_PROVIDER=OPENAI`.
- Non-OpenAI PDFs stay URL-backed.
- Upload size limit remains `100MB`.
- Each composer message permits at most **20 images and 2 PDFs, with 64 PDF pages combined**. Picker, drop and paste use one admission path that reserves in-flight slots and serializes page-count admission across overlapping batches. A separate same-origin count-only request for each PDF checks actual bytes before storage/provider uploads; counts are combined under the same admission lock. Separate requests avoid creating an oversized combined HTTP/1 body. Removal, failed uploads and draft reset release capacity; an old preflight cannot hold or contaminate a new draft. Completed and pending PDF pages share a visible, politely announced counter. Enter waits for uploads and validates restored attachment counts/pages; unverified older PDFs must be reattached.
- `/api/upload/pdf-pages` counts one or two PDFs using local Poppler `pdfinfo`, bounded to 10 seconds and 64KiB output per parser. Encrypted, malformed and ambiguous metadata fail closed. `/api/upload` and `/api/openai/upload` independently inspect the actual bytes and reject PDFs over 64 pages before storage/provider writes. All retain the 100MiB per-file cap. The QuestionCrafter backend authoritatively recounts the combined PDF content before model/tool calls; plain `page_count` metadata is advisory. Successful UI uploads also carry a signed `page_count_receipt`, bound to the actual generation-pinned GCS URL and optional OpenAI file ID. The backend may reuse a verified receipt; unsigned, stale or mismatched metadata falls back to actual-byte counting.

Primary files:

- `src/app/api/upload/route.ts`
- `src/app/api/openai/upload/route.ts`
- `src/lib/multimodal-utils.ts`
- `src/hooks/use-file-upload.tsx`

### 4.2 Auth and Setup

What stays fork-specific:

- The setup screen can be bypassed by env vars.
- IAP mode still validates frontend headers and mints LangGraph JWTs.
- Browser requests still talk directly to LangGraph once configured.

Primary files:

- `src/providers/Stream.tsx`
- `src/lib/auth-token.ts`
- `src/app/api/auth/token/route.ts`

### 4.3 Poll-First Runtime

Current source-of-truth runtime behavior:

- `src/providers/Stream.tsx` is now a polling-backed runtime provider despite the legacy filename.
- The provider exposes `useThreadRuntime`.
- New runs use `client.runs.create`.
- Active state is driven by backend thread/run status plus a small local phase machine:
  - `hydrating`
  - `idle`
  - `submitting`
  - `polling`
  - `canceling`
  - `error`
- Poll cadence:
  - `1500ms` while busy
  - `10000ms` while settled
  - retry backoff `3000ms`, `5000ms`, `10000ms`
- The provider performs immediate refresh on:
  - mount
  - thread switch
  - submit/edit/regenerate/resume
  - cancel completion
  - focus / visibility regain

Important preserved behavior:

- All run-creating submits still pass:
  - `config.recursion_limit`
  - `multitaskStrategy: "reject"`
  - `onDisconnect: "continue"`
- New threads still carry thread preview metadata.
- A minimal optimistic human-message overlay is kept until the next successful poll.

Primary files:

- `src/providers/Stream.tsx`
- `src/lib/thread-branching.ts`
- `src/lib/constants.ts`

### 4.4 Branches, Checkpoints, Regenerate, HITL

What changed:

- Branch/checkpoint metadata is now derived locally from `threads.getHistory(...)`.
- No SDK stream hook is used to provide branch state.

What stays supported:

- branch switching
- edit from checkpoint
- regenerate from checkpoint
- HITL resume / resolve / goto actions

Primary files:

- `src/lib/thread-branching.ts`
- `src/components/thread/messages/human.tsx`
- `src/components/thread/agent-inbox/hooks/use-interrupted-actions.tsx`
- `src/components/thread/agent-inbox/components/thread-actions-view.tsx`

### 4.5 Thread Shell and History

Current behavior:

- Active badge is always `Working on your query...`.
- Duplicate sends/regenerates are blocked whenever the local runtime is active or the backend thread is `busy`.
- History activity indicators are backend-driven only.
- Cross-tab ownership logic and observer mode were removed.
- Last-seen tracking remains for unseen completion indicators.
- Navigation appears for 3+ visible user turns only when the chat overflows. Pointer devices with chat width >=640px show a bounded left-edge rail: uniform 12px ticks at rest, 52/36/24/16px taper around hover or keyboard focus, 24px click targets, and a darker reading marker.
- Touch/narrow panes use a header outline action and modal sheet with large rows. At 12+ turns, search is available and desktop also exposes the outline. Opening it pauses bottom-follow and centers/focuses the current row; closing restores trigger focus. Selecting a turn scrolls only the chat. The existing bottom button restores following.
- Navigator previews/search use prompt and first assistant text, excluding hidden messages, tool payloads, and reasoning blocks. Attachment-only prompts have a fallback label; a pending final response has quiet status text. Arrow keys, Home/End, PageUp/PageDown, Escape, reduced motion, pane resizing, and thread switches are supported. Full-width artifacts hide navigation.
- History/chat and chat/artifact resize grips retain their hit areas and keyboard controls but appear only on hover, keyboard focus, or drag; hover titles describe the resize action.
- History is per mode (section 4.7): `ThreadProvider` keeps one list per mode and adds `metadata: getThreadSearchMetadata(mode)` (`graph_id`, or `assistant_id` for a UUID) to `threads.search`. The heading is "History" in every mode. `Stream.tsx` always gets Crafter's list through `ThreadModeScope`, so its background refresh never touches the Ingester list.

Primary files:

- `src/components/thread/index.tsx`
- `src/components/thread/history/index.tsx`
- `src/lib/thread-activity.ts`
- `src/providers/Thread.tsx`

### 4.6 Message and Artifact Rendering

Current behavior:

- Assistant rendering uses polled state snapshots only.
- The fast streaming markdown path was removed.
- Reconnect/finalizing state copy was removed.
- Intermediate reasoning/tool content still collapses into a single `Intermediate Step` launcher.
- Local artifact cards remain supported:
  - `topic_preview_artifact`
  - `markdown_artifact`

Primary files:

- `src/components/thread/messages/ai.tsx`
- `src/components/thread/messages/tool-calls.tsx`
- `src/components/thread/messages/topic-preview-artifact.tsx`
- `src/components/thread/messages/markdown-artifact.tsx`
- `src/components/thread/markdown-text.tsx`
- `src/components/thread/artifact.tsx`

### 4.7 Crafter | Ingester Modes

Current behavior:

- Modes are one list in `src/lib/app-mode.ts` (`APP_MODES`: label, `?mode=` value, graph id, URL id param, pane). `?mode=crafter|ingester` via `nuqs`; no mode → Crafter; an `ingestId`-only link → Ingester; Crafter keeps `threadId`, Ingester uses `ingestId`, switching keeps both. A later mode (Digitizer) is one entry plus its pane in the shell's `MODE_PANES` map.
- `ModeSwitch` (`src/components/mode-switch.tsx`): a dropdown in the top bar's left corner, where the logo and title used to be, in both modes and on phones. It is a ghost `Button` naming the current mode (`aria-haspopup="menu"`, accessible name "Mode: <mode>") over a popover-coloured `role="menu"` of `menuitemradio`s (label, the mode's `description` from `APP_MODES`, a check on the current one). Keyboard: Enter, Space or the arrows open it on the current mode; arrows, Home and End move; Escape closes it and returns focus to the button. After a pick, focus moves to the new mode's button.
- Ingester hides the chat pane, composer, artifact pane, conversation navigator and enter-to-send setting; the theme setting stays. The pane lives in the chat column at the chat's width, built only from `src/components/ui/*`, existing tokens and `lucide-react`.
- One ingest = one thread on `topic_ingest`: browser file check → `POST /api/ingest/upload` (JSON only, 10 MB, saves `topic-ingest/<uuid>.json` to `GCS_BUCKET_NAME`, no OpenAI code path) → `threads.create` (metadata `graph_id`, `thread_title`, `ingest_file_name`, `ingest_source_url`, stage/status `queued`) → `runs.create(..., { input: { source_url, file_name }, onDisconnect: "continue" })`.
- `use-ingest-thread.ts` polls `threads.search({ ids, select })` every 1.5 s (paused while hidden; slower when stalled; backoff on errors). The graph's own thread-metadata writes don't persist on the deployed Postgres runtime (checked live on dev, 2026-10-26), so while busy the hook also reads `threads.getState` at most every 3 s and maps the checkpoint's `next` to a stage (`record-view.ts` `stageFromNext`; metadata wins when it has a stage). The run has ended when the thread errors, metadata is final, or `runs.list` shows the latest run finished; then `values.record` is read once and mapped by `record-view.ts`. Run again re-checks the thread, patches stage/status back to `queued` and starts a new run on the same thread; it is disabled while busy (the deployed runtime queues a second run instead of rejecting it).
- Mode switches keep the chat subtree mounted: in Ingester the chat pane, chat↔artifact handle and artifact pane are invisible and `inert` under the mode pane (an absolute overlay), so Crafter returns with its draft, scroll, artifact and layout. A link with only `ingestId` writes `mode=ingester` once.
- Results use the standalone topic-ingester app's words (`status-copy.ts`, `plain-issues.ts`, `FILE_MESSAGES`), with CT/CTs terminology for `cts`. Summaries count CTs and their variants; type badges count CTs, and issue/report labels use `CT N, variant M`, preserving each variant's `question_no`. UI-only statuses: `run_error` (thread error; the "couldn't finish" copy), `failed_to_start` (no run started), stalled (busy with no metadata update for 30 minutes).
- Downloads: the report is made in the browser; topic `.json`/`.md` go through `GET /api/topic-file` (https, allow-listed hosts and buckets, no redirects, 25 MB). The skill zip is `public/skill/TopicCrafter-v0.1.0.zip` with `skill:sync`/`skill:check`.
- `src/lib/ingest/topic-model.ts`: the typed topic JSON, one interface per `question_type` plus the `QUESTION_TYPES` registry, for per-type UX.

Primary files:

- `src/lib/app-mode.ts`, `src/components/mode-switch.tsx`
- `src/components/ingester/*`, `src/hooks/use-ingest-thread.ts`
- `src/lib/ingest/*` (`ingest-types.ts` is the shared contract)
- `src/app/api/ingest/upload/*`, `src/app/api/topic-file/*`
- `scripts/skill.mjs`, `public/skill/`
- Tests: `tests/unit/**` (vitest, `pnpm test`), `tests/ingester-mode.spec.ts`, `tests/helpers/ingest-backend.ts`

## 5) Removed Stream-Only Subsystems

Deleted as part of the poll-first migration and intentionally kept out of the source-of-truth baseline:

- `src/hooks/use-stream-auto-reconnect.ts`
- `src/hooks/use-run-finalization-fallback.ts`
- `src/hooks/use-stable-stream-messages.ts`
- `src/hooks/use-thread-busy.ts`
- `src/lib/stream-error-classifier.ts`
- `src/lib/stream-run-shadow.ts`
- `src/components/thread/render-crash-boundary.tsx`

Removed test suites:

- `tests/auto-reconnect-disconnect.spec.ts`
- `tests/cross-tab-observer.spec.ts`
- `tests/final-stream-continuity.spec.ts`
- `tests/jee-complex-number-fallback-soak.spec.ts`
- `tests/react185-finalization-fallback.spec.ts`
- `tests/reconnect-final-reconcile.spec.ts`
- `tests/reconnect-no-false-positive.spec.ts`
- `tests/reconnect-silent-stream-close.spec.ts`
- `tests/reconnect.spec.ts`

Added test coverage:

- `tests/polling-refresh.spec.ts`

## 6) File Navigation Index

Start here when modifying the fork:

- Runtime provider: `src/providers/Stream.tsx`
- Thread shell: `src/components/thread/index.tsx`
- Conversation navigator: `src/components/thread/conversation-navigator.tsx`
- Attachment limits, parser and receipt issuer: `src/lib/attachment-limits.ts`, `src/lib/pdf-page-count.ts`, `src/lib/pdf-page-receipt.ts`
- Count-only upload preflight: `src/app/api/upload/pdf-pages/route.ts`
- Attachment browser coverage: `tests/attachment-limits.spec.ts`
- Real PDF, route and reset coverage: `tests/pdf-pages.spec.ts`, `tests/helpers/pdf-fixtures.ts`
- Navigator browser coverage: `tests/conversation-navigator.spec.ts`
- History: `src/components/thread/history/index.tsx`
- Assistant messages: `src/components/thread/messages/ai.tsx`
- Human message edit/regenerate: `src/components/thread/messages/human.tsx`
- HITL actions: `src/components/thread/agent-inbox/components/thread-actions-view.tsx`
- HITL hook: `src/components/thread/agent-inbox/hooks/use-interrupted-actions.tsx`
- Branch metadata helpers: `src/lib/thread-branching.ts`
- Activity tracking: `src/lib/thread-activity.ts`
- Upload APIs: `src/app/api/upload/route.ts`, `src/app/api/openai/upload/route.ts`
- Artifact provider: `src/components/thread/artifact.tsx`
- Modes: `src/lib/app-mode.ts`, `src/components/mode-switch.tsx`
- Ingester pane and hook: `src/components/ingester/ingest-pane.tsx`, `src/hooks/use-ingest-thread.ts`
- Ingester logic and contract: `src/lib/ingest/ingest-types.ts`, `record-view.ts`, `status-copy.ts`, `topic-model.ts`
- Ingester routes: `src/app/api/ingest/upload/route.ts`, `src/app/api/topic-file/route.ts`
- Ingester coverage: `tests/unit/**`, `tests/ingester-mode.spec.ts`

## 7) Notes / Known Deviations

- The provider file is still named `src/providers/Stream.tsx` for continuity, but it is polling-backed now.
- Busy-state truth comes from the backend. There is no client-side run ownership model anymore.
- Message metadata for branches/checkpoints is derived from `threads.getHistory({ limit: 100 })`; older checkpoints beyond that window may not expose branch controls in the UI.
- `LoadExternalComponent` still receives a `stream` prop because that is the upstream component API shape, even though the backing object is the polling runtime.
- `DEPLOYMENT_GUIDE.md` did not need changes for this migration because env vars and deployment flow stayed the same.
- Crafter history filters on `graph_id` since the modes change: a Crafter thread that was created but never had a run (no `graph_id`; for example its first run was refused by the daily limit) is no longer listed. The SDK's `threads.create` writes `metadata.graph_id` only from its `graphId` option, and `Stream.tsx` (unchanged) doesn't pass one. Stream keeps polling the selected Crafter thread while the user is in Ingester, so a Crafter run notice can appear there.

## Daily cost admission feedback (2026-10-08)

- `src/lib/user-limit-error.ts`: exact machine-code classification, separate quota and temporary-check-unavailable notices, and terminal SDK retry hook. Other throttling keeps the existing retry behavior.
- `src/app/page.tsx`: toaster sits outside the page loading boundary so notifications survive loading transitions. Quota notices stay at the top center for five seconds with a close button, midnight IST reset guidance and reporting-manager credit instructions.
- `src/providers/Stream.tsx` and `src/providers/client.ts`: shared retry hook; one actionable toast for rejected submissions.
- Composer, human-message editor, and agent-inbox approval paths await run admission, preserve rejected drafts, and suppress duplicate error/success messages.
- `tests/user-cost-limit.spec.ts` and `playwright.user-limits.config.ts`: deterministic SDK and browser coverage, without model calls.
- Runtime source `ca5faf6` is deployed to development and production. Release evidence and rollback target are recorded in `DEPLOYMENT_GUIDE.md`; earlier snapshots above remain historical.
- `src/components/thread/daily-budget.tsx`: quiet 24px static budget ring in a 36px composer-footer button. Hover/focus/tap reveals only remaining/total USD and percent used in a centered rounded tooltip; no other rows or labels. The coloured arc depicts used percentage over a neutral grey track. Green/amber/red thresholds are 50% and 75% of base plus extra credits; 0% has no coloured arc and exhausted/zero-allowance budgets are fully red. Minute/run-state refresh and unavailable state never fabricate a balance. Runtime provides the existing authenticated transport to `GET /user/limits`.
- Pending-approval reset effects compare interrupt contents, so identical polling responses keep single and batch edits intact.

## Attachment-limit release (2026-10-08)

- `main` and `develop` contain PR #7. Cloud Run development and production revisions are `agent-chat-ui-attachments-dev-1008` and `agent-chat-ui-attachments-prod-1008`; production receives 100% canonical traffic. Pinned image digests, source/tree identity, rollback target and exact hosted validation scope are recorded in `DEPLOYMENT_GUIDE.md`.
- All 26 local browser scenarios, standalone lint, production build and TypeScript checks passed. Hosted development rejected a three-PDF selection before upload; authenticated production displayed the new counters. No model call was made for acceptance.


## PDF page budget and receipt release (2026-10-08)

- Main and develop contain PRs #8, #9 and #10: combined 64-page admission, singleton preflight requests, actual-byte upload checks and reusable signed metadata. Receipt runtime source `baa71bd` and merge `8374d10` have identical tree `a393b7b75a5edfecd8beba9357ec4d7038e823ab`.
- Final develop revision `agent-chat-ui-pdf-receipt-dev-1008` retains the develop tag; production `agent-chat-ui-pdf-receipt-prod-1008` receives 100% canonical traffic. Exact digests, build region, backend prerequisite and rollback are recorded in DEPLOYMENT_GUIDE.md.
- Local build/lint/TypeScript and 41 unique checks passed, including actual PDF parsing, races/restoration, signed metadata, PAGE_COUNT without tokens, and Node-to-Python interoperability. Hosted upload acceptance remains unverified because Safari was in active use and the existing test-auth state was redirected to sign-in. No real upload/model run was made.
