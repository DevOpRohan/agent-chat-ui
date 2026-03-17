# Fork Compass — Agent Chat UI Customizations

_Last updated: 2026-03-17_
_Branch: codex/optimal-polling_
_Base: origin/codex/poll-runtime (`99d0aa8`)_
_Upstream project: langchain-ai/agent-chat-ui_

This document is the current map of fork-specific behavior in this worktree. It focuses on the poll-first runtime rewrite plus the existing fork features that still matter: GCS/OpenAI uploads, IAP-backed auth, thread history, artifact rendering, and HITL flows.

## 1) Executive Summary

This fork now uses a poll-first chat runtime.

- No SSE token streaming is used in the app runtime.
- The selected thread is reconciled from LangGraph REST APIs (`threads.get`, `threads.getState`, `threads.getHistory`, `runs.list`, `runs.cancel`).
- Refresh/remount/network recovery works by resuming polling while the backend thread remains `busy`.
- Cross-tab behavior is backend-driven only. If a thread is `busy`, every tab shows the same working state and blocks duplicate sends.
- Existing fork behavior for uploads, OpenAI PDF handling, recursion limits, `onDisconnect: "continue"`, thread history, artifact cards, and HITL resume/edit/regenerate is preserved.

## 2) Diff Snapshot

Working tree snapshot vs `origin/codex/poll-runtime` for this optimization branch:

- Files changed: `22`
- Insertions: `1080`
- Deletions: `4681`
- Snapshot note: excludes `tsconfig.tsbuildinfo`

Git state:

- `HEAD`: `99d0aa8`
- `origin/codex/poll-runtime`: `99d0aa8`
- Unique commits in this worktree: none yet
- Current optimization is still uncommitted on top of `origin/codex/poll-runtime`

## 3) Recent Change

- 2026-03-17: Optimize selected-thread polling for idle settled sessions by splitting lightweight status polling from full state hydration. Runtime now keeps `1500ms` for active thread/run states, uses `15000ms` for settled visible sessions, degrades to `60000ms` after 5+ minutes hidden/unfocused inactivity, and `120000ms` after 30+ minutes hidden/unfocused inactivity. Immediate refresh + full hydrate is triggered on focus, visibility regain, online, and throttled pointer/keyboard/scroll activity. Added pure polling heuristic tests. Main files: `src/providers/Stream.tsx`, `src/lib/poll-runtime-polling.ts`, `tests/poll-runtime-polling.spec.ts`, `README.md`, `FORK_COMPASS.md`.
- 2026-03-16: Replace the stream-driven runtime with a polling runtime. The app now creates runs with `client.runs.create`, polls thread/run state on a fixed schedule, resumes polling after refresh/remount, removes reconnect/finalization/observer-mode machinery, simplifies active UX to `Working on your query...`, deletes stream-only hooks/libs/tests, and keeps branch/checkpoint metadata through local history processing. Main files: `src/providers/Stream.tsx`, `src/lib/thread-branching.ts`, `src/components/thread/index.tsx`, `src/components/thread/messages/ai.tsx`, `src/components/thread/messages/human.tsx`, `src/components/thread/history/index.tsx`, `src/lib/thread-activity.ts`, `tests/polling-refresh.spec.ts`.

## 4) Customization Map

### 4.1 Upload Pipeline

What stays fork-specific:

- Uploads are handled server-side.
- Files are stored in GCS and returned as `gs://` plus HTTPS URLs.
- PDFs use OpenAI Files IDs when `MODEL_PROVIDER=OPENAI`.
- Non-OpenAI PDFs stay URL-backed.
- Upload size limit remains `100MB`.

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

Current runtime behavior:

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
  - `15000ms` while settled and visible/focused
  - `60000ms` after 5+ minutes hidden/unfocused inactivity
  - `120000ms` after 30+ minutes hidden/unfocused inactivity
  - retry backoff `3000ms`, `5000ms`, `10000ms`
- Settled background polling is lightweight (thread/run status first) and only hydrates full thread state when a material change or explicit user-return signal requires it.
- The provider performs immediate refresh on:
  - mount
  - thread switch
  - submit/edit/regenerate/resume
  - cancel completion
  - focus / visibility regain
  - online
  - throttled pointer / key / scroll interaction

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

Deleted as part of the poll-first migration:

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
