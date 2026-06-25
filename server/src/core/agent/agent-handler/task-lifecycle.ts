import type { Message } from '../../../types/message.js';
import type {
  HandoffContext,
  HandoffMention,
  HandoffMentionBatch,
} from '../../../types/handoff.js';

export type AgentTaskOutcome = 'completed' | 'failed' | 'cancelled';

export interface AgentTaskSettledEvent {
  chatRoomId: string;
  taskId: string;
  agentId: string;
  status: AgentTaskOutcome;
  finalMessage?: Message;
  handoffContext?: HandoffContext;
  /** 拍平并集，保留给旧逻辑（计数、单目标判断的回退）。 */
  pendingMentions?: HandoffMention[];
  /** 有序批次列表，串行/并行归一化的权威来源。 */
  pendingMentionBatches?: HandoffMentionBatch[];
  mentionIntent?: string;
}

type AgentTaskSettledHandler = (
  event: AgentTaskSettledEvent,
) => Promise<void> | void;

let settledHandler: AgentTaskSettledHandler | null = null;

export function setAgentTaskSettledHandler(
  handler: AgentTaskSettledHandler | null,
): void {
  settledHandler = handler;
}

export async function notifyAgentTaskSettled(
  event: AgentTaskSettledEvent,
): Promise<void> {
  await settledHandler?.(event);
}
