# Problem: History Spinner Latency + Cross-Thread Loading Consistency

## Current Status
- Active-thread highlighting is implemented in history.
- History supports run indicators (`Thread running`) and unseen updates.
- Cancel button is scoped to the currently active thread UI.
- One-time Playwright auth setup is implemented for QA (`tests/auth.setup.ts`).

## Remaining Issue
The history spinner timing is not always synchronized with the composer cancel/loading state.

Observed in QA:
- `tests/history-spinner-qa.spec.ts` has one failing test:
  - `history spinner starts/stops close to cancel spinner timing`
- Failure mode:
  - Cancel spinner is visible, but history spinner is sometimes not visible within the expected threshold.

## Why This Matters
- Users can misread run state when switching threads quickly.
- UX confidence drops when sidebar status lags the composer status.

## Target Behavior
For an existing active thread run:
1. When `Cancel` appears, history `Thread running` spinner should appear within a short bounded window.
2. When run stops (`Cancel` disappears), history spinner should stop within a short bounded window.
3. Switching to a new/inactive thread must not show `Cancel` there.
4. The old running thread should continue to show a history running indicator until completion.

## Acceptance Criteria
- QA test suite passes fully:
  - `tests/history-spinner-qa.spec.ts` (all tests green)
  - `tests/thread-history.spec.ts`
  - `tests/reconnect.spec.ts`
- No auth re-login required during a single Playwright run:
  - setup login once, reuse storage state.

## Test Command
Manual one-time login:

```bash
pnpm test:e2e:qa:manual
```

Non-manual run with saved auth:

```bash
pnpm test:e2e:qa
```
