import type {
  HandoffMention,
  HandoffMentionBatch,
  MentionDispatchMode,
} from '../../../types/handoff.js';

export interface PendingMentionState {
  /** 全部批次拍平后的并集（按 agentId 去重，后写覆盖），供展示/计数等旧逻辑沿用。 */
  mentions: HandoffMention[];
  intent?: string;
  /** 有序批次列表，一次 mention_agents 调用一批，保留调用边界供串行/并行归一化。 */
  batches: HandoffMentionBatch[];
}

interface MutableMentionBatch {
  mentions: Map<string, HandoffMention>;
  mode: MentionDispatchMode;
  intent?: string;
}

interface MutableMentionState {
  batches: MutableMentionBatch[];
  intent?: string;
}

// HTTP-backed tools know room+agent, while the processor owns the concrete TaskQueue id.
// The active binding bridges those two scopes; buffers themselves remain task-scoped.
const activeExecutionIds = new Map<string, string>();
const buffers = new Map<string, MutableMentionState>();

function actorKey(chatRoomId: string, agentId: string): string {
  return `${chatRoomId}:${agentId}`;
}

export function beginMentionExecution(
  chatRoomId: string,
  agentId: string,
  executionId: string,
): void {
  activeExecutionIds.set(actorKey(chatRoomId, agentId), executionId);
  buffers.delete(executionId);
}

export function endMentionExecution(
  chatRoomId: string,
  agentId: string,
  executionId: string,
): void {
  const key = actorKey(chatRoomId, agentId);
  if (activeExecutionIds.get(key) === executionId) {
    activeExecutionIds.delete(key);
  }
  buffers.delete(executionId);
}

/**
 * Record one mention_agents call into the currently executing task.
 * 每次调用作为一个独立批次按顺序追加（批内按 agentId 去重）；只有 intent、无目标的调用
 * 不产生新批次，仅更新全局 intent。Returns false outside an active execution.
 */
export function recordMentions(
  chatRoomId: string,
  agentId: string,
  mentions: HandoffMention[],
  mode: MentionDispatchMode = 'parallel',
  intent?: string,
): boolean {
  const executionId = activeExecutionIds.get(actorKey(chatRoomId, agentId));
  if (!executionId) return false;
  if (mentions.length === 0 && !intent?.trim()) return true;

  const state = buffers.get(executionId) ?? { batches: [] };
  buffers.set(executionId, state);

  if (mentions.length > 0) {
    const batchMentions = new Map<string, HandoffMention>();
    for (const mention of mentions) {
      batchMentions.set(mention.agentId, mention);
    }
    state.batches.push({
      mentions: batchMentions,
      mode,
      intent: intent?.trim() || undefined,
    });
  }
  if (intent?.trim()) state.intent = intent.trim();
  return true;
}

export function peekMentionState(executionId: string): PendingMentionState {
  const state = buffers.get(executionId);
  if (!state) return { mentions: [], batches: [] };

  // 拍平并集：批次按顺序展开，同一 agentId 后写覆盖，保持旧的 union 语义。
  const union = new Map<string, HandoffMention>();
  const batches: HandoffMentionBatch[] = state.batches.map((batch) => {
    const mentions = [...batch.mentions.values()];
    for (const mention of mentions) union.set(mention.agentId, mention);
    return { mentions, mode: batch.mode, intent: batch.intent };
  });
  return { mentions: [...union.values()], intent: state.intent, batches };
}

export function takeMentionState(executionId: string): PendingMentionState {
  const state = peekMentionState(executionId);
  buffers.delete(executionId);
  return state;
}

export function clearMentions(executionId: string): void {
  buffers.delete(executionId);
}
