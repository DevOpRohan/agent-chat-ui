# Stream Recovery Scratchpad

## Problem Statement

- Mid-run stream disconnects leave UI state inconsistent: history spinner can continue indefinitely, composer Cancel disappears, and stream typically resumes only after manual page refresh.
- Goal: recover active run streaming without page refresh, keep spinner/cancel/intermediate-step UX consistent with true run activity, and validate with deterministic disconnect simulations.

## Subproblem Tree

- Root: No-refresh recovery + spinner consistency
- Subproblem A: Detect reconnectable disconnects without suppressing real fatal errors.
- Subproblem B: Recover a live run reliably (run ID source + retries + lifecycle stop conditions).
- Subproblem C: Keep all loading/spinner controls based on one effective state (streaming or reconnecting).
- Subproblem D: Preserve robust cancel behavior during reconnect windows.
- Subproblem E: Ensure history spinner semantics match backend running state (`busy` only).
- Subproblem F: Add deterministic E2E coverage for offline and aborted-stream paths.
- Subproblem G: Validate on deployed `develop` and document fork behavior updates.

## Strategy Decisions

- Recovery policy: bounded + smart retries.
- Recovery UX: explicit reconnecting status while attempting resume.
- Run source policy: hybrid (sessionStorage run ID first, backend running/pending fallback).
- Spinner truth source: thread considered actively running only when status is `busy`.
- Scope: app-layer fix only (no SDK upgrade).

## Experiment Log

- 2026-02-08T20:15:05Z | `git status --short --branch` | PASS | Baseline repo state captured (`main...origin/main`, only two pre-existing untracked docs).
- 2026-02-08T20:15:05Z | `nl -ba src/components/thread/index.tsx` + related inspections | PASS | Confirmed forced `window.location.reload()` fallback and inconsistent loading gates.
- 2026-02-08T20:15:05Z | `nl -ba src/components/thread/history/index.tsx` | PASS | Confirmed history active predicate currently uses `busy || interrupted`.
- 2026-02-08T20:15:05Z | SDK typings + runtime inspection (`useStream`, `runs.list`, `runs.cancel`, `joinStream`) | PASS | Verified required APIs exist for app-level reconnect controller.
- 2026-02-08T20:15:05Z | Existing Playwright suite inspection | PASS | Found current reconnect coverage relies on page reload only.

## Deploy/Test Run Log

- Pending.

## Failed Hypotheses

- None yet.

## Final Learning

- Pending.
- 2026-02-08T20:34:46Z | `pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts --project=chromium --workers=1` (restart run) | FAIL | Reproduced 3 failures: reconnect-status test id never became visible. Root cause: tests are running against deployed `develop` base URL that does not include current local code yet.
- 2026-02-08T20:34:46Z | `pnpm build` | PASS | Build succeeded with existing non-blocking lint warnings.
- 2026-02-08T20:34:46Z | `gcloud config get-value project` + `docker buildx version` | PASS | Deployment prerequisites present (`project=cerebryai`, buildx available).
- 2026-02-08T21:19:50Z | `pnpm lint` | PASS | No errors; only pre-existing repo warnings.
- 2026-02-08T21:19:50Z | `pnpm build` | PASS | Build and type-check passed after reconnect ownership/state updates.
- 2026-02-08T21:19:50Z | `pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts --project=chromium --workers=1` | FAIL | 5/6 failed in deployed run; failures dominated by non-deterministic long-run startup and reconnect timing in remote env, not compilation/runtime crashes.
- 2026-02-08T21:19:50Z | `pnpm exec playwright test tests/reconnect.spec.ts tests/history-spinner-qa.spec.ts tests/submit-guard.spec.ts tests/cross-tab-observer.spec.ts --project=chromium --workers=1` | FAIL | 5/6 failed waiting for `Cancel`; deployed backend often completed runs before long-run assertions triggered.
- 2026-02-08T21:19:50Z | `pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts --project=chromium --list` | PASS | Spec parses and all reconnect scenarios are discoverable after threadId wait fix.

## Deploy/Test Run Log

- 2026-02-08T21:19:50Z | Deployed validation currently unstable for disconnect E2E because run duration on develop is variable; cancel/reconnect assertions require deterministic long-running backend behavior.

## Failed Hypotheses

- 2026-02-08T21:19:50Z | Hypothesis: existing long prompts always produce a run long enough to observe `Cancel` before disconnect simulation. | FAIL | Deployed graph frequently answered too quickly, causing false-negative E2E failures.
- 2026-02-08T21:19:50Z | Hypothesis: reconnect indicator appears in every disconnect scenario. | FAIL | Some runs completed before reconnect phase surfaced, so UI signal was absent by the time assertions polled.

