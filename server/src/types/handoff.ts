export interface HandoffMention {
  agentId: string;
  agentName: string;
  task: string;
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
