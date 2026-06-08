// 并行批次追踪器
// 协调者在单次派发中同时 @ 多个助手时，记录这批并行任务的 agentId 集合。
// 每个助手完成后标记，等全部完成后再放行协调者触发，避免中途白白调用一次 LLM。

interface ParallelBatch {
  pendingAgentIds: Set<string>;
}

// key: chatRoomId
const activeBatches = new Map<string, ParallelBatch>();

export function startParallelBatch(chatRoomId: string, agentIds: string[]): void {
  if (agentIds.length <= 1) return;
  activeBatches.set(chatRoomId, { pendingAgentIds: new Set(agentIds) });
}

export type BatchMarkResult =
  | 'last'    // 这是最后一个，可以放行协调者
  | 'pending' // 还有其他未完成，压制协调者触发
  | 'none';   // 不在任何批次里，走正常流程

export function markBatchAgentComplete(chatRoomId: string, agentId: string): BatchMarkResult {
  const batch = activeBatches.get(chatRoomId);
  if (!batch || !batch.pendingAgentIds.has(agentId)) return 'none';

  batch.pendingAgentIds.delete(agentId);
  if (batch.pendingAgentIds.size === 0) {
    activeBatches.delete(chatRoomId);
    return 'last';
  }
  return 'pending';
}

export function clearParallelBatch(chatRoomId: string): void {
  activeBatches.delete(chatRoomId);
}