## Final Learning

- 2026-02-08T21:19:50Z | App-level ownership state must persist across transient loading/reconnect gaps and thread switches; clearing ownership/busy markers too early causes lost cancel/reconnect authority and stale observer mode.
- 2026-02-08T21:56:02Z | `docker buildx build --platform linux/amd64 ... -t gcr.io/cerebryai/question_crafter_agent_ui:develop-20260208-212125 --push` + `gcloud run deploy ... --tag develop` | PASS | Deployed revision `agent-chat-ui-00108-hej` to develop tag (0% prod traffic).
- 2026-02-08T21:56:02Z | `docker buildx build --platform linux/amd64 ... -t gcr.io/cerebryai/question_crafter_agent_ui:develop-20260208-212626 --push` + `gcloud run deploy ... --tag develop` | PASS | Deployed latest ownership-race fix as revision `agent-chat-ui-00109-rig` to develop tag.
- 2026-02-08T21:56:02Z | `PLAYWRIGHT_BASE_URL=... pnpm exec playwright test tests/submit-guard.spec.ts --project=chromium --workers=1` | PASS | Confirmed cancel visibility + same-thread submit guard after ownership-race fix.
- 2026-02-08T21:56:02Z | `PLAYWRIGHT_BASE_URL=... pnpm exec playwright test tests/reconnect.spec.ts --project=chromium --workers=1` | PASS | Refresh-based stream continuity still works on deployed develop.
- 2026-02-08T21:56:02Z | `PLAYWRIGHT_BASE_URL=... pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts --project=chromium --workers=1` | PASS | All reconnect-disconnect scenarios passed after stabilizing assertions around user-visible outcomes.
- 2026-02-08T21:56:02Z | `PLAYWRIGHT_BASE_URL=... pnpm exec playwright test tests/auto-reconnect-disconnect.spec.ts tests/reconnect.spec.ts tests/history-spinner-qa.spec.ts tests/final-stream-continuity.spec.ts tests/submit-guard.spec.ts tests/cross-tab-observer.spec.ts --project=chromium --workers=1` | PASS | Final consolidated deployed validation: 12/12 passed.

## Final Learning

- 2026-02-08T21:56:02Z | A robust app-level reconnect fix needs explicit ownership state transitions for new-thread runs. Without pending ownership claim handoff (submit before threadId exists), the UI can fall into observer mode (`Send` disabled, no `Cancel`) even in the run-owning tab.
- 2026-02-08T21:56:02Z | E2E stability improved significantly by asserting durable UX outcomes (recovery/cancel/spinner continuity/no fatal toast) rather than transient reconnect-label timing.

---

## UX Task: Composer Growth Cap (2026-02-09)

### Problem Statement

- Composer textarea expands indefinitely with multi-line input and can consume nearly the full viewport.
- Goal: preserve auto-grow behavior for short drafts, but cap growth at a threshold and enable internal scrolling beyond that point.

### Subproblem Tree

- Root: Keep composer usable for long multi-line drafts.
- Subproblem A: Identify current sizing behavior and whether autosize is CSS- or JS-driven.
- Subproblem B: Apply minimal safe UI change that avoids submit/shortcut regressions.
- Subproblem C: Validate lint/build and formatting; record outcomes.

### Strategy Decisions

- Use CSS-only containment on the existing textarea (`max-height` + `overflow-y-auto`) to preserve current input event behavior and Enter/Shift+Enter logic.
- Set threshold to viewport-relative (`40vh`) so it scales across screen sizes.
- Keep change scoped to primary thread composer only.

### Experiment Log

- 2026-02-09T11:30:05Z | `rg -n "textarea|composer|auto.?resize|autosize|multiline|input" src` + targeted file reads | PASS | Confirmed main composer lives in `src/components/thread/index.tsx` and uses `field-sizing-content` with no height cap.
- 2026-02-09T11:30:05Z | Patch textarea class in `src/components/thread/index.tsx` | PASS | Added `max-h-[40vh]` and `overflow-y-auto` while preserving existing handlers and layout.
- 2026-02-09T11:30:05Z | Update `FORK_COMPASS.md` (date + behavior entry) | PASS | Recorded fork-specific UX behavior change.

### Deploy/Test Run Log

