# Plan: Restore Reliable Cancel Spinner

## 1. Current Behaviour (baseline repo)
- `src/providers/Stream.tsx` exposes the raw `useStream` return value without any extra tracking.
- `src/components/thread/index.tsx` renders the "Cancel" button only while `stream.isLoading` is `true`.
- `useStream` toggles `isLoading` back to `false` as soon as the SSE connection ends, even if the backend run keeps working (`onDisconnect: "continue"`, tab backgrounding, network hiccups, etc.).
- Opening the same thread in another tab mid-run sees no spinner because the new tab has no metadata to indicate an active run.

## 2. Goal
Keep the spinner accurate for the full lifetime of a run—even across disconnects and additional tabs—and hide it promptly once the run finishes, errors, or is cancelled.

## 3. Implementation Outline
1. **Enhance the Stream provider** (`src/providers/Stream.tsx`):
   - Track a per-thread `runSession` with `{ runId, status, updatedAt }`.
   - Capture `run_id` from streamed metadata when available.
   - Add helpers:
     - `ensureRunSession(threadId)` → return cached session or call `client.runs.list(threadId, { status: "running" | "pending", limit: 1 })`, falling back to the latest run; if nothing is returned but the thread state shows queued work, synthesize a `pending` session (using task IDs when possible).
     - `refreshThreadState(threadId)` → fetch `client.threads.getState` and cache latest messages so tabs that missed SSE still get updated output.
     - `cancelRun(threadId, runId)` → call `client.runs.cancel(threadId, runId, true)` and refresh state.
   - Expose these helpers and the session map via context.

2. **Create `useRunActivity` hook** (`src/hooks/useRunActivity.ts`):
   - Derive `isActive` from `stream.isLoading`, the session, and the latest thread state (`next` queue / unfinished tasks).
   - If `runId` is known, poll `client.runs.get` on a backoff schedule until status is terminal.
   - If no `runId` is known but queued work exists, poll `threads.getState` and re-run `ensureRunSession` until the run completes or metadata is recovered.
   - After each poll, invoke `refreshThreadState` so messages stay current.

3. **Update the composer UI** (`src/components/thread/index.tsx`):
   - Replace direct `stream.isLoading` checks with the hook’s `isActive` output (spinner, loading placeholder, disabling submit).
   - Wire the Cancel button to call both `stream.stop()` and `cancelRun` when a `runId` is available.

## 4. Testing Checklist
- Start a long run, then background the tab or drop the network: spinner stays until completion.
- Open the same thread in a new tab mid-run: both tabs show spinner and return to "Send" on completion.
- Cancel a run from any tab: spinner stops everywhere immediately.
- Trigger an error (e.g., invalid tool call): spinner clears and existing toast reports the failure.

*Awaiting approval before implementing these steps.*
