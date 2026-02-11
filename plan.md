# Fix: React Error #185 & ThinkingPanel Flickering During Streaming

## Context

**What's happening:** During message streaming (especially with reasoning/thinking blocks), the app intermittently crashes with React error #185 ("Maximum update depth exceeded"). The ThinkingPanel also visibly "refreshes" (flickers/jumps) instead of streaming text smoothly. Both are symptoms of the same root cause: cascading state updates in the Thread component that amplify during streaming.

**Why now:** The busy-state tracking system (for cross-tab coordination) introduced 5 interdependent `useEffect` hooks that update overlapping state variables. Each state write triggers another effect, creating a feedback loop that exceeds React's 50-update-per-render limit. The ThinkingPanel flickering is a downstream consequence — the Thread component re-renders many times per token, and since `AssistantMessage` lacks `React.memo`, every re-render propagates down to ThinkingPanel.

---

## Problem 1: The Cascading useEffect Loop

### The State Dependency Graph

Five effects in `src/components/thread/index.tsx` (lines 689-773) update the same two state variables (`loadingThreadId`, `ownedBusyThreadId`) with overlapping dependency arrays:

```
effectiveIsLoading changes (stream starts/stops/reconnects)
  │
  ├─► Effect A (L689): reads effectiveIsLoading, threadStatus, busyOwnerByThreadId
  │   WRITES: loadingThreadId, ownedBusyThreadId, calls markBusy()
  │     │
  │     ├─► markBusy() dispatches CustomEvent
  │     │     └─► useThreadBusy subscription fires
  │     │           └─► setBusyByThreadId + setBusyOwnerByThreadId
  │     │                 └─► Thread re-renders
  │     │                       └─► busyOwnerByThreadId changed → Effect A re-runs ← LOOP
  │     │
  │     └─► loadingThreadId changed → Effect B triggered
  │
  ├─► Effect B (L729): reads ownedBusyThreadId, loadingThreadId
  │   WRITES: ownedBusyThreadId → triggers Effects D, E
  │
  ├─► Effect C (L746): reads busyByThreadId, threadStatus
  │   WRITES: loadingThreadId, ownedBusyThreadId, calls markBusy() → triggers A, B
  │
  ├─► Effect D (L757): reads ownedBusyThreadId, effectiveIsLoading, threadStatus
  │   WRITES: ownedBusyThreadId → triggers B, E
  │
  └─► Effect E (L769): reads ownedBusyThreadId, busyByThreadId
      WRITES: ownedBusyThreadId → triggers B, D
```

**The amplifier:** The thread-status polling effect (L595-639) has `effectiveIsLoading` in its dependency array. Any change to `effectiveIsLoading` tears down and restarts polling → calls `setThreadStatus` → triggers Effects A, C, D → which change `loadingThreadId` → which changes `effectiveIsLoading` → polling restarts again.

### Why it's intermittent

The loop requires a specific timing window: `effectiveIsLoading` must toggle while `markBusy()` events are still propagating. This happens most often during:

- Stream completion (isLoading: true→false) while thread is still "busy" on server
- Reconnection attempts (isReconnecting flips)
- Rapid reasoning token streaming (many re-renders per second amplify the cascade)

---

## Problem 2: ThinkingPanel Flickering

### The Re-render Chain

```
Stream token arrives
  → stream.messages reference changes
  → Thread component re-renders (via useStreamContext)
  → effectiveIsLoading may also change (cascade from Problem 1)
  → AssistantMessage re-renders (subscribes to StreamContext + unstable props)
  → groupedIntermediateParts rebuilt (no useMemo, new arrays/objects)
  → ThinkingPanel receives new `text` prop
  → getReasoningPreview(text) returns new string ref via .slice()
  → useEffect fires (previewText dependency changed)
  → scrollToBottom() → DOM scroll → onScroll handler → setStickToBottom()
  → ThinkingPanel re-renders AGAIN
```

Each token causes **2+ full re-renders** of ThinkingPanel, plus re-renders from the Problem 1 cascade. The visual result is flickering rather than smooth text append.