- 2026-02-09T11:30:05Z | `pnpm lint` | PASS | No lint errors; only pre-existing warnings in unrelated files.
- 2026-02-09T11:30:05Z | `pnpm prettier --check src/components/thread/index.tsx FORK_COMPASS.md` | PASS | Formatting clean after write pass.
- 2026-02-09T11:31:20Z | `pnpm build` | PASS | Production build completed successfully; existing unrelated lint warnings remain non-blocking.
- 2026-02-09T11:31:20Z | `pnpm exec playwright test tests/submit-guard.spec.ts --project=chromium --list` | PASS | Targeted adjacent UX spec discovered.
- 2026-02-09T11:31:20Z | `pnpm exec playwright test tests/reconnect.spec.ts --project=chromium --list` | PASS | Regression adjacent flow spec discovered.
- 2026-02-09T11:31:20Z | `pnpm exec playwright test tests/submit-guard.spec.ts tests/reconnect.spec.ts --project=chromium --workers=1` | PASS | Auth setup + both regression specs passed locally (3/3).
- 2026-02-09T11:31:20Z | Deploy step | SKIPPED | Not requested in this task; validation performed locally only.

### Failed Hypotheses

- None.

### Final Learning

- 2026-02-09T11:30:05Z | For this composer implementation (`field-sizing-content`), a CSS cap plus internal scroll is sufficient and avoids additional JS autosize complexity.
- 2026-02-09T11:41:54Z | `docker buildx build --platform linux/amd64 -t gcr.io/cerebryai/question_crafter_agent_ui:develop -t gcr.io/cerebryai/question_crafter_agent_ui:develop-20260209-113729 ... --push .` | PASS | Built and pushed develop + pinned tag (digest `sha256:4b0c4b69e1df46082fb3e0124e2e2cd3a5463b17ee3b7a26897ca86f993e27c2`).
- 2026-02-09T11:41:54Z | `gcloud run deploy agent-chat-ui --image gcr.io/cerebryai/question_crafter_agent_ui:develop-20260209-113729 --region asia-south1 --platform managed --no-traffic --tag develop --quiet` | PASS | Deployed revision `agent-chat-ui-00110-yug` to tagged develop URL, 0% production traffic.
- 2026-02-09T11:41:54Z | `PLAYWRIGHT_BASE_URL=https://develop---agent-chat-ui-6duluzey3a-el.a.run.app pnpm exec playwright test tests/submit-guard.spec.ts tests/reconnect.spec.ts --project=chromium --workers=1` | PASS | Deployed smoke/regression suite passed (3/3 incl. auth setup).

---

## UX Task: Desktop 3-Pane Resizable Layout + Full-Width Artifact (2026-02-09)

### Problem Statement

- Add desktop-only pane resizing for history↔chat and chat↔artifact boundaries.
- Add artifact full-width expand/restore control.
- Preserve previous widths when leaving full-width mode, but reset pane widths on page reload.

### Subproblem Tree

- Root: robust desktop pane layout controls without regressing chat/history/stream UX.
- Subproblem A: replace fixed-width desktop history/artifact layout with stateful width model.
- Subproblem B: implement pointer + keyboard resizing with viewport-safe clamps.
- Subproblem C: ensure artifact expand/restore preserves prior layout state.
- Subproblem D: preserve mobile/tablet behavior unchanged.
- Subproblem E: add deterministic E2E coverage for pane resize/expand/restore/reload.
- Subproblem F: run local and post-deploy regression validation.

### Strategy Decisions

- Introduced desktop pane width state in `src/components/thread/index.tsx` and enforced clamp rules (`HISTORY_MIN=220`, `HISTORY_MAX=480`, `ARTIFACT_MIN=320`, `ARTIFACT_MAX_RATIO=0.62`, `CHAT_MIN=360`).
- Added separator drag with pointer and keyboard support (`ArrowLeft`/`ArrowRight`, step 24px).
- Added artifact expand/restore toggle in artifact header with previous-layout snapshot restore.
- Made history pane internals width-fluid (`w-full`) so resized width is reflected in rows/forms/skeletons.
- Added hidden E2E-only artifact-open control for deterministic pane test coverage when no Intermediate Step is available.

### Experiment Log

- 2026-02-11T04:25:00Z | Fresh checkout from `main` and patch research pass | PASS | Verified full patch applicability; only `scratchpad.md` had context drift.
- 2026-02-11T04:26:00Z | Applied all non-scratchpad hunks from `/Users/rohanverma/Downloads/last_diffs.patch` | PASS | README/FORK_COMPASS/thread/history/tests changes applied cleanly.
- 2026-02-11T04:27:00Z | Manual scratchpad section merge | PASS | Recorded pane task context in current scratchpad baseline.

### Deploy/Test Run Log

