# Fork Compass — Agent Chat UI Customizations

_Last updated: 2026-10-08_
_Branch: main / develop_
_Runtime release: PR #7 (`597dcb8`, source `15f6f1c`)_
_Upstream project: langchain-ai/agent-chat-ui_

This document is the current map of fork-specific behavior in this worktree. The poll-first runtime is now the source-of-truth baseline for the fork, alongside the existing fork features that still matter: GCS/OpenAI uploads, IAP-backed auth, thread history, artifact rendering, and HITL flows.

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

Recent fork-only commit log:

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
- Each composer message permits at most **20 images and 2 PDFs**, independently. Picker, drop and paste use one admission path that reserves in-flight slots, rejects excess selections before network work and preserves successful uploads when a sibling fails. Removal releases capacity. Both counts are visible and announced politely; Enter waits for uploads.
- Upload APIs accept one file per request; the QuestionCrafter backend separately enforces per-message/tool aggregate attachment limits.

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
- Attachment browser coverage: `tests/attachment-limits.spec.ts`
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

## 7) Notes / Known Deviations

- The provider file is still named `src/providers/Stream.tsx` for continuity, but it is polling-backed now.
- Busy-state truth comes from the backend. There is no client-side run ownership model anymore.
- Message metadata for branches/checkpoints is derived from `threads.getHistory({ limit: 100 })`; older checkpoints beyond that window may not expose branch controls in the UI.
- `LoadExternalComponent` still receives a `stream` prop because that is the upstream component API shape, even though the backing object is the polling runtime.
- `DEPLOYMENT_GUIDE.md` did not need changes for this migration because env vars and deployment flow stayed the same.

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
