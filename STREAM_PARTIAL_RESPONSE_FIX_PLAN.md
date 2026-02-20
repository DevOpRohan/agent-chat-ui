# Deep Fix Plan: Mid-Stream Assistant Response Stops Until Refresh

**Date:** 2026-02-18
**Plan Type:** Implementation plan only (no code changes in this task)
**Related RCA:** `STREAM_PARTIAL_RESPONSE_ROOT_CAUSE_REPORT.md`

## 1) Objective
Eliminate the case where assistant output appears to stop mid-stream and only completes after a page refresh, while preserving existing fork behavior:
- `onDisconnect: "continue"`
- cross-tab observer mode
- same-thread submit guard
- reconnect UX (`Cancel`, history spinner, intermediate status)

## 2) Success Criteria
A fix is complete only if all are true:
1. No manual refresh required to get final assistant output after recoverable disconnect.
2. If backend run finishes while stream is disconnected, UI still reconciles to full final response.
3. `Cancel`, history spinner, and reconnect status remain consistent during recovery.
4. No regressions in submit blocking, observer mode, or interrupt handling.
5. Targeted + regression tests pass on deployed `develop`.

## 3) Non-Goals
- Rewriting SDK internals.
- Introducing new backend endpoints.
- Changing multitask strategy from `reject`.

## 4) Root-Cause Anchor (from RCA)
Primary gap: reconnect logic is active-run oriented and lacks guaranteed final hydration when reconnect misses the active window.

Concretely:
- Reconnect only attempts while `threadStatus === "busy"`.
- Run lookup only checks `running/pending` on fallback.
- If run completes before join succeeds, loop exits.
- Exit path does not enforce final history/state reconciliation.

## 5) Strategy (Chosen)
Use a **two-phase recovery model**:
- Phase A: try to rejoin active run quickly (existing behavior, hardened).
- Phase B: if active-window missed, perform deterministic **final reconciliation join** using freshest run metadata (including terminal runs) to force SDK history mutation and UI catch-up.

Why this strategy:
- Keeps architecture aligned with current SDK flow (`joinStream` -> `onSuccess` -> `history.mutate`).
- Avoids full page reload fallback.
- Minimal surface-area change (hook + classifier + tests).

## 6) Workstreams

### WS1: Harden reconnect eligibility and loop lifecycle
**Files:**
- `src/hooks/use-stream-auto-reconnect.ts`
- `src/components/thread/index.tsx`

**Plan:**
1. Keep current ownership checks.
2. Introduce explicit reconnect attempt context:
- whether reconnect was triggered by recoverable disconnect vs startup resume.
- whether at least one join attempt occurred.
3. Preserve current retry/backoff windows, but guarantee a final post-loop reconciliation hook if loop exits without successful join.

**Done when:** reconnect loop has explicit terminal branches: `joined_successfully`, `ended_without_join`, `aborted`, `expected_interrupt`.

### WS2: Expand run resolution to support terminal reconciliation
**Files:**
- `src/hooks/use-stream-auto-reconnect.ts`

**Plan:**
Create `resolveBestRunForRecovery(threadId)` with deterministic priority:
1. Session run id (`sessionStorage`) if present.
2. Freshest `running` run.
3. Freshest `pending` run.
4. Freshest run regardless of status (`runs.list(limit)`), restricted by recency window.

Track source + status for observability (debug logs).

**Done when:** reconnect path can still identify a valid run id even if active status transitioned to terminal during disconnect.

### WS3: Add deterministic final reconciliation step
**Files:**
- `src/hooks/use-stream-auto-reconnect.ts`

**Plan:**
When reconnect loop exits without successful join, run `attemptFinalReconciliation()` once:
1. Re-resolve best run id (WS2 logic).
2. Attempt `stream.joinStream(runId)` even for terminal statuses.
3. Treat `expected_interrupt_or_breakpoint` as benign exit.
4. If join succeeds, rely on SDK `onSuccess` history mutate to hydrate full messages.
5. If join fails fatally, set explicit non-blocking status state and stop reconnect cleanly.

**Important:** This reconciliation must not re-enter infinite retry loops.

**Done when:** post-disconnect terminal runs are synchronized to full final assistant output without page refresh.

### WS4: Broaden recoverable-disconnect classification
**Files:**
- `src/lib/stream-error-classifier.ts`

**Plan:**
Add recoverable signatures commonly seen in stream transport interruptions:
- gateway/service transient patterns (`502`, `503`, `504`, `bad gateway`, `service unavailable`, `gateway timeout`)
- upstream disconnect phrases (e.g., EOF/reset equivalents)

Keep conflict/interrupt/fatal boundaries intact.

**Done when:** transient infra disconnects trigger reconnect/reconcile instead of falling into silent stale state.

### WS5: UX state consistency during reconcile window
**Files:**
- `src/components/thread/index.tsx`
- `src/components/thread/messages/ai.tsx` (status label only if needed)

