import type { Message } from '../../../types/message.js';

export type AgentTaskOutcome = 'completed' | 'failed' | 'cancelled';

export interface AgentTaskSettledEvent {
  chatRoomId: string;
  taskId: string;
  agentId: string;
  status: AgentTaskOutcome;
  finalMessage?: Message;
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
