import type { Message } from '../../../types/message.js';
import type { HandoffContext, HandoffMention } from '../../../types/handoff.js';
import type { AgentTaskOutcome } from './task-lifecycle.js';

interface CascadeBudget {
  dispatchCount: number;
  touchedAt: number;
}

export interface HandoffBranchResult {
  agentId: string;
  agentName: string;
  status: AgentTaskOutcome;
  finalMessage?: Message;
  suggestions: HandoffMention[];
}

export interface HandoffBatch {
  id: string;
  chatRoomId: string;
  rootMessageId: string;
  ownerAgentId: string;
  ownerAgentName: string;
  ownerContext: HandoffContext;
  sourceMessage: Message;
  pendingAgentIds: Set<string>;
  results: HandoffBranchResult[];
  userIntervened: boolean;
}

const cascadeBudgets = new Map<string, CascadeBudget>();
const batches = new Map<string, HandoffBatch>();
const CASCADE_TTL_MS = 24 * 60 * 60 * 1000;

function pruneExpiredCascades(now = Date.now()): void {
  for (const [rootMessageId, state] of cascadeBudgets) {
    if (now - state.touchedAt > CASCADE_TTL_MS) cascadeBudgets.delete(rootMessageId);
  }
}

export function reserveHandoffDispatches(
  context: HandoffContext,
  amount: number,
  maxDispatches: number,
): { ok: true; dispatchCount: number } | { ok: false; dispatchCount: number } {
  pruneExpiredCascades();
  const current = cascadeBudgets.get(context.rootMessageId)?.dispatchCount ?? context.dispatchCount;
  const next = current + amount;
  if (Number.isFinite(maxDispatches) && maxDispatches > 0 && next > maxDispatches) {
    return { ok: false, dispatchCount: current };
  }
  cascadeBudgets.set(context.rootMessageId, { dispatchCount: next, touchedAt: Date.now() });
  return { ok: true, dispatchCount: next };
}

export function releaseHandoffDispatches(
  rootMessageId: string,
  amount: number,
): void {
  const state = cascadeBudgets.get(rootMessageId);
  if (!state) return;
  state.dispatchCount = Math.max(0, state.dispatchCount - amount);
  state.touchedAt = Date.now();
}

export function finishHandoffCascade(rootMessageId: string): void {
  if (![...batches.values()].some((batch) => batch.rootMessageId === rootMessageId)) {
    cascadeBudgets.delete(rootMessageId);
  }
}

export function restoreHandoffCascade(context: HandoffContext): void {
  const current = cascadeBudgets.get(context.rootMessageId)?.dispatchCount ?? 0;
  if (context.dispatchCount > current) {
    cascadeBudgets.set(context.rootMessageId, {
      dispatchCount: context.dispatchCount,
      touchedAt: Date.now(),
    });
  }
}

export function startStructuredHandoffBatch(batch: HandoffBatch): void {
  batches.set(batch.id, {
    ...batch,
    pendingAgentIds: new Set(batch.pendingAgentIds),
    results: [...batch.results],
  });
}

export type CompleteBranchResult =
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'ready'; batch: HandoffBatch }
  | { kind: 'silenced'; batch: HandoffBatch };

export function completeStructuredHandoffBranch(
  batchId: string,
  result: HandoffBranchResult,
): CompleteBranchResult {
  const batch = batches.get(batchId);
  if (!batch || !batch.pendingAgentIds.has(result.agentId)) return { kind: 'none' };
  batch.pendingAgentIds.delete(result.agentId);
  batch.results.push(result);
  if (batch.pendingAgentIds.size > 0) return { kind: 'waiting' };
  batches.delete(batchId);
  return batch.userIntervened
    ? { kind: 'silenced', batch }
    : { kind: 'ready', batch };
}

export function markStructuredHandoffUserIntervention(chatRoomId: string): void {
  for (const batch of batches.values()) {
    if (batch.chatRoomId === chatRoomId) batch.userIntervened = true;
  }
}

export function clearStructuredHandoffRuntime(): void {
  cascadeBudgets.clear();
  batches.clear();
}
