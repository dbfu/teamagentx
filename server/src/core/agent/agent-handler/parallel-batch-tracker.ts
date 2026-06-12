// 并行批次追踪器
// 协调者在单次派发中同时 @ 多个助手时，记录这批并行任务的 agentId 集合。
// 每个助手完成后标记，等全部完成后再放行协调者触发，避免中途白白调用一次 LLM。

interface ParallelBatch {
  pendingAgentIds: Set<string>;
  // 批次期间用户发过言：用户介入即接管推进权，join 不再自动派发（降级为静默收口）。
  userIntervened?: boolean;
}

// key: chatRoomId
const activeBatches = new Map<string, ParallelBatch>();

export function startParallelBatch(chatRoomId: string, agentIds: string[]): void {
  // 房间已有进行中的批次时合并而非覆盖：覆盖会丢失旧批次成员的完成标记，
  // 导致 join 永远不触发、后续任务卡死。合并后所有成员共享同一个汇合点。
  const existing = activeBatches.get(chatRoomId);
  if (existing) {
    for (const id of agentIds) existing.pendingAgentIds.add(id);
    return;
  }
  if (agentIds.length <= 1) return;
  activeBatches.set(chatRoomId, { pendingAgentIds: new Set(agentIds) });
}

/** 房间当前是否有进行中的并行批次。 */
export function hasActiveParallelBatch(chatRoomId: string): boolean {
  return activeBatches.has(chatRoomId);
}

/**
 * 用户在批次期间发言时调用：标记用户接管。
 * 原则：用户介入后批次只负责完成计数收口，join 不再自动派发（避免与用户介入后的
 * 新链路重复派发或上下文竞争）；后续推进由用户驱动，watchdog 仍兜底。
 * 无进行中批次时为空操作。
 */
export function markBatchUserIntervention(chatRoomId: string): void {
  const batch = activeBatches.get(chatRoomId);
  if (batch) batch.userIntervened = true;
}

export type BatchMarkResult =
  | 'last'                 // 这是最后一个，可以放行协调者汇合裁决
  | 'last_user_intervened' // 这是最后一个，但用户已介入接管：静默收口，不触发协调者
  | 'pending'              // 还有其他未完成，压制协调者触发
  | 'none';                // 不在任何批次里，走正常流程

export function markBatchAgentComplete(chatRoomId: string, agentId: string): BatchMarkResult {
  const batch = activeBatches.get(chatRoomId);
  if (!batch || !batch.pendingAgentIds.has(agentId)) return 'none';

  batch.pendingAgentIds.delete(agentId);
  if (batch.pendingAgentIds.size === 0) {
    activeBatches.delete(chatRoomId);
    return batch.userIntervened ? 'last_user_intervened' : 'last';
  }
  return 'pending';
}

export function clearParallelBatch(chatRoomId: string): void {
  activeBatches.delete(chatRoomId);
}
