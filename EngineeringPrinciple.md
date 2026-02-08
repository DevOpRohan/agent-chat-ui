# Engineering Principles for Stable UX Updates

This document defines a practical delivery framework for high-stability UX changes in this codebase.

## Core Workflow

1. Research
- Read existing code paths end-to-end before changing behavior.
- Confirm current production behavior with logs, tests, and runtime inspection.
- Identify real failure modes, not only symptoms.

2. Plan
- Break the problem into subproblems (state, UI, API, retries, ownership, error handling).
- Define explicit success criteria and non-goals.
- Choose defaults for edge cases (timeouts, retries, fallback behavior).

3. Execute
- Implement smallest safe increments with clear state ownership.
- Prefer app-level state-machine handling over page reload hacks.
- Keep UX states consistent across all surfaces (composer, history, intermediate panels).

4. Deploy
- Build and deploy to `develop` first with pinned image tags.
- Avoid production traffic impact during validation.
- Track deployed revision IDs for traceability.

5. Test
- Run lint/build first.
- Run targeted E2E for the changed behavior.
- Run regression E2E for adjacent flows (history, reconnect, guardrails, cross-tab).
- Prefer deterministic assertions on durable UX outcomes over fragile timing-only UI flashes.

6. Iterate
- If a test fails, capture root cause, adjust hypothesis, and re-run.
- Do not assume first fix is sufficient; close the loop with deployed validation.

## Scratchpad Protocol

Maintain `scratchpad.md` throughout the task with timestamped entries:
- Problem statement
- Subproblem tree
- Strategy decisions
- Experiment log (command + pass/fail + observation)
- Deploy/test run log
- Failed hypotheses
- Final learnings

The scratchpad is mandatory for multi-step UX work and should be updated every iteration.

## Design Rules for Resilient UX

- Never depend on periodic page refresh for runtime recovery.
- Use explicit recoverable vs fatal error classification.
- Preserve user controls during transient failures (for example, keep `Cancel` available when appropriate).
- Ensure ownership transitions are explicit and race-safe, especially when IDs are assigned asynchronously.
- Clear local busy/owner markers only when server truth confirms completion.

## Definition of Done

A UX fix is done only when all are true:
- Behavior works in app-level runtime without manual refresh.
- Targeted + regression tests pass on deployed `develop`.
- Docs are updated (`README.md`, `FORK_COMPASS.md`, and workflow notes if needed).
- `scratchpad.md` contains complete traceable evidence.