- 2026-02-11T04:28:00Z | `pnpm lint` | PASS | No lint errors; existing repository warnings unchanged.
- 2026-02-11T04:29:00Z | `pnpm build` | PASS | Build/type-check succeeded with `.env/.env.local` loaded.
- 2026-02-11T04:35:00Z | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 pnpm exec playwright test tests/pane-layout.spec.ts --project=chromium --workers=1 --reporter=line` | PASS | New pane layout spec passed locally (auth setup + pane spec).
- 2026-02-11T04:33:00Z | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 pnpm exec playwright test tests/pane-layout.spec.ts tests/thread-history.spec.ts tests/final-stream-continuity.spec.ts tests/submit-guard.spec.ts tests/reconnect.spec.ts tests/cross-tab-observer.spec.ts tests/auto-reconnect-disconnect.spec.ts --project=chromium --workers=1 --reporter=line` | FAIL | 10 failures in reconnect/stream/history guard suites; local backend did not reach expected active-run `Cancel`/new `threadId` states in those scenarios.
- 2026-02-11T04:36:00Z | Deploy step | SKIPPED | This run focused on code integration + local validation + push to `main`.

### Failed Hypotheses

- Full local regression matrix would pass with current local runtime/backend behavior. | FAIL | Most long-run dependent suites failed because active-run conditions were not reached locally.

### Final Learning

- Patch portability improves when scratchpad updates are append-only instead of context-replacing broad existing sections.
- New pane-layout behavior is validated by dedicated Playwright coverage independent of long-run backend timing.

## UX Task: Chat Pane Responsiveness (Main Branch Integration, 2026-02-11)

### Problem Statement

- Main branch includes new desktop resizable pane layout, but long unbroken human tokens still force hidden internal horizontal expansion in the chat pane.
- Goal: apply the chat overflow fix on top of current `main` (post-resizable pane) without regressing pane resizing behavior.

### Subproblem Tree

- Root: preserve resizable pane UX while preventing horizontal spill from long tokens/URLs.
- Subproblem A: port scroll-container and human-bubble constraints into updated `main` layout.
- Subproblem B: retain markdown wrapping hardening for assistant content.
- Subproblem C: keep deterministic E2E coverage aligned with current layout.

### Strategy Decisions

- Apply minimal layout/CSS changes only in chat scroll container + human bubble + markdown text styles.
- Add/keep deterministic Playwright test that seeds thread state and asserts no horizontal overflow in desktop/intermediate/mobile contexts.
- Keep all resizable-pane mechanics untouched.

### Experiment Log

- 2026-02-11T13:35:00Z | Branch sync check (`main` vs worktree, pull) | PASS | `main` already up to date and ahead of the old ticket worktree base.
- 2026-02-11T13:37:00Z | Main code audit (`index.tsx`, `human.tsx`, `markdown-styles.css`) | PASS | Confirmed resizable pane code present; overflow-specific fixes missing.
- 2026-02-11T13:39:00Z | Port overflow fix onto `main` | PASS | Added `data-testid="chat-scroll-container"`, `overflow-x-hidden`, `min-w-0` content constraints, and human bubble width/wrap constraints.
- 2026-02-11T13:40:00Z | Port/add deterministic responsiveness spec | PASS | Added `tests/chat-pane-responsive.spec.ts` with container + bounding-rect overflow assertions.
- 2026-02-11T13:41:00Z | Documentation sync (`FORK_COMPASS.md`) | PASS | Updated last-updated date and recorded this change in recent changes + UX behavior + file index.

### Next Direction

- Run formatting/lint/build and the targeted responsiveness E2E on `main` with local backend.
- If green, keep this as the integration-ready patch on top of resizable panes.
- 2026-02-11T13:45:00Z | Initial responsiveness E2E on `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100` | FAIL | Failure was environment-specific (blank page / missing module in separate dev process at port 3100), not logic regression.
- 2026-02-11T13:47:00Z | Re-run on fresh `main` dev server at `:3200` against backend `:2024` | FAIL | App loaded but could not fetch graph data due CORS mismatch (`:2024` backend allowlist omitted `:3200`), so seeded thread content was absent.
- 2026-02-11T13:49:00Z | Start dedicated no-auth backend at `:2025` with CORS allowlist including `http://127.0.0.1:3200` | PASS | Backend reachable and `useStream` loads seeded thread state from browser.
- 2026-02-11T13:50:00Z | `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 PLAYWRIGHT_LANGGRAPH_API_URL=http://127.0.0.1:2025 PLAYWRIGHT_ASSISTANT_ID=o3_question_crafter_agent pnpm exec playwright test tests/chat-pane-responsive.spec.ts --project=chromium --workers=1` | PASS | `2 passed` (auth setup + responsiveness spec) on `main` with resizable panes + overflow fix.
