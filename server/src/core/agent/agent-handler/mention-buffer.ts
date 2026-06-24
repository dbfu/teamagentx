import type { HandoffMention } from '../../../types/handoff.js';

export interface PendingMentionState {
  mentions: HandoffMention[];
  intent?: string;
}

interface MutableMentionState {
  mentions: Map<string, HandoffMention>;
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

/** Record into the currently executing task. Returns false outside an active execution. */
export function recordMentions(
  chatRoomId: string,
  agentId: string,
  mentions: HandoffMention[],
  intent?: string,
): boolean {
  const executionId = activeExecutionIds.get(actorKey(chatRoomId, agentId));
  if (!executionId) return false;
  if (mentions.length === 0 && !intent?.trim()) return true;

  const state = buffers.get(executionId) ?? { mentions: new Map<string, HandoffMention>() };
  buffers.set(executionId, state);
  for (const mention of mentions) {
    state.mentions.set(mention.agentId, mention);
  }
  if (intent?.trim()) state.intent = intent.trim();
  return true;
}

export function peekMentionState(executionId: string): PendingMentionState {
  const state = buffers.get(executionId);
  return state
    ? { mentions: [...state.mentions.values()], intent: state.intent }
    : { mentions: [] };
}

export function takeMentionState(executionId: string): PendingMentionState {
  const state = peekMentionState(executionId);
  buffers.delete(executionId);
  return state;
}

export function clearMentions(executionId: string): void {
  buffers.delete(executionId);
}
