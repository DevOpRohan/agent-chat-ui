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
> If you open the same active thread in another tab, that tab enters observer mode while the run is in progress: send stays disabled for that thread, draft text is preserved, expected breakpoint/interrupt/cancel stream signals are not shown as fatal error toasts, and the composer shows a reload hint for stale cross-tab/cross-browser/device sync states.

> [!NOTE]
> Thread history refresh uses lightweight thread search fields, lazy-loads history in 20-thread batches as you scroll (with a "Loading more history..." spinner), and pauses polling when the history panel is closed or the browser tab is hidden.

> [!NOTE]
> You can rename a thread directly from its history row (pencil icon on hover/active row). The UI writes `thread_title` metadata via `threads.update(...)`, and the custom name is shown in chat history.

> [!NOTE]
> If your model/provider emits `reasoning` content blocks, assistant messages now show a compact “Thinking” panel with the latest 500 characters.

> [!NOTE]
> Intermediate reasoning/tool activity is now surfaced through a single `Intermediate Step` launcher in chat. Clicking it opens the right artifact pane with ordered thinking, tool calls, and tool results (including streaming/parallel tool-call updates).
> While a run is still streaming, the `Intermediate Step` header shows live status and a spinner.

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

## Hiding Messages in the Chat

You can control the visibility of messages within the Agent Chat UI in two main ways:

**1. Prevent Live Streaming:**

To stop messages from being displayed _as they stream_ from an LLM call, add the `langsmith:nostream` tag to the chat model's configuration. The UI normally uses `on_chat_model_stream` events to render streaming messages; this tag prevents those events from being emitted for the tagged model.

_Python Example:_

```python
from langchain_anthropic import ChatAnthropic

# Add tags via the .with_config method
model = ChatAnthropic().with_config(
    config={"tags": ["langsmith:nostream"]}
)
```

_TypeScript Example:_

```typescript
import { ChatAnthropic } from "@langchain/anthropic";

const model = new ChatAnthropic()
  // Add tags via the .withConfig method
  .withConfig({ tags: ["langsmith:nostream"] });
```

**Note:** Even if streaming is hidden this way, the message will still appear after the LLM call completes if it's saved to the graph's state without further modification.

**2. Hide Messages Permanently:**

To ensure a message is _never_ displayed in the chat UI (neither during streaming nor after being saved to state), prefix its `id` field with `do-not-render-` _before_ adding it to the graph's state, along with adding the `langsmith:do-not-render` tag to the chat model's configuration. The UI explicitly filters out any message whose `id` starts with this prefix.

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

This approach guarantees the message remains completely hidden from the user interface.

## Rendering Artifacts

The Agent Chat UI supports rendering artifacts in the chat. Artifacts are rendered in a side panel to the right of the chat. To render an artifact, you can obtain the artifact context from the `thread.meta.artifact` field. Here's a sample utility hook for obtaining the artifact context:

```tsx
export function useArtifact<TContext = Record<string, unknown>>() {
  type Component = (props: {
    children: React.ReactNode;
    title?: React.ReactNode;
  }) => React.ReactNode;

  type Context = TContext | undefined;

  type Bag = {
    open: boolean;
    setOpen: (value: boolean | ((prev: boolean) => boolean)) => void;

    context: Context;
    setContext: (value: Context | ((prev: Context) => Context)) => void;
  };

  const thread = useStreamContext<
    { messages: Message[]; ui: UIMessage[] },
    { MetaType: { artifact: [Component, Bag] } }
  >();

  return thread.meta?.artifact;
}
```

After which you can render additional content using the `Artifact` component from the `useArtifact` hook:

```tsx
import { useArtifact } from "../utils/use-artifact";
import { LoaderIcon } from "lucide-react";

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
