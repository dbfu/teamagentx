import type { HandoffContext } from '../../../types/handoff.js';

/** 自动回传给直接分配者时展示并注入给目标助手的任务说明。 */
export const AUTO_RETURN_TASK = '我已完成这项任务，请基于结果继续处理。';

export interface AutomaticReturnEligibility {
  handoffContext: HandoffContext;
  agentId: string;
  agentLevel?: string | null;
  agentTriggerMode?: string | null;
  coordinatorAgentId: string;
  suppressAssistantHandoff: boolean;
  isLeaf: boolean;
  isQuickChatRoom: boolean;
}

export interface AutomaticReturnDecision extends AutomaticReturnEligibility {
  hasFinalMessage: boolean;
  finalMessageMentionsUser: boolean;
  pendingMentionCount: number;
}

/** 返回当前助手这一次任务的直接分配者；自动回传任务本身只允许回传一次。 */
export function getImmediateAssignerId(
  context: HandoffContext,
  currentAgentId: string,
): string | null {
  if (context.skipAutoReturn) return null;
  const assignerId = context.lineage.at(-2);
  if (!assignerId || assignerId === currentAgentId) return null;
  return assignerId;
}

/** 判断当前任务是否具备自动回传的结构条件。 */
export function canAutoReturnToAssigner(
  input: AutomaticReturnEligibility,
): boolean {
  const smartMode = input.agentTriggerMode === 'auto' || input.agentTriggerMode === 'coordinator';
  return smartMode &&
    input.agentLevel !== 'system' &&
    input.agentId !== input.coordinatorAgentId &&
    !input.suppressAssistantHandoff &&
    !input.isLeaf &&
    !input.isQuickChatRoom &&
    getImmediateAssignerId(input.handoffContext, input.agentId) !== null;
}

/** 判断当前任务是否应在输出发布前自动 @ 直接分配者。 */
export function shouldAutoReturnToAssigner(
  input: AutomaticReturnDecision,
): boolean {
  return canAutoReturnToAssigner(input) &&
    input.hasFinalMessage &&
    !input.finalMessageMentionsUser &&
    input.pendingMentionCount === 0;
}
