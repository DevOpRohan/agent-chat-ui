import { coerceMessageLikeToMessage } from "@langchain/core/messages";
import { Message, ThreadState } from "@langchain/langgraph-sdk";

type BranchInfo = {
  branch: string;
  branchOptions: string[];
};

type SequenceNode<StateType extends Record<string, unknown>> = {
  type: "node";
  value: ThreadState<StateType>;
  path: string[];
};

type SequenceFork<StateType extends Record<string, unknown>> = {
  type: "fork";
  items: Array<Sequence<StateType>>;
};

type Sequence<StateType extends Record<string, unknown>> = {
  type: "sequence";
  items: Array<SequenceNode<StateType> | SequenceFork<StateType>>;
};

type BranchSequence<StateType extends Record<string, unknown>> = {
  rootSequence: Sequence<StateType>;
  paths: string[][];
};

export type RuntimeMessageMetadata<
  StateType extends Record<string, unknown>,
> = {
  messageId: string;
  firstSeenState: ThreadState<StateType> | undefined;
  branch: string | undefined;
  branchOptions: string[] | undefined;
};

export type BranchContext<StateType extends Record<string, unknown>> = {
  branchTree: Sequence<StateType>;
  branchByCheckpoint: Record<string, BranchInfo>;
  flatHistory: ThreadState<StateType>[];
  threadHead: ThreadState<StateType> | undefined;
};

const PATH_SEPARATOR = ">";
const ROOT_ID = "$";

function maxCheckpointId(...ids: Array<string | undefined>) {
  return ids
    .filter((value): value is string => typeof value === "string")
    .sort((a, b) => a.localeCompare(b))
    .at(-1);
}

function getBranchSequence<StateType extends Record<string, unknown>>(
  history: ThreadState<StateType>[],
): BranchSequence<StateType> {
  const nodeIds = new Set<string>();
  const childrenByParentId: Record<string, ThreadState<StateType>[]> = {};

  if (history.length <= 1) {
    return {
      rootSequence: {
        type: "sequence",
        items: history.map((value) => ({
          type: "node",
          value,
          path: [],
        })),
      },
      paths: [],
    };
  }

  for (const state of history) {
    const parentCheckpointId = state.parent_checkpoint?.checkpoint_id ?? ROOT_ID;
    childrenByParentId[parentCheckpointId] ??= [];
    childrenByParentId[parentCheckpointId].push(state);

    const checkpointId = state.checkpoint?.checkpoint_id;
    if (checkpointId) {
      nodeIds.add(checkpointId);
    }
  }

  const lastOrphanedParentId =
    childrenByParentId[ROOT_ID] == null
      ? Object.keys(childrenByParentId)
          .filter((parentId) => !nodeIds.has(parentId))
          .map((parentId) => {
            const queue = [parentId];
            const seen = new Set<string>();
            let lastId = parentId;

            while (queue.length > 0) {
              const current = queue.shift();
              if (!current || seen.has(current)) continue;
              seen.add(current);
              const children = (childrenByParentId[current] ?? []).flatMap(
                (item) => item.checkpoint?.checkpoint_id ?? [],
              );
              lastId = maxCheckpointId(lastId, ...children) ?? lastId;
              queue.push(...children);
            }

            return { parentId, lastId };
          })
          .sort((a, b) => a.lastId.localeCompare(b.lastId))
          .at(-1)?.parentId
      : undefined;

  if (lastOrphanedParentId) {
    childrenByParentId[ROOT_ID] = childrenByParentId[lastOrphanedParentId];
  }

  const rootSequence: Sequence<StateType> = {
    type: "sequence",
    items: [],
  };
  const queue: Array<{
    id: string;
    sequence: Sequence<StateType>;
    path: string[];
  }> = [
    {
      id: ROOT_ID,
      sequence: rootSequence,
      path: [],
    },
  ];
  const paths: string[][] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const task = queue.shift();
    if (!task || visited.has(task.id)) continue;
    visited.add(task.id);

    const children = childrenByParentId[task.id];
    if (!children || children.length === 0) continue;

    let fork: SequenceFork<StateType> | undefined;
    if (children.length > 1) {
      fork = {
        type: "fork",
        items: [],
      };
      task.sequence.items.push(fork);
    }

    for (const value of children) {
      const checkpointId = value.checkpoint?.checkpoint_id;
      if (!checkpointId) continue;

      let sequence = task.sequence;
      let path = task.path;

      if (fork) {
        sequence = {
          type: "sequence",
          items: [],
        };
        fork.items.unshift(sequence);
        path = path.slice();
        path.push(checkpointId);
        paths.push(path);
      }

      sequence.items.push({
        type: "node",
        value,
        path,
      });
      queue.push({
        id: checkpointId,
        sequence,
        path,
      });
    }
  }

  return { rootSequence, paths };
}