**Critical blocker for React.memo:** AssistantMessage calls `useStreamContext()` at line 928. Context updates bypass `React.memo` entirely — React re-renders all context consumers regardless of memo. Since the stream context value changes on every token (`stream.messages` updates), plain `React.memo` on AssistantMessage is useless without also removing the context subscription.

---

## Approach: 4 Targeted Fixes

### Fix 1: Replace 5 cascading effects with a single `useReducer` + 1 consolidated effect

**File:** `src/components/thread/index.tsx`

**What:** Replace the `useState` calls for `loadingThreadId` and `ownedBusyThreadId` (plus their 5 effects) with a single `useReducer` that computes the next state synchronously in one pass.

**The reducer:**

```typescript
type BusyState = {
  loadingThreadId: string | null;
  ownedBusyThreadId: string | null;
};

type BusyAction =
  | {
      type: "STREAM_STARTED";
      threadId: string;
      tabId: string | null;
      busyOwner: string | undefined;
    }
  | {
      type: "STREAM_STOPPED";
      threadId: string | null;
      threadStatus: string | null;
    }
  | {
      type: "BUSY_MAP_CHANGED";
      threadId: string | null;
      busyByThreadId: ThreadBusyMap;
      effectiveIsLoading: boolean;
      threadStatus: string | null;
    }
  | { type: "THREAD_CHANGED"; threadId: string | null }
  | {
      type: "CLEANUP_OWNED";
      threadId: string | null;
      effectiveIsLoading: boolean;
      threadStatus: string | null;
      busyByThreadId: ThreadBusyMap;
    };

function busyStateReducer(state: BusyState, action: BusyAction): BusyState {
  // All 5 effects' logic unified into a single synchronous function
  // Returns new state ONLY if something actually changed
  // No cascading — React batches the dispatch into one render
}
```

**One consolidated effect** watches the inputs (`effectiveIsLoading`, `threadStatus`, `busyByThreadId`, `busyOwnerByThreadId`) and dispatches the appropriate action. `markBusy()` side-effects are called from the effect body after the dispatch, using the **previous** and **next** state to determine if marking is needed.

**Why this works (theoretical proof):**

