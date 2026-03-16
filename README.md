# Agent Chat UI

Agent Chat UI is a Next.js application which enables chatting with any LangGraph server with a `messages` key through a chat interface.

> [!NOTE]
> 🎥 Watch the video setup guide [here](https://youtu.be/lInrwVnZ83o).

## Setup

> [!TIP]
> Don't want to run the app locally? Use the deployed site here: [agentchat.vercel.app](https://agentchat.vercel.app)!

First, clone the repository, or run the [`npx` command](https://www.npmjs.com/package/create-agent-chat-app):

```bash
npx create-agent-chat-app
```

or

```bash
git clone https://github.com/langchain-ai/agent-chat-ui.git

cd agent-chat-ui
```

Install dependencies:

```bash
pnpm install
```

Run the app:

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`.

## Usage

Once the app is running (or if using the deployed site), you'll be prompted to enter:

- **Deployment URL**: The URL of the LangGraph server you want to chat with. This can be a production or development URL.
- **Assistant/Graph ID**: The name of the graph, or ID of the assistant to use when fetching, and submitting runs via the chat interface.
- **LangSmith API Key**: Optional and only shown when `NEXT_PUBLIC_AUTH_MODE` is not set to `iap`. Use it when your LangGraph deployment expects API-key auth.

After entering these values, click `Continue`. You'll then be redirected to a chat interface where you can start chatting with your LangGraph server.

> [!NOTE]
> This fork rejects concurrent sends on the **same thread** while a run is active. The UI shows a warning toast and keeps the current draft so the user can retry after completion.

> [!NOTE]
> If you open the same active thread in another tab, both tabs simply poll backend state. Send/regenerate stays disabled while the backend thread is `busy`, and the active badge is the same everywhere: `Working on your query...`.

> [!NOTE]
> Thread history refresh uses lightweight thread search fields, lazy-loads history in 20-thread batches as you scroll (with a "Loading more history..." spinner), and pauses polling when the history panel is closed or the browser tab is hidden.

> [!NOTE]
> You can rename a thread directly from its history row (pencil icon on hover/active row). The UI writes `thread_title` metadata via `threads.update(...)`, and the custom name is shown in chat history.

> [!NOTE]
> If your model/provider emits `reasoning` content blocks, assistant messages now show a compact “Thinking” panel with the latest 500 characters.

> [!NOTE]
> Intermediate reasoning/tool activity is surfaced through a single `Intermediate Step` launcher in chat. Clicking it opens the right artifact pane with ordered thinking, tool calls, and tool results from the latest polled thread snapshot. While a run is active, the launcher header still shows live status and a spinner.

> [!NOTE]
> On desktop (`>=1024px`), pane boundaries are resizable: drag between history↔chat and chat↔artifact to set widths. The artifact header also includes an expand/restore control for full-width artifact mode (hides chat/history until restored). Pane widths are session-local and reset on page reload.

> [!NOTE]
> Topic workflows can render a local `topic_preview_artifact` card in the assistant area. Clicking it opens the right artifact pane with a `Topic Preview` iframe and icon actions for JSON download, preview-link sharing, and iframe refresh.

> [!NOTE]
> Markdown workflows can render a local `markdown_artifact` card in the assistant area. Clicking it opens the right artifact pane with rendered markdown/LaTeX plus actions for opening the raw `.md`, sharing the link, and refreshing the preview.

> [!NOTE]
> This fork is poll-first. When a thread is active, the UI polls LangGraph for thread state and run status, resumes polling after refresh/remount/transient failures, and renders the latest backend snapshot once it lands. There is no client-side token stream join/rejoin path anymore.

> [!NOTE]
> The chat now includes a light/dark mode toggle in the top-right of the UI (and on the setup screen). Theme preference is persisted via `next-themes`.

## Environment Variables

You can bypass the initial setup form by setting the following environment variables:

```bash
NEXT_PUBLIC_API_URL=http://localhost:2024
NEXT_PUBLIC_ASSISTANT_ID=agent
# Optional: enable IAP-backed auth mode (hides API key UI)
NEXT_PUBLIC_AUTH_MODE=iap
# Required for IAP auth token minting (server-side)
IAP_AUDIENCE=/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME
LANGGRAPH_AUTH_JWT_SECRET=changeme
LANGGRAPH_AUTH_JWT_ISSUER=https://your-company.example
LANGGRAPH_AUTH_JWT_AUDIENCE=https://your-langgraph.example
# Bucket used for uploading attachments
GCS_BUCKET_NAME=my-chat-bucket
# Provider selection (affects client hints and server behavior)
NEXT_PUBLIC_MODEL_PROVIDER=OPENAI
MODEL_PROVIDER=OPENAI
```

> [!TIP]
> If you want to connect to a production LangGraph server, read the [Going to Production](#going-to-production) section.

To use these variables:

1. Copy the `.env.example` file to a new file named `.env`
2. Fill in the values in the `.env` file
3. Restart the application

When these environment variables are set, the application will use them instead of showing the setup form.

> [!NOTE] > `NEXT_PUBLIC_API_URL` should point directly at your LangGraph deployment (not the Next.js `/api` route).

> [!NOTE]
> When `NEXT_PUBLIC_AUTH_MODE=iap`, the UI calls `/api/auth/token` to validate IAP headers and mint a LangGraph JWT for `Authorization: Bearer <token>`.

> [!NOTE]
> For image/PDF uploads, this project now:
>
> - Sends images as URL content blocks for small client payloads and fast previews.
> - Sends PDFs as file ID blocks when using OpenAI (to satisfy LangChain’s OpenAI converter), or as URL blocks for other providers. See FORK_COMPASS.md for details.

### Additional Docs

- Fork customization guide (includes upload refactor details): `FORK_COMPASS.md`
- Build, push, and Cloud Run deployment: `DEPLOYMENT_GUIDE.md`

## E2E Testing (Playwright)

Run all E2E tests:

```bash
pnpm test:e2e
```

Run QA spinner-focused E2E tests:

```bash
pnpm test:e2e:qa
```

For IAP-protected environments, use one manual login session for the full run:

```bash
pnpm test:e2e:manual
pnpm test:e2e:qa:manual
```

When manual mode is on, Playwright pauses once in setup. Complete login in the opened browser and click **Resume** in Playwright Inspector. The saved auth state is reused for the remaining tests in that run.

E2E suites now gate themselves per environment:

- If the app is behind IAP and auth is missing/invalid, tests auto-skip with an explicit reason instead of hard failing.
- If the bootstrap setup screen is visible (missing runtime setup), tests auto-skip with a setup-required reason.

To run full assertions on IAP-protected deploys, provide either:

- `PLAYWRIGHT_AUTH_BEARER` with a valid IAP audience token, or
- `PLAYWRIGHT_MANUAL_LOGIN=1` and complete setup login interactively.

For specs that seed backend data (for example `chat-pane-responsive.spec.ts`), also set `PLAYWRIGHT_LANGGRAPH_API_URL`.

## Hiding Messages in the Chat

This fork does not render live token streams. Assistant output appears when the next poll sees updated backend state, so `langsmith:nostream` is not needed for UI suppression here.

To ensure a message is never displayed in the chat UI, prefix its `id` field with `do-not-render-` before adding it to the graph's state, along with adding the `langsmith:do-not-render` tag to the chat model's configuration. The UI explicitly filters out any message whose `id` starts with this prefix.

_Python Example:_

```python
result = model.invoke([messages])
# Prefix the ID before saving to state
result.id = f"do-not-render-{result.id}"
return {"messages": [result]}
```

_TypeScript Example:_

```typescript
const result = await model.invoke([messages]);
// Prefix the ID before saving to state
result.id = `do-not-render-${result.id}`;
return { messages: [result] };
```

This guarantees the message remains hidden from the user interface.

## Rendering Artifacts

Artifacts render in the right-side pane through the local artifact provider in [`src/components/thread/artifact.tsx`](./src/components/thread/artifact.tsx). Custom UI events are mapped in [`src/components/thread/messages/ai.tsx`](./src/components/thread/messages/ai.tsx) and can open pane content through `useArtifact()`:

```tsx
import { useArtifact } from "@/components/thread/artifact";

export function Writer(props: {
  title?: string;
  content?: string;
  description?: string;
}) {
  const [Artifact, { open, setOpen }] = useArtifact();

  return (
    <>
      <div
        onClick={() => setOpen(!open)}
        className="cursor-pointer rounded-lg border p-4"
      >
        <p className="font-medium">{props.title}</p>
        <p className="text-sm text-gray-500">{props.description}</p>
      </div>

      <Artifact title={props.title}>
        <p className="p-4 whitespace-pre-wrap">{props.content}</p>
      </Artifact>
    </>
  );
}
```

The built-in fork components currently include `topic_preview_artifact` and `markdown_artifact`.

## Going to Production

Once you're ready to go to production, you'll need to ensure the frontend calls LangGraph directly and uses an auth mechanism that doesn't require every user to bring their own API key. This fork supports two options.

### Recommended: IAP + LangGraph Custom Auth

1. Enable IAP on the frontend service and note the Signed Header JWT audience (`IAP_AUDIENCE`).
2. Configure custom auth in your LangGraph deployment (per the LangGraph auth docs).
3. Build the frontend with `NEXT_PUBLIC_API_URL` pointing directly to your LangGraph deployment URL, `NEXT_PUBLIC_ASSISTANT_ID` set to your assistant/graph ID, and `NEXT_PUBLIC_AUTH_MODE=iap`.
4. Set runtime env vars on the frontend service: `IAP_AUDIENCE`, `LANGGRAPH_AUTH_JWT_SECRET`, `LANGGRAPH_AUTH_JWT_ISSUER`, `LANGGRAPH_AUTH_JWT_AUDIENCE`.

The frontend will call `/api/auth/token`, validate the IAP signed header, mint a LangGraph JWT, and then send `Authorization: Bearer <token>` on all LangGraph requests.

### API Key Auth (no IAP)

If your LangGraph deployment expects API keys, leave `NEXT_PUBLIC_AUTH_MODE` unset and enter the key in the UI. `NEXT_PUBLIC_API_URL` should still point directly to your LangGraph deployment URL.
