# AGENTS.md - Agent Chat UI (fork)

## Project overview
- Next.js app that provides a chat UI for LangGraph servers (expects a `messages` key).
- This repo is a fork of `langchain-ai/agent-chat-ui`; fork-specific changes are documented in `FORK_COMPASS.md`.

## Start here (docs)
- `README.md`: setup, usage, env vars.
- `FORK_COMPASS.md`: authoritative map of fork customizations and file locations.
- `DEPLOYMENT_GUIDE.md`: build, push, and Cloud Run deployment steps.

## Local dev
- Package manager: `pnpm` (see `package.json` `packageManager` field).
- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint` (or `pnpm lint:fix`)
- Format: `pnpm format` / `pnpm format:check`

## Key areas (paths)
- Upload APIs: `src/app/api/upload/route.ts`, `src/app/api/openai/upload/route.ts`
- Content blocks + previews: `src/lib/multimodal-utils.ts`, `src/hooks/use-file-upload.tsx`, `src/components/thread/MultimodalPreview.tsx`, `src/components/thread/ContentBlocksPreview.tsx`
- Thread submission/streaming: `src/components/thread/index.tsx`, `src/providers/Stream.tsx`, `src/lib/constants.ts`, `src/components/thread/messages/human.tsx`
- UI tweaks/tool-call rendering: `src/components/thread/messages/tool-calls.tsx`

## Fork-specific behaviors to preserve
- Server-side upload pipeline: files go to GCS, return `gs://` + HTTPS URLs, 100MB max.
- OpenAI PDFs: when `MODEL_PROVIDER=OPENAI`, PDFs are uploaded to OpenAI Files and sent as `file` blocks with `source_type: "id"`.
- Non-OpenAI PDFs: sent as URL `file` blocks.
- Thread submissions include recursion limits and `onDisconnect: "continue"`.
- Stream reconnects on mount to resume runs.

## Documentation upkeep (required when behavior changes)
- Update `FORK_COMPASS.md`:
  - Refresh **Last updated** date and branch if needed.
  - Update Diff Snapshot numbers and the fork-only commit log after new fork commits.
  - Update section details and file index when paths or behavior change.
- Update `README.md` when env vars or user-facing setup/flows change.
- Update `DEPLOYMENT_GUIDE.md` when build args, env vars, or deployment steps change.
- Keep `.env.example` aligned with any env var changes.

## Upstream sync guidance
- The fork tracks `langchain-ai/agent-chat-ui` (upstream/main).
- When syncing upstream, prefer a clean merge, then re-validate fork customizations.
- After sync, update `FORK_COMPASS.md` Diff Snapshot + Notes/Deviations if needed.

## PR / commit message expectations
- In your response, include: summary of changes, tests run (or not run), and risks/assumptions.
- Suggest a conventional-commit style message (e.g., `feat:`, `fix:`, `chore:`, `docs:`).
- Do not commit or open PRs unless explicitly asked.

## Safety / data handling
- Avoid base64-heavy content blocks; use the upload pipeline for files.
- If modifying storage or OpenAI handling, verify env vars and bucket access behavior.