function getBranchView<StateType extends Record<string, unknown>>(
  sequence: Sequence<StateType>,
  paths: string[][],
  branch: string,
) {
  const selectedPath = branch.split(PATH_SEPARATOR).filter(Boolean);
  const pathMap: Record<string, string[][]> = {};

  for (const path of paths) {
    const parent = path.at(-2) ?? ROOT_ID;
    pathMap[parent] ??= [];
    pathMap[parent].unshift(path);
  }

  const history: ThreadState<StateType>[] = [];
  const branchByCheckpoint: Record<string, BranchInfo> = {};
  const forkStack = selectedPath.slice();
  const queue = [...sequence.items];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;

    if (item.type === "node") {
      history.push(item.value);
      const checkpointId = item.value.checkpoint?.checkpoint_id;
      if (!checkpointId) continue;

      branchByCheckpoint[checkpointId] = {
        branch: item.path.join(PATH_SEPARATOR),
        branchOptions: (
          item.path.length > 0
            ? pathMap[item.path.at(-2) ?? ROOT_ID] ?? []
            : []
        ).map((path) => path.join(PATH_SEPARATOR)),
      };
      continue;
    }

    const forkId = forkStack.shift();
    const index =
      forkId == null
        ? -1
        : item.items.findIndex((candidate) => {
            const firstItem = candidate.items.at(0);
            if (!firstItem || firstItem.type !== "node") return false;
            return firstItem.value.checkpoint?.checkpoint_id === forkId;
          });
    const nextItems = item.items.at(index)?.items ?? [];
    queue.push(...nextItems);
  }

  return { history, branchByCheckpoint };
}

export function getBranchContext<StateType extends Record<string, unknown>>(
  branch: string,
  history: ThreadState<StateType>[],
): BranchContext<StateType> {
  const { rootSequence, paths } = getBranchSequence(history);
  const { history: flatHistory, branchByCheckpoint } = getBranchView(
    rootSequence,
    paths,
    branch,
  );

  return {
    branchTree: rootSequence,
    branchByCheckpoint,
    flatHistory,
    threadHead: flatHistory.at(-1),
  };
}

export function getMessagesFromState<StateType extends Record<string, unknown>>(
  values: StateType | null | undefined,
): Message[] {
  if (!values) return [];
  if (!Array.isArray(values.messages)) {
    return [];
  }

  return values.messages.flatMap((message) => {
    try {
      return [coerceMessageLikeToMessage(message) as Message];
    } catch {
      if (message && typeof message === "object" && "type" in message) {
        return [message as Message];
      }
      return [];
    }
  });
}

function findLastStateWithMessage<StateType extends Record<string, unknown>>(
  history: ThreadState<StateType>[],
  messageId: string | number,
) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const state = history[index];
    const containsMessage = getMessagesFromState(state.values).some(
      (message, messageIndex) => (message.id ?? messageIndex) === messageId,
    );
    if (containsMessage) {
      return state;
    }
  }

  return undefined;
}

export function buildMessageMetadata<
  StateType extends Record<string, unknown>,
>(params: {
  values: StateType;
  history: ThreadState<StateType>[];
  branchByCheckpoint: Record<string, BranchInfo>;
}) {
  const { values, history, branchByCheckpoint } = params;
  const alreadyShown = new Set<string>();

  return getMessagesFromState(values).map<RuntimeMessageMetadata<StateType>>(
    (message, index) => {
      const rawMessageId = message.id ?? index;
      const firstSeenState = findLastStateWithMessage(history, rawMessageId);
      const checkpointId = firstSeenState?.checkpoint?.checkpoint_id;
      let branchInfo =
        checkpointId != null ? branchByCheckpoint[checkpointId] : undefined;

      if (!branchInfo?.branch?.length) {
        branchInfo = undefined;
      }

      const branchOptionsKey = branchInfo?.branchOptions?.join(",");
      if (branchOptionsKey) {
        if (alreadyShown.has(branchOptionsKey)) {
          branchInfo = undefined;
        } else {
          alreadyShown.add(branchOptionsKey);
        }
      }

      return {
        messageId: String(rawMessageId),
        firstSeenState,
        branch: branchInfo?.branch,
        branchOptions: branchInfo?.branchOptions,
      };
    },
  );
}