**Plan:**
1. Keep `effectiveIsLoading = isCurrentThreadLoading || isReconnecting`.
2. During final reconciliation, continue surfacing reconnect status text (do not prematurely show settled warning).
3. Keep `Cancel` visible while reconcile/join is in progress.
4. Clear status once hydration completes or recovery is conclusively finished.

**Done when:** no UX "dead zone" where run is done server-side but UI remains partial with no recovery signal.

### WS6: Test coverage upgrades for this exact regression
**Files:**
- `tests/auto-reconnect-disconnect.spec.ts`
- `tests/final-stream-continuity.spec.ts`
- add `tests/reconnect-final-reconcile.spec.ts` (new)

**Plan:**
Add a deterministic scenario where stream is dropped long enough for backend run to finish, then connectivity restored:
1. Start long run.
2. Force stream-route abort/offline window.
3. Wait for backend to leave active state.
4. Assert UI eventually catches full assistant output **without refresh**.
5. Assert no fatal error toast and send/cancel transitions remain valid.

Tighten assertions so tests do not pass merely on `sendVisible`/`reconnectVisible`; include message progression/catch-up checks.

**Done when:** regression cannot hide behind weak reconnect-indicator assertions.

### WS7: Observability and debugging guardrails
**Files:**
- `src/hooks/use-stream-auto-reconnect.ts`
- optionally `src/components/thread/index.tsx`

**Plan:**
Add guarded debug logging for recovery state machine transitions:
- attempt number
- selected run id/status/source
- join outcome
- reconciliation outcome

Gate via a debug flag to avoid noisy production logs.

**Done when:** future intermittent failures can be root-caused from client logs quickly.

### WS8: Documentation and traceability
**Files:**
- `FORK_COMPASS.md`
- `README.md` (if behavior wording changes)
- `scratchpad.md`

**Plan:**
1. Record behavior change and test evidence.
2. Update fork diff snapshot and recent commits section after implementation.
3. Add scratchpad entries per `EngineeringPrinciple.md` protocol.

**Done when:** behavior, rationale, and validation are auditably documented.

## 7) Execution Sequence (Safe Order)
1. Add WS2 run-resolution helper (no behavior switch yet).
2. Integrate WS3 final reconciliation path behind current reconnect loop.
3. Add WS4 classifier expansions.
4. Wire WS5 UX state handling (if needed after step 2).
5. Add WS7 debug instrumentation.
6. Implement WS6 tests.
7. Run lint/build and targeted suites.
8. Deploy to `develop` with pinned image tag.
9. Run deployed validation matrix.
10. Update docs (WS8).

## 8) Validation Matrix

### Local gates
1. `pnpm lint`
2. `pnpm build`
3. `pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts --project=chromium --workers=1`
4. `pnpm exec playwright test tests/reconnect-final-reconcile.spec.ts --project=chromium --workers=1`
5. `pnpm exec playwright test tests/final-stream-continuity.spec.ts --project=chromium --workers=1`
6. `pnpm exec playwright test tests/submit-guard.spec.ts tests/cross-tab-observer.spec.ts --project=chromium --workers=1`

### Deployed `develop` gates
Repeat the same suite with `PLAYWRIGHT_BASE_URL=<develop-url>`.

### Manual QA scenarios
1. Disconnect mid-generation; recover without refresh.
2. Disconnect near run completion; final text still appears without refresh.
3. Cross-tab observer during owner reconnect.
4. Cancel during reconnect/reconcile.
5. Interrupt/breakpoint path does not show fatal toast.
6. Same-thread submit remains blocked while run active.

## 9) Risk Register and Mitigations
1. **Risk:** Infinite reconnect/reconcile loops.
- **Mitigation:** hard cap to one reconciliation attempt per reconnect session + explicit terminal state.

2. **Risk:** Joining stale run id hydrates wrong checkpoint.
- **Mitigation:** choose freshest run with recency filter; log selected run source/status.

3. **Risk:** Over-classifying fatal errors as recoverable.
- **Mitigation:** keep explicit fatal default; only add signatures with verified transient semantics.

4. **Risk:** Regressions in observer/submit guard behavior.
- **Mitigation:** keep existing ownership predicate untouched; enforce regression suite.

## 10) Rollout and Rollback
### Rollout
1. Merge to feature branch.
2. Deploy to `develop` with pinned image tag.
3. Validate with full matrix.
4. Promote after stable runs.

### Rollback
- Revert reconnect hook/classifier changes as a single patch set.
- Keep prior reconnect behavior intact while preserving submit guard and observer logic.

## 11) Estimated Effort
- Implementation: 1-2 focused engineering days.
- Test hardening + debugging passes: 0.5-1 day.
- Deployed validation iterations: 0.5 day (depends on backend run-duration variability).

## 12) Acceptance Checklist
- [ ] No-refresh final output catch-up confirmed (local + deployed).
- [ ] Reconnect and terminal reconciliation paths both exercised in tests.
- [ ] No regressions in submit guard / observer / interrupt UX.
- [ ] Docs + scratchpad updated with evidence.
- [ ] Fork compass updated per repo rules.
