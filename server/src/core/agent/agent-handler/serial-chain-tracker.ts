// 串行链追踪器
// 协调器在单次决策中选择「按顺序逐个执行」多个助手时，记录有序的逐助手任务。
// 同一时刻只派发当前队首助手，processor 确认任务成功完成后再派下一个，
// 后续助手通过增量群历史看到前面助手的产出，自然按顺序接力。
// 与 parallel-batch-tracker 同构：一个负责并行汇合，一个负责串行推进。

export interface SerialChainContext {
  /** 原始调度计划消息 id：后续每个助手的调度消息都 reply 到它，串成同一次派发。 */
  triggerMessageId: string;
}

export interface SerialChainAssignment {
  agentId: string;
  /** 只分配给当前助手的任务内容。 */
  content: string;
}

interface SerialChain extends SerialChainContext {
  assignments: SerialChainAssignment[];
  /** 当前正在执行的队首助手下标。 */
  index: number;
  /** 当前链步骤绑定的队列任务；推进必须同时匹配 agentId 与 taskId。 */
  currentTaskId: string | null;
  /** 链进行期间用户发过言：用户接管后链不再自动推进（降级为静默收口）。 */
  userIntervened?: boolean;
}

// key: chatRoomId
const activeChains = new Map<string, SerialChain>();

export function startSerialChain(
  chatRoomId: string,
  assignments: SerialChainAssignment[],
  context: SerialChainContext,
  firstTaskId: string,
): void {
  // 单个目标不构成串行链；交由调用方走普通单派发。
  if (assignments.length <= 1) return;
  // 直接覆盖而非合并：串行链是一次完整的有序计划，新计划应整体替换旧计划，
  // 避免旧链残留的 index/名单与新计划交叉污染。
  activeChains.set(chatRoomId, {
    assignments: assignments.map((assignment) => ({ ...assignment })),
    index: 0,
    currentTaskId: firstTaskId,
    triggerMessageId: context.triggerMessageId,
  });
}

/** 房间当前是否有进行中的串行链。 */
export function hasActiveSerialChain(chatRoomId: string): boolean {
  return activeChains.has(chatRoomId);
}

/**
 * 用户在链进行期间发言时调用：标记用户接管。
 * 原则与并行批次一致：用户介入后链只负责收口，不再自动派发下一个，
 * 后续推进由用户驱动，watchdog 仍兜底。无进行中链时为空操作。
 */
export function markSerialUserIntervention(chatRoomId: string): void {
  const chain = activeChains.get(chatRoomId);
  if (chain) chain.userIntervened = true;
}

/** 当前消息是否来自串行链正在执行的具体队列任务。 */
export function isCurrentSerialTask(
  chatRoomId: string,
  agentId: string,
  taskId: string,
): boolean {
  const chain = activeChains.get(chatRoomId);
  return !!chain &&
    chain.assignments[chain.index]?.agentId === agentId &&
    chain.currentTaskId === taskId;
}

/**
 * 为已推进到的下一步绑定实际创建出的队列任务。
 * 仅允许绑定当前未绑定的队首，避免异步派发覆盖其它链或其它步骤。
 */
export function bindSerialTask(
  chatRoomId: string,
  agentId: string,
  taskId: string,
): boolean {
  const chain = activeChains.get(chatRoomId);
  if (
    !chain ||
    chain.assignments[chain.index]?.agentId !== agentId ||
    chain.currentTaskId !== null
  ) {
    return false;
  }
  chain.currentTaskId = taskId;
  return true;
}

export type SerialAdvanceResult =
  | {
      kind: 'next';
      nextAgentId: string;
      context: SerialChainContext & { dispatchContent: string };
    } // 推进到下一个助手
  | { kind: 'last' }                  // 队尾已完成，可放行协调器收尾 join
  | { kind: 'last_user_intervened' }  // 队尾已完成，但用户已介入：静默收口
  | { kind: 'none' };                 // 完成的助手不是当前队首（无关消息）→ 走正常流程

/**
 * 队首助手完成后推进串行链。
 * 仅当完成的助手正是当前队首时才推进；其它助手的消息返回 none，交由正常流程处理。
 */
export function advanceSerialChain(
  chatRoomId: string,
  completedAgentId: string,
  completedTaskId: string,
): SerialAdvanceResult {
  const chain = activeChains.get(chatRoomId);
  if (!chain) return { kind: 'none' };
  if (
    chain.assignments[chain.index]?.agentId !== completedAgentId ||
    chain.currentTaskId !== completedTaskId
  ) {
    return { kind: 'none' };
  }

  return advanceCurrentStep(chatRoomId, chain);
}

/**
 * 跳过已推进但尚未绑定任务的不可用助手。
 */
export function skipUnboundSerialAgent(
  chatRoomId: string,
  agentId: string,
): SerialAdvanceResult {
  const chain = activeChains.get(chatRoomId);
  if (
    !chain ||
    chain.assignments[chain.index]?.agentId !== agentId ||
    chain.currentTaskId !== null
  ) {
    return { kind: 'none' };
  }
  return advanceCurrentStep(chatRoomId, chain);
}

function advanceCurrentStep(
  chatRoomId: string,
  chain: SerialChain,
): SerialAdvanceResult {
  chain.index += 1;

  // 队尾完成：清理并放行收尾。
  if (chain.index >= chain.assignments.length) {
    activeChains.delete(chatRoomId);
    return chain.userIntervened ? { kind: 'last_user_intervened' } : { kind: 'last' };
  }

  // 用户已接管：停止自动推进，丢弃剩余链。
  if (chain.userIntervened) {
    activeChains.delete(chatRoomId);
    return { kind: 'last_user_intervened' };
  }

  chain.currentTaskId = null;
  const nextAssignment = chain.assignments[chain.index]!;
  return {
    kind: 'next',
    nextAgentId: nextAssignment.agentId,
    context: {
      triggerMessageId: chain.triggerMessageId,
      dispatchContent: nextAssignment.content,
    },
  };
}

/** 仅当取消/失败的是当前串行任务时清链，避免其它任务误伤活动链。 */
export function clearSerialChainForTask(
  chatRoomId: string,
  agentId: string,
  taskId: string,
): boolean {
  if (!isCurrentSerialTask(chatRoomId, agentId, taskId)) return false;
  activeChains.delete(chatRoomId);
  return true;
}

export function clearSerialChain(chatRoomId: string): void {
  activeChains.delete(chatRoomId);
}
