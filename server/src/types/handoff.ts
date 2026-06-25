export interface HandoffMention {
  agentId: string;
  agentName: string;
  task: string;
}

/**
 * 单次 mention_agents 调用内多个目标的派发方式：
 * - parallel：并行扇出，统一收敛回发起者（默认，保持「@ 多个=并行收口」直觉）。
 * - serial：批内目标按顺序串行接力，前一个产出作为后一个的依赖输入。
 * 注意：mode 只决定「同一次调用内多个目标」的串/并；多次调用之间恒为串行。
 */
export type MentionDispatchMode = 'serial' | 'parallel';

/** 一次 mention_agents 调用登记的目标批次（保留调用边界，供串行/并行归一化）。 */
export interface HandoffMentionBatch {
  mentions: HandoffMention[];
  mode: MentionDispatchMode;
  intent?: string;
}

/** Persisted with TaskQueue so handoff safety survives queueing and recovery. */
export interface HandoffContext {
  rootMessageId: string;
  lineage: string[];
  depth: number;
  dispatchCount: number;
  batchId?: string;
  convergenceOwnerId?: string;
  convergenceOwnerName?: string;
  isLeaf?: boolean;
}

export function createRootHandoffContext(
  rootMessageId: string,
  agentId: string,
): HandoffContext {
  return {
    rootMessageId,
    lineage: [agentId],
    depth: 0,
    dispatchCount: 0,
  };
}

export function advanceHandoffContext(
  context: HandoffContext,
  targetAgentId: string,
  overrides: Partial<HandoffContext> = {},
): HandoffContext {
  return {
    ...context,
    lineage: [...context.lineage, targetAgentId],
    depth: context.depth + 1,
    ...overrides,
  };
}
