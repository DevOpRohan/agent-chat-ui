# Root Cause Analysis Report: Partial Assistant Stream Stops Until Page Refresh

**Date:** 2026-02-18
**Project:** `agent-chat-ui` (fork)
**Requested by:** User report: "assistant response sometimes stops in middle; refresh shows full response"

## Executive Summary
The primary root cause is a **recovery gap in the client reconnect flow**:

1. Reconnect logic only attempts to rejoin while thread status is `busy`.
2. Run lookup only targets `running`/`pending` runs when no stored run ID is available.
3. If the backend run completes during/after disconnect (before rejoin succeeds), the reconnect loop exits.
4. On that exit path, the UI does **not** perform a final thread-state/history reconciliation.
5. The UI remains on a partial in-memory stream snapshot until a full page refresh rehydrates from backend history.

This exactly matches the observed symptom: **stream appears to stop mid-response, refresh shows full answer**.

## Investigation Scope
Reviewed end-to-end flow for submit, streaming, disconnect handling, reconnect, and state hydration:

- `src/components/thread/index.tsx`
- `src/hooks/use-stream-auto-reconnect.ts`
- `src/providers/Stream.tsx`
- `src/lib/stream-error-classifier.ts`
- `node_modules/@langchain/langgraph-sdk/dist/react/stream.lgp.js`
- `node_modules/@langchain/langgraph-sdk/dist/client.js`
- reconnect-related Playwright tests under `tests/`

## Evidence

### 1) Reconnect starts only when `threadStatus === "busy"`
- `src/hooks/use-stream-auto-reconnect.ts:186`
- Condition requires all of:
  - thread exists
  - `threadStatus === "busy"`
  - `!stream.isLoading`
  - ownership predicate

If status is already `idle` by the time disconnect is processed, reconnect will not start.

### 2) Active run resolution excludes completed runs
- `src/hooks/use-stream-auto-reconnect.ts:234`
- Fallback lookup checks only:
  - `runs.list(..., { status: "running" })`
  - `runs.list(..., { status: "pending" })`
- No completion reconciliation path when those are empty.

### 3) Reconnect loop exits when thread no longer busy, without final state sync
- Loop stop behavior:
  - `src/hooks/use-stream-auto-reconnect.ts:282`
  - `src/hooks/use-stream-auto-reconnect.ts:418`
- `stopReconnect()` resets local reconnect state only:
  - `src/hooks/use-stream-auto-reconnect.ts:219`
- No explicit fetch of latest thread state/history in this exit path.

### 4) Full history mutation happens only on successful stream/join success paths
- SDK stream success path triggers history mutate:
  - `node_modules/@langchain/langgraph-sdk/dist/react/stream.lgp.js:300`
- SDK join success path triggers history mutate:
  - `node_modules/@langchain/langgraph-sdk/dist/react/stream.lgp.js:339`
- If join does not succeed, this mutate does not happen.

### 5) Run ID persistence is best-effort and header-dependent
- Run ID extraction relies on `Content-Location` response header:
  - `node_modules/@langchain/langgraph-sdk/dist/client.js:75`
- If header is not exposed/available, stored run ID path is unavailable, increasing reliance on `running/pending` polling only.

### 6) Existing reconnect test can pass without validating full assistant catch-up
- `tests/auto-reconnect-disconnect.spec.ts:249`
- Test pass condition allows `sendVisible`/`reconnectVisible` even if assistant text did not fully recover.
- This leaves the partial-final-output regression path under-tested.

### 7) Known architecture deviation increases risk for stuck streaming sessions
- `FORK_COMPASS.md:451`
- Stream health polling was removed; current behavior relies on disconnect/error-driven recovery.
- Silent or edge-case stalls can evade recovery triggers.

## Failure Timeline (Observed Logical Path)
1. User starts a run; assistant output streams.
2. Mid-stream disconnect/error occurs.
3. Backend run continues (`onDisconnect: "continue"` in submit options).
4. Reconnect either does not start (thread no longer `busy`) or cannot find active run (`running/pending` empty).
5. Reconnect loop ends with no history/state reconciliation.
6. UI stays on partial stream snapshot.
7. User refreshes page.
8. Initial load fetches latest thread history/state and full assistant response appears.

## Why Refresh Fixes It
On mount, the stream provider initializes with `fetchStateHistory: true` (`src/providers/Stream.tsx:146`). A refresh reconstructs UI from backend state/history, bypassing the stale in-memory partial stream snapshot.

## Confidence
**High** for the primary root-cause chain above, based on direct code-path evidence and alignment with symptom pattern.

## Contributing Factors
- Strict reconnect gate on `threadStatus === "busy"`.
- No terminal reconciliation step after unsuccessful reconnect.
- Run-ID storage dependency on `Content-Location` header availability.
- Test assertions do not enforce "final assistant text fully catches up after disconnect".

## Conclusion
The issue is not a single renderer glitch; it is a **state-recovery design gap**: reconnect is active-run oriented, but there is no guaranteed final backend state hydration when reconnection misses the active window. This is why users intermittently need manual refresh to see the full assistant response.
