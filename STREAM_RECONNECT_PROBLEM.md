# Stream Auto-Reconnect Failure — Problem Statement + Investigation Guide

_Last updated: 2026-01-28_

This document is a **high-detail, junior-friendly** problem statement and investigation guide for the **stream auto-reconnect on refresh** issue in this repo.

---

## 1) Summary (one paragraph)
When a streaming run is in progress and the user refreshes the page, the UI **does not automatically rejoin** the live stream. The expected behavior is: in the **same browser tab**, a refresh should reattach to the running stream (or show the final output if the run already completed). The UI is configured for resumable streams, but auto-rejoin is not consistently happening.

---

## 2) Why this matters
- Users lose live updates after refresh.
- This breaks the “resumable stream” promise and creates confusion (spinner, stale messages, or missing tokens).
- It is critical for long-running agent workflows.

---

## 3) Expected behavior
When a run is streaming and the page refreshes **in the same tab**:
- If the run is still active, the UI should **rejoin the live stream** and continue rendering tokens.
- If the run finished while the page was reloading, the UI should **show the final response** without a spinner.
- While rejoining and actively streaming, the **chatbox spinner should be visible** to indicate live activity.

---

## 4) Actual behavior (observed)
- Refresh does **not** rejoin the live stream.
- The UI may show a spinner or stale content.
- No 403s or network auth errors are seen in the console.

---

## 5) Preconditions and assumptions
These are required for auto-reconnect to work:
- The refresh occurs in the **same browser tab** (sessionStorage is per-tab).
- The URL includes the correct `?threadId=...` query parameter before refresh.
- A `runId` is stored in `sessionStorage` under key `lg:stream:<threadId>`.
- `streamResumable: true` is set on `stream.submit(...)`.
- `reconnectOnMount: true` is set in `useStream` options.

---

## 6) Quick reproduction steps (manual)
1) Start a run that streams for at least 10–20 seconds.
2) Wait until you see tokens streaming (2–3 seconds).
3) Refresh the **same tab** (do not open a new tab).
4) Observe whether the UI re-joins the live stream.

Expected: rejoin or final output.

---

## 7) Debug checklist (fast, practical)

### A) Verify threadId in URL
- Before refresh, URL should contain `?threadId=...`.
- If missing, rejoin cannot occur.

### B) Verify sessionStorage runId
Open DevTools → Application → Session Storage:
- Look for key: `lg:stream:<threadId>`
- If missing, the rejoin logic has nothing to attach to.

### C) Network rejoin call
In DevTools → Network (on refresh):
- Look for a request like:
  - `/api/threads/<threadId>/runs/<runId>/stream`
- If missing: reconnect didn’t trigger.
- If present and failing: check status and response body.

---

## 8) Codebase navigation (where to look)

### Client-side configuration
- `src/providers/Stream.tsx`
  - `useStream({ reconnectOnMount: true, fetchStateHistory: true })`

### Stream submission options
- `src/components/thread/index.tsx`
  - `stream.submit(..., { onDisconnect: "continue", streamResumable: true })`

### Underlying SDK logic (auto-reconnect implementation)
- `node_modules/@langchain/langgraph-sdk/dist/react/stream.lgp.cjs`
  - `reconnectOnMount` → reads `sessionStorage` and calls `joinStream`
  - runId storage key: `lg:stream:<threadId>`

---

## 9) Likely root causes (ordered by probability)
1) **runId not stored**
   - Refresh happens before the run is created, so `runId` never saved.
2) **threadId missing on refresh**
   - URL is missing `?threadId=...`.
3) **New tab (not refresh)**
   - `sessionStorage` is per-tab. New tabs can’t access the old runId.
4) **Run finishes before refresh**
   - If done, there is nothing to rejoin.
5) **Backend does not support resumable streams**
   - joinStream fails silently.

---

## 10) Suggested instrumentation (temporary, remove later)

### Client-side logs
Add debug logs in:
- `src/providers/Stream.tsx`
  - Log `threadId` on mount
  - Log when `onThreadId` is called

### SDK logs
Add short logs in:
- `node_modules/@langchain/langgraph-sdk/dist/react/stream.lgp.cjs`
  - Log when `runMetadataStorage.setItem(...)` is called
  - Log when `joinStream(...)` is invoked

---

## 11) Acceptance criteria
The issue is resolved if:
- Same-tab refresh during a long stream **rejoins within 1–2 seconds**, and tokens continue to flow.
- If the run finished, the UI shows the final content and stops the spinner.
- While streaming (including during reconnect), the **chatbox spinner is visible** and stops when the run ends.

---

## 12) Helpful internet search terms
Search official LangGraph / LangChain docs with:
- `useStream reconnectOnMount sessionStorage`
- `LangGraph streamResumable joinStream`
- `LangGraph SDK useStream runId sessionStorage`

---

## 13) Tips for junior devs
- Always confirm the URL contains `threadId` before refresh.
- Check `sessionStorage` first; it’s the most common failure point.
- Repro in the **same tab**, not a new tab.
- Don’t edit SDK code permanently; treat it as temporary instrumentation.
- If you change any behavior, update `FORK_COMPASS.md`.

---

## 14) Optional improvements (future)
If the design requirement is stronger than current behavior:
- Use `localStorage` for reconnect data so **new tabs can rejoin**.
- Add a small debug panel showing `threadId`, `runId`, and reconnect state.
- Add a retry/backoff on `joinStream` when network is slow.

---

## 15) Glossary
- **threadId**: unique conversation thread identifier.
- **runId**: unique run identifier for a specific stream invocation.
- **reconnectOnMount**: auto-join a resumable stream when the component mounts.
- **streamResumable**: server allows replaying/resuming the stream after disconnect.
