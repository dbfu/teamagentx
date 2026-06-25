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

/** 一个串行阶段：1+ 个目标组成的并行收敛单元（单目标即退化为接力）。 */
export interface SerialChainStage {
  mentions: HandoffMention[];
}

/** 已完成阶段的产出，作为后续阶段的依赖输入（整条链累积）。 */
export interface SerialChainOutput {
  stageIndex: number;
  agentName: string;
  status: AgentTaskOutcome;
  content: string;
  finalMessageId?: string;
}

/**
 * 串行链运行态：把「一轮内多次 mention_agents 调用 / serial 批」归一化成的
 * 有序阶段队列，按 rootMessageId 绑定。每个阶段复用 HandoffBatch 并行收敛机制，
 * 阶段间由派发层在收敛点推进，并把产出累积进 priorOutputs 向后传。
 */
export interface SerialChainState {
  rootMessageId: string;
  chatRoomId: string;
  ownerAgentId: string;
  ownerAgentName: string;
  ownerContext: HandoffContext;
  sourceMessage: Message;
  remainingStages: SerialChainStage[];
  priorOutputs: SerialChainOutput[];
  completedStageCount: number;
  /** 当前在跑阶段对应的 batchId，用于在 batch 收敛时识别归属链。 */
  currentBatchId?: string;
}

const cascadeBudgets = new Map<string, CascadeBudget>();
const batches = new Map<string, HandoffBatch>();
const serialChains = new Map<string, SerialChainState>();
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

/** 登记一条串行链（含首个阶段已出队后的剩余阶段）。 */
export function startSerialChain(state: SerialChainState): void {
  serialChains.set(state.rootMessageId, {
    ...state,
    remainingStages: state.remainingStages.map((stage) => ({ ...stage })),
    priorOutputs: [...state.priorOutputs],
  });
}

export function getSerialChain(rootMessageId: string): SerialChainState | undefined {
  return serialChains.get(rootMessageId);
}

/** 记录当前在跑阶段的 batchId，供收敛时识别归属链。 */
export function setSerialChainBatch(rootMessageId: string, batchId: string): void {
  const chain = serialChains.get(rootMessageId);
  if (chain) chain.currentBatchId = batchId;
}

/** 追加一个已完成阶段的产出到链的累积器。 */
export function appendSerialChainOutputs(
  rootMessageId: string,
  outputs: SerialChainOutput[],
): void {
  const chain = serialChains.get(rootMessageId);
  if (!chain) return;
  chain.priorOutputs.push(...outputs);
  chain.completedStageCount += 1;
}

/** 取出下一个待派阶段；队列空返回 undefined。 */
export function dequeueSerialChainStage(
  rootMessageId: string,
): SerialChainStage | undefined {
  const chain = serialChains.get(rootMessageId);
  if (!chain) return undefined;
  return chain.remainingStages.shift();
}

export function clearSerialChain(rootMessageId: string): void {
  serialChains.delete(rootMessageId);
}

export function clearStructuredHandoffRuntime(): void {
  cascadeBudgets.clear();
  batches.clear();
  serialChains.clear();
}