- **React guarantees** `useReducer` dispatches are processed synchronously within the same render — no intermediate states, no cascading re-renders between updates
- The 5 effects each do `setState(X) → trigger effect → setState(Y)` across multiple renders. A reducer does `(oldState, action) → newState` in **one synchronous step**, so there's exactly **1 re-render per action** instead of 5+
- `markBusy()` side-effects are moved outside the reducer (effects can have side-effects, reducers can't), but they're called **after** the state is settled, breaking the `markBusy → event → state update → effect → markBusy` loop

**Scope of change:**

- Remove: `useState` for `loadingThreadId` (L320), `ownedBusyThreadId` (L322-324)
- Remove: Effects at L689-727, L729-744, L746-755, L757-767, L769-773
- Add: `busyStateReducer` function + `useReducer` call + 1 consolidated `useEffect`
- All downstream reads of `loadingThreadId` and `ownedBusyThreadId` change to read from `busyState.loadingThreadId` / `busyState.ownedBusyThreadId`

### Fix 2: Decouple polling from `effectiveIsLoading` via ref

**File:** `src/components/thread/index.tsx`

**What:** The polling effect (L595-639) uses `effectiveIsLoading` to decide poll frequency (2.5s vs 15s). But having it in the dependency array means the **entire polling loop restarts** on every `effectiveIsLoading` change. Instead, store `effectiveIsLoading` in a ref and read from the ref inside the polling callback.

```typescript
const effectiveIsLoadingRef = useRef(effectiveIsLoading);
effectiveIsLoadingRef.current = effectiveIsLoading;

useEffect(() => {
  // ... polling logic ...
  const shouldPollFast =
    isThreadActiveStatus(currentThread.status) ||
    effectiveIsLoadingRef.current || // ← read from ref, not closure
    isThreadBusyInAnyTab;
  // ...
}, [threadId, stream.client, isThreadBusyInAnyTab, isCurrentThreadOwnedByTab]);
// ^^^ effectiveIsLoading REMOVED from deps
```

**Why this works:**

- Refs don't cause re-renders and aren't dependencies — the polling loop continues uninterrupted
- The **next** poll iteration reads the **current** value of `effectiveIsLoading` via the ref
- Polling frequency still adapts, but without tearing down/restarting the entire polling chain
- Eliminates the `effectiveIsLoading change → polling restart → setThreadStatus → effects cascade → effectiveIsLoading change` amplification loop

**Scope:** ~5 lines changed in the polling effect (L595-639)

### Fix 3: Decouple AssistantMessage from stream context + stabilize ThinkingPanel

**Problem with naive `React.memo`:** AssistantMessage calls `useStreamContext()` at line 928. Context updates bypass `React.memo` entirely — React re-renders all context consumers regardless of memo. Since the stream context value changes on every token (`stream.messages` updates), plain `React.memo` is useless here.

**Files:** `src/components/thread/messages/ai.tsx` + `src/components/thread/index.tsx`

#### 3a. Extract context consumption from AssistantMessage into Thread

AssistantMessage only needs these fields from the stream context:

- `thread.getMessagesMetadata(message)` — stable function ref
- `thread.interrupt` — changes only on interrupt events (rare)
- `thread.setBranch(branch)` — stable function ref
- `hasCustomComponentsForMessage` — boolean derived in Thread from `stream.values.ui`

**None of these change on every streaming token.** The re-renders are caused by subscribing to the entire context (which includes `stream.messages`).

**In Thread component** (`src/components/thread/index.tsx`), extract and pass as props:

```typescript
// Already available as `stream`:
const threadInterrupt = stream.interrupt;
const getMessagesMetadata = stream.getMessagesMetadata;
const setBranch = stream.setBranch;
const hasCustomComponentsForMessage = ... // derived from stream.values.ui

<AssistantMessage
  message={message}
  allMessages={displayMessages}
  isLoading={effectiveIsLoading}
  isReconnecting={isReconnecting}
  handleRegenerate={handleRegenerate}
  // New props (extracted from context):
  interrupt={threadInterrupt}
  getMessagesMetadata={getMessagesMetadata}
  onSelectBranch={setBranch}
  hasCustomComponentsForMessage={hasCustomComponentsForMessage}
/>
```

**In AssistantMessage** (`ai.tsx`), replace `const thread = useStreamContext()` with prop usage:

```typescript
export const AssistantMessage = React.memo(function AssistantMessage({
  message,
  allMessages,
  isLoading,
  isReconnecting,
  handleRegenerate,
  interrupt,
  getMessagesMetadata,
  onSelectBranch,
  hasCustomComponentsForMessage,
}: AssistantMessageProps) {
  // Remove: const thread = useStreamContext();
  const meta = message ? getMessagesMetadata(message) : undefined;
  const threadInterrupt = interrupt;
  // branch select uses onSelectBranch
  // placeholder hide logic uses hasCustomComponentsForMessage
  // ...
});
```

**Why this works:**

- By removing `useStreamContext()` from AssistantMessage, it no longer subscribes to the stream context
- `React.memo` now works properly — it only re-renders when props actually change
- During streaming, stable function/primitive props (`interrupt`, `getMessagesMetadata`, `setBranch`) avoid context-driven rerenders
- `allMessages` still changes each token, so comparator design must be message-scope-aware

#### 3b. Custom memo comparator for `allMessages` stability

`allMessages` (= `displayMessages`) changes reference on every token. A naive `React.memo` would still re-render all AssistantMessage instances.  
The comparator must be **message-scope-aware**, not global-tail-aware:

```typescript
export const AssistantMessage = React.memo(
  function AssistantMessage({ ... }) { ... },
  (prev, next) => {
    // 1) Per-row hard invalidation checks
    if (prev.message !== next.message) return false;
    if (prev.isLoading !== next.isLoading) return false;
    if (prev.isReconnecting !== next.isReconnecting) return false;
    if (prev.interrupt !== next.interrupt) return false;

    // 2) allMessages changed -> only re-render if this message is in the
    // active AI/tool tail group whose content signature changed.
    const messageId = next.message?.id ?? prev.message?.id;
    if (!messageId) return true;

    const prevTail = getTailAiOrToolGroupSnapshot(prev.allMessages);
    const nextTail = getTailAiOrToolGroupSnapshot(next.allMessages);
    const messageInTailGroup =
      prevTail.ids.has(messageId) || nextTail.ids.has(messageId);

    if (!messageInTailGroup) return true;
    if (prevTail.signature !== nextTail.signature) return false;

    return true;
  }
);
```

**Why this works:**

- Avoids the common bug where comparing only global last-message reference causes every row to re-render.
- Avoids the opposite bug where comparing only last-message ID suppresses needed tail updates.
- Non-tail rows skip token-by-token rerenders; active tail group rerenders correctly.

#### 3c. CustomComponent handling

`CustomComponent` (line 611) also calls `useStreamContext()` at line 619 and uses `thread.messages`. However:

- It returns `null` early for most messages (`if (!customComponents?.length) return null` at line 659)
- It's only relevant for messages with generative UI components (rare)
- Acceptable to let it re-render — it's a leaf component with minimal overhead

In the refactored AssistantMessage, `thread` is no longer available. CustomComponent already calls `useStreamContext()` itself at line 619, so it will continue to get stream data. For the `thread` prop it receives (line 613), we'll pass `stream` from Thread component as a new prop on AssistantMessage.

#### 3d. Stabilize ThinkingPanel scroll behavior

Replace the state-based scroll tracking with a ref to avoid the scroll→setState→re-render→scroll loop:

```typescript
function ThinkingPanel({ text }: { text: string }) {
  const previewText = getReasoningPreview(text);
  const contentRef = useRef<HTMLPreElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const stickToBottomRef = useRef(true); // ← ref instead of state

  useEffect(() => {
    if (!isOpen || !stickToBottomRef.current) return;
    const el = contentRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [previewText, isOpen]); // ← stickToBottom removed from deps

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceToBottom <= 20; // ← no setState, no re-render
  };
  // ... rest unchanged
}
```

**Why this works:**

- `stickToBottom` doesn't need to trigger a re-render — it's only read inside `useEffect` and `handleScroll`
- By using a ref, the `scrollToBottom()` → `onScroll` → `setStickToBottom()` → re-render cycle is broken
- The scroll handler writes to the ref (zero-cost), and the next `useEffect` invocation reads the ref

#### 3e. Stabilize `handleRegenerate` callback in Thread component

In `src/components/thread/index.tsx`, wrap `handleRegenerate` with `useCallback` so it doesn't create a new function reference on every render (which would defeat React.memo):

```typescript
const handleRegenerate = useCallback(
  async (parentCheckpoint: Checkpoint | null | undefined) => { ... },
  [shouldBlockWhileCurrentThreadBusy, threadId, claimThreadOwnership, stream]
);
```

#### Scope of changes:

- `ai.tsx`: Remove `useStreamContext()` from AssistantMessage, add new props, wrap with `React.memo` + custom comparator, ref-based stickToBottom in ThinkingPanel (~25 lines)
- `index.tsx`: Extract context fields as props to AssistantMessage, `useCallback` for `handleRegenerate` (~15 lines)

### Fix 4: Add shallow equality guards in useThreadBusy

**File:** `src/hooks/use-thread-busy.ts`

**What:** The subscription callback blindly calls `setBusyByThreadId(map)` and `setBusyOwnerByThreadId(ownerMap)` on every event, even if the maps haven't changed. Add functional updaters with shallow equality checks:

```typescript
return subscribeThreadBusy(({ map, ownerMap }) => {
  setBusyByThreadId((prev) => (shallowEqual(prev, map) ? prev : map));
  setBusyOwnerByThreadId((prev) =>
    shallowEqual(prev, ownerMap) ? prev : ownerMap,
  );
});
```

**Why this works:**

- When `markBusy(threadId, true)` is called and the thread is **already** marked busy, the map is identical
- Without this guard, React sees a new object reference → re-render → effects fire
- With the guard, `setBusyByThreadId` returns the **same reference** → React skips re-render
- This cuts the `markBusy → event → state update → effect → markBusy` feedback loop at its source

**Scope:** ~10 lines (add `shallowEqual` helper + modify 2 setState calls)

---

## Files Changed (Summary)

| File                                    | Changes                                                                                                                                | Lines affected                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `src/components/thread/index.tsx`       | Replace 5 effects with useReducer + 1 effect; ref-ify polling; useCallback for handleRegenerate; extract context fields as props       | ~130 lines (remove ~85, add ~60) |
| `src/components/thread/messages/ai.tsx` | Remove useStreamContext from AssistantMessage; add new props; React.memo + custom comparator; ref-based stickToBottom in ThinkingPanel | ~30 lines                        |
| `src/hooks/use-thread-busy.ts`          | Add shallow equality guards in subscription                                                                                            | ~10 lines                        |

**Total: ~3 files, ~100 net lines changed**

---

## Why This Approach Works — Theoretical Summary

| Root Cause                                                                                                       | Fix                                                                                | Why It Breaks the Cycle                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 5 effects write overlapping state → each write triggers another effect                                           | `useReducer` batches all state transitions into 1 synchronous step                 | React processes reducer synchronously → 1 render per dispatch, not 5+                     |
| `effectiveIsLoading` in polling deps → polling restarts → `setThreadStatus` → effects cascade                    | Store in ref, read from ref inside poll                                            | Ref reads don't trigger effect re-runs → polling continues without restart                |
| `markBusy()` event → state update → effect → `markBusy()` again                                                  | Shallow equality in `useThreadBusy` + side-effects after reducer dispatch          | Identical maps return same ref → React skips re-render → no effect cascade                |
| AssistantMessage subscribes to StreamContext → re-renders on every token even though it only needs stable fields | Extract stable fields as props + remove `useStreamContext()` from AssistantMessage | No context subscription → `React.memo` works properly → only re-renders when props change |
| `allMessages` changes reference every token → all AssistantMessage instances re-render                           | Message-scope-aware comparator (tail-group membership + content signature)         | Only messages in the active AI/tool tail group re-render on token updates                 |
| `scrollToBottom` → `onScroll` → `setStickToBottom` → re-render → scroll                                          | `useRef` for stickToBottom                                                         | Ref writes don't cause re-renders → scroll handler is zero-cost                           |

### Render count per token — Before vs After

**Before (current):**

```
1 token → Thread re-renders (context update)
  → 5+ cascade re-renders (effect loop)
  → Each: ALL AssistantMessage instances re-render (context + unstable props)
  → Each: ThinkingPanel re-renders + scroll loop re-render
  ≈ 10-50+ renders per token across component tree
```

**After (with all 4 fixes):**

```
1 token → Thread re-renders (context update — unavoidable)
  → 0 cascade re-renders (useReducer + ref polling + shallow equality)
  → Only LAST AssistantMessage re-renders (React.memo + custom comparator)
  → ThinkingPanel re-renders once, no scroll loop (ref-based stickToBottom)
  ≈ 3 renders per token (Thread + last AssistantMessage + last ThinkingPanel)
```

---

## Verification Plan

1. **Build:** `pnpm build` — ensure no TypeScript errors
2. **Dev test:** `pnpm dev` — open the app, send a message that triggers reasoning/thinking
3. **Streaming smoothness:** Observe ThinkingPanel — text should append smoothly, no visible flicker
4. **Error #185:** Open browser console, stream a long reasoning response — no #185 errors should appear
5. **Refresh test:** Refresh the page during streaming — should recover cleanly
6. **Cross-tab test:** Open two tabs on same thread, stream in one — busy indicator should show in the other
7. **Existing tests:** `pnpm test` (if available) — all tests pass
