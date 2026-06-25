import { randomUUID } from 'crypto';
import type { Agent } from '@prisma/client';
import { config } from '../../../config/index.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import type { Message } from '../../../types/message.js';
import {
  advanceHandoffContext,
  type HandoffContext,
  type HandoffMention,
  type HandoffMentionBatch,
} from '../../../types/handoff.js';
import { agentService } from '../agent.service.js';
import { buildAIMessage } from './message-utils.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
import { globalEmit, globalEmitTyping, globalEmitDone } from './status.js';
import { debugLog } from './debug.js';
import {
  GROUP_COORDINATOR_ID,
} from '../system-assistant.constants.js';
import { INTERNAL_COORDINATOR_AGENT_NAME } from '../internal-coordinator-agent.js';
import type { AgentTaskSettledEvent } from './task-lifecycle.js';
import {
  appendSerialChainOutputs,
  clearSerialChain,
  completeStructuredHandoffBranch,
  dequeueSerialChainStage,
  finishHandoffCascade,
  getSerialChain,
  releaseHandoffDispatches,
  reserveHandoffDispatches,
  setSerialChainBatch,
  startSerialChain,
  startStructuredHandoffBatch,
  type HandoffBatch,
  type SerialChainOutput,
  type SerialChainStage,
} from './structured-handoff-runtime.js';

type GuardrailReason =
  | 'fanout'
  | 'depth'
  | 'budget'
  | 'revisit'
  | 'target_unavailable'
  | 'dependency';

/** 串行依赖输入 / 收口截断上限：超长时「上下保留」，掐掉中间。 */
const SERIAL_CARRY_MAX_CHARS = 12000;

/** 截断「上下保留」：超长时保留头部 + 尾部，中间塞省略标记，避免依赖输入只剩开头。 */
function boundTextHeadTail(text: string, max = SERIAL_CARRY_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.6);
  const tail = max - head;
  return `${text.slice(0, head)}\n…（中间已截断 ${text.length - max} 字）…\n${text.slice(text.length - tail)}`;
}

function targetRevisitCount(context: HandoffContext, targetAgentId: string): number {
  return context.lineage.filter((agentId) => agentId === targetAgentId).length;
}

export function evaluateHandoffTargetGuardrail(
  context: HandoffContext,
  targetAgentId: string,
): GuardrailReason | null {
  if (
    Number.isFinite(config.agent.handoffDepthMax) &&
    config.agent.handoffDepthMax > 0 &&
    context.depth + 1 > config.agent.handoffDepthMax
  ) {
    return 'depth';
  }
  if (
    Number.isFinite(config.agent.handoffRevisitMax) &&
    config.agent.handoffRevisitMax >= 0 &&
    targetRevisitCount(context, targetAgentId) > config.agent.handoffRevisitMax
  ) {
    return 'revisit';
  }
  return null;
}

async function resolveAvailableTarget(
  chatRoomId: string,
  mention: HandoffMention,
): Promise<Agent | null> {
  const agent = await agentService.findById(mention.agentId);
  if (!agent || !agent.isActive) return null;
  if (agent.agentLevel !== 'system') {
    const isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
    if (!isMember) return null;
  }
  return agent;
}

function buildGuardrailMessage(
  reason: GuardrailReason,
  detail: string,
  ownerMention: string,
): string {
  const prefix = ownerMention ? `${ownerMention} ` : '';
  const descriptions: Record<GuardrailReason, string> = {
    fanout: `本次结构化交接目标数超过扇出上限 ${config.agent.handoffFanoutMax}`,
    depth: `本次结构化交接将超过链路深度上限 ${config.agent.handoffDepthMax}`,
    budget: `本轮结构化协作将超过总派发预算 ${config.agent.handoffBudgetMax}`,
    revisit: `目标助手在当前血缘中的重访次数将超过上限 ${config.agent.handoffRevisitMax}`,
    target_unavailable: '目标助手已停用、退群或不存在',
    dependency: '串行接力的前序阶段没有产出有效结果，依赖链已中断',
  };
  return `${prefix}${descriptions[reason]}，已暂停自动交接。${detail} 请确认后重新指定下一步。`;
}

async function notifyGuardrail(
  chatRoomId: string,
  triggerMessage: Message,
  reason: GuardrailReason,
  detail: string,
): Promise<void> {
  const room = await chatRoomService.findById(chatRoomId);
  const ownerMention = room?.owner?.username ? `@${room.owner.username}` : '';
  const coordinator = await agentService.findById(GROUP_COORDINATOR_ID);
  const content = buildGuardrailMessage(reason, detail, ownerMention);
  const message = await buildAIMessage(
    content,
    triggerMessage.id,
    INTERNAL_COORDINATOR_AGENT_NAME,
    GROUP_COORDINATOR_ID,
    chatRoomId,
    coordinator?.avatar,
    coordinator?.avatarColor,
  );
  await messageService.create({
    id: message.id,
    type: 'REPLY',
    content: message.content,
    time: message.time,
    agentId: GROUP_COORDINATOR_ID,
    chatRoomId,
    replyMessageId: triggerMessage.id,
    isHuman: false,
  });
  if (globalEmit) await globalEmit(message, chatRoomId);
}

function buildTargetTriggerMessage(
  source: Message,
  sourceAgentName: string,
  target: Agent,
  task: string,
): Message {
  return {
    ...source,
    content: `[${sourceAgentName} 的结构化交接]\n@${target.name} ${task}`.trimEnd(),
  };
}

export function buildConvergencePrompt(batch: HandoffBatch): string {
  const branches = batch.results.map((result, index) => {
    const output = result.finalMessage?.content?.trim() || '（该分支没有最终消息）';
    const boundedOutput = boundTextHeadTail(output);
    const suggestions = result.suggestions.length > 0
      ? `\n分支建议：\n${result.suggestions.map((item) => `- @${item.agentName} ${item.task}`.trimEnd()).join('\n')}`
      : '';
    return `### 分支 ${index + 1}：${result.agentName}（${result.status}）\n${boundedOutput}${suggestions}`;
  }).join('\n\n');
  return `[结构化交接汇合]\n你此前并行交接的所有分支已经结束。请综合下面结果，直接给出收口结论；如果仍需其他助手继续，重新调用 mention_agents 明确交接。\n\n${branches}`;
}

interface ResumeOwnerParams {
  chatRoomId: string;
  rootMessageId: string;
  ownerAgentId: string;
  ownerAgentName: string;
  ownerContext: HandoffContext;
  sourceMessage: Message;
  prompt: string;
  historyAnchorMessageId: string;
}

/**
 * 收敛者（发起者）收口的统一核心：解析 / 护栏 / 预算 / 推进上下文 / 派回收敛轮次。
 * 并行批收敛与串行链终点共用，区别只在 prompt 与历史锚点。
 */
async function resumeOwner(params: ResumeOwnerParams): Promise<void> {
  const ownerMention: HandoffMention = {
    agentId: params.ownerAgentId,
    agentName: params.ownerAgentName,
    task: '汇总分支结果并收口',
  };
  const owner = await resolveAvailableTarget(params.chatRoomId, ownerMention);
  if (!owner) {
    await notifyGuardrail(
      params.chatRoomId,
      params.sourceMessage,
      'target_unavailable',
      `收敛者：${params.ownerAgentName}。`,
    );
    finishHandoffCascade(params.rootMessageId);
    return;
  }

  // 收敛者把分支结果接回自己收口，是 fanout 的正常终点，不算"重访循环"，
  // 因此忽略 revisit 护栏；depth/其它护栏仍然生效，失控由 handoffBudgetMax 兜底。
  const guardrail = evaluateHandoffTargetGuardrail(params.ownerContext, owner.id);
  if (guardrail && guardrail !== 'revisit') {
    await notifyGuardrail(params.chatRoomId, params.sourceMessage, guardrail, `收敛者：${owner.name}。`);
    finishHandoffCascade(params.rootMessageId);
    return;
  }
  const reservation = reserveHandoffDispatches(
    params.ownerContext,
    1,
    config.agent.handoffBudgetMax,
  );
  if (!reservation.ok) {
    await notifyGuardrail(params.chatRoomId, params.sourceMessage, 'budget', `收敛者：${owner.name}。`);
    finishHandoffCascade(params.rootMessageId);
    return;
  }

  const context = advanceHandoffContext(params.ownerContext, owner.id, {
    dispatchCount: reservation.dispatchCount,
    batchId: undefined,
    convergenceOwnerId: undefined,
    convergenceOwnerName: undefined,
    isLeaf: false,
  });
  const triggerMessage: Message = {
    ...params.sourceMessage,
    content: params.prompt,
  };
  try {
    await enqueueAgentTask(params.chatRoomId, triggerMessage, owner, null, {
      handoffContext: context,
      historyAnchorMessageId: params.historyAnchorMessageId,
      historyInclusive: true,
    });
  } catch (error) {
    releaseHandoffDispatches(params.rootMessageId, 1);
    throw error;
  }
}

/** 并行批收敛后，收敛者带「并行分支结果」收口。 */
async function resumeConvergenceOwner(batch: HandoffBatch): Promise<void> {
  const latestMessage = [...batch.results]
    .reverse()
    .find((result) => result.finalMessage)?.finalMessage;
  await resumeOwner({
    chatRoomId: batch.chatRoomId,
    rootMessageId: batch.rootMessageId,
    ownerAgentId: batch.ownerAgentId,
    ownerAgentName: batch.ownerAgentName,
    ownerContext: batch.ownerContext,
    sourceMessage: batch.sourceMessage,
    prompt: buildConvergencePrompt(batch),
    historyAnchorMessageId: latestMessage?.id ?? batch.sourceMessage.id,
  });
}

async function settleLeaf(event: AgentTaskSettledEvent, context: HandoffContext): Promise<void> {
  if (!context.batchId) {
    finishHandoffCascade(context.rootMessageId);
    return;
  }
  const result = completeStructuredHandoffBranch(context.batchId, {
    agentId: event.agentId,
    agentName: event.finalMessage?.agentName ?? context.lineage.at(-1) ?? event.agentId,
    status: event.status,
    finalMessage: event.finalMessage,
    suggestions: event.pendingMentions ?? [],
  });
  if (result.kind === 'ready') {
    await onBatchConverged(result.batch);
  } else if (result.kind === 'silenced') {
    // 用户介入静默收口：清掉串行链中尚未执行阶段的排队气泡。
    const chain = getSerialChain(context.rootMessageId);
    if (chain) {
      clearQueuedStageTyping(chain.chatRoomId, chain.sourceMessage.id, chain.remainingStages);
    }
    clearSerialChain(context.rootMessageId);
    finishHandoffCascade(context.rootMessageId);
  }
}

/** 把一个收敛批次的各分支产出，整理成串行链的依赖输入（内容已按上下保留截断）。 */
function collectStageOutputs(batch: HandoffBatch, stageIndex: number): SerialChainOutput[] {
  return batch.results.map((result) => ({
    stageIndex,
    agentName: result.agentName,
    status: result.status,
    content: boundTextHeadTail(result.finalMessage?.content?.trim() || '（该分支没有最终消息）'),
    finalMessageId: result.finalMessage?.id,
  }));
}

/** 串行依赖：只要本阶段任一分支未正常产出，依赖链即视为中断。 */
function stageHasBrokenDependency(batch: HandoffBatch): boolean {
  return batch.results.some(
    (result) => result.status !== 'completed' || !result.finalMessage?.content?.trim(),
  );
}

/** 批次收敛统一入口：属于串行链则推进下一阶段，否则按并行批收口。 */
async function onBatchConverged(batch: HandoffBatch): Promise<void> {
  const chain = getSerialChain(batch.rootMessageId);
  if (!chain || chain.currentBatchId !== batch.id) {
    await resumeConvergenceOwner(batch);
    return;
  }

  const stageIndex = chain.completedStageCount + 1;
  const outputs = collectStageOutputs(batch, stageIndex);

  // 前序失败 → 终止整条链（依赖型任务拿不到输入硬跑无意义）。
  if (stageHasBrokenDependency(batch)) {
    await notifyGuardrail(
      chain.chatRoomId,
      chain.sourceMessage,
      'dependency',
      `中断阶段：第${stageIndex}步。`,
    );
    clearQueuedStageTyping(chain.chatRoomId, chain.sourceMessage.id, chain.remainingStages);
    clearSerialChain(batch.rootMessageId);
    finishHandoffCascade(batch.rootMessageId);
    return;
  }

  appendSerialChainOutputs(batch.rootMessageId, outputs);
  const next = dequeueSerialChainStage(batch.rootMessageId);
  const refreshed = getSerialChain(batch.rootMessageId);
  if (!refreshed) {
    finishHandoffCascade(batch.rootMessageId);
    return;
  }

  if (next) {
    const anchorId = outputs[outputs.length - 1]?.finalMessageId ?? chain.sourceMessage.id;
    const dispatched = await dispatchStageBatch({
      chatRoomId: refreshed.chatRoomId,
      rootMessageId: refreshed.rootMessageId,
      ownerContext: refreshed.ownerContext,
      ownerAgentId: refreshed.ownerAgentId,
      ownerAgentName: refreshed.ownerAgentName,
      source: refreshed.sourceMessage,
      mentions: next.mentions,
      priorOutputs: refreshed.priorOutputs,
      historyAnchorMessageId: anchorId,
    });
    if (!dispatched.ok || !dispatched.batchId) {
      // next 已出队、其气泡已被 dispatchStageBatch 内 enqueue 转 executing 或仍 pending；
      // 连同后续未派阶段一起清掉排队气泡。
      clearQueuedStageTyping(refreshed.chatRoomId, refreshed.sourceMessage.id, [
        next,
        ...refreshed.remainingStages,
      ]);
      clearSerialChain(batch.rootMessageId);
      finishHandoffCascade(batch.rootMessageId);
      return;
    }
    setSerialChainBatch(batch.rootMessageId, dispatched.batchId);
    return;
  }

  // 链结束：发起者带整条链产出最终收口。
  const finalOutputs = refreshed.priorOutputs;
  clearSerialChain(batch.rootMessageId);
  const latestAnchor = [...finalOutputs].reverse().find((o) => o.finalMessageId)?.finalMessageId;
  await resumeOwner({
    chatRoomId: refreshed.chatRoomId,
    rootMessageId: refreshed.rootMessageId,
    ownerAgentId: refreshed.ownerAgentId,
    ownerAgentName: refreshed.ownerAgentName,
    ownerContext: refreshed.ownerContext,
    sourceMessage: refreshed.sourceMessage,
    prompt: buildSerialChainConvergencePrompt(finalOutputs),
    historyAnchorMessageId: latestAnchor ?? refreshed.sourceMessage.id,
  });
}

async function dispatchSingle(
  event: AgentTaskSettledEvent,
  context: HandoffContext,
  mention: HandoffMention,
): Promise<void> {
  const source = event.finalMessage!;
  const target = await resolveAvailableTarget(event.chatRoomId, mention);
  if (!target) {
    await notifyGuardrail(event.chatRoomId, source, 'target_unavailable', `目标：${mention.agentName}。`);
    finishHandoffCascade(context.rootMessageId);
    return;
  }
  const guardrail = evaluateHandoffTargetGuardrail(context, target.id);
  if (guardrail) {
    await notifyGuardrail(event.chatRoomId, source, guardrail, `目标：${target.name}。`);
    finishHandoffCascade(context.rootMessageId);
    return;
  }
  const reservation = reserveHandoffDispatches(context, 1, config.agent.handoffBudgetMax);
  if (!reservation.ok) {
    await notifyGuardrail(event.chatRoomId, source, 'budget', `目标：${target.name}。`);
    finishHandoffCascade(context.rootMessageId);
    return;
  }
  const nextContext = advanceHandoffContext(context, target.id, {
    dispatchCount: reservation.dispatchCount,
    batchId: undefined,
    convergenceOwnerId: undefined,
    convergenceOwnerName: undefined,
    isLeaf: false,
  });
  const trigger = buildTargetTriggerMessage(
    source,
    source.agentName ?? event.agentId,
    target,
    mention.task,
  );
  try {
    await enqueueAgentTask(event.chatRoomId, trigger, target, null, {
      handoffContext: nextContext,
      historyAnchorMessageId: source.id,
      historyInclusive: true,
    });
  } catch (error) {
    releaseHandoffDispatches(context.rootMessageId, 1);
    throw error;
  }
}

/** 串行接力的触发正文：把整条链已完成阶段的产出作为依赖输入显式注入（必达，不依赖群历史）。 */
function buildSerialChainTrigger(
  source: Message,
  ownerName: string,
  target: Agent,
  task: string,
  priorOutputs: SerialChainOutput[],
): Message {
  const priorBlock = priorOutputs.length > 0
    ? priorOutputs
        .map((o) => `--- 第${o.stageIndex}步 @${o.agentName}（${o.status}）---\n${o.content}`)
        .join('\n\n')
    : '（无前序产出）';
  const content = [
    `[${ownerName} 的结构化交接 · 串行 · 第${priorOutputs.length + 1}步 → @${target.name}]`,
    '前序结果（依赖输入）:',
    priorBlock,
    '',
    `你的任务: ${task}`.trimEnd(),
  ].join('\n');
  return { ...source, content };
}

/** 串行链终点：发起者收口提示，汇合整条链各阶段产出。 */
function buildSerialChainConvergencePrompt(outputs: SerialChainOutput[]): string {
  const body = outputs
    .map((o) => `### 第${o.stageIndex}步：${o.agentName}（${o.status}）\n${o.content}`)
    .join('\n\n');
  return `[结构化交接 · 串行链汇合]\n你发起的串行接力已全部结束。请综合下面各阶段结果，直接给出收口结论；如仍需其他助手继续，重新调用 mention_agents 明确交接。\n\n${body}`;
}

/**
 * 串行链：给「还没轮到」的后续阶段目标预先打上 pending 打字气泡（前端显示「等待执行」）。
 * 气泡挂在发起者触发消息上；轮到该阶段派发时，enqueue 的 typing 会就地把它切到 executing。
 */
function emitQueuedStageTyping(
  chatRoomId: string,
  triggerMessageId: string,
  stages: SerialChainStage[],
): void {
  if (!globalEmitTyping) return;
  for (const stage of stages) {
    for (const mention of stage.mentions) {
      globalEmitTyping(
        {
          messageId: triggerMessageId,
          agentId: mention.agentId,
          agentName: mention.agentName,
          status: 'pending',
        },
        chatRoomId,
      );
    }
  }
}

/**
 * 串行链异常终止（依赖断裂 / 护栏 / 用户介入）时，清掉那些永远不会执行的排队目标的 pending 气泡，
 * 否则它们会一直停在「等待执行」。借用 agent:done 按 agentId 移除气泡（不带 messageIds，无外发副作用）。
 */
function clearQueuedStageTyping(
  chatRoomId: string,
  triggerMessageId: string,
  stages: SerialChainStage[],
): void {
  if (!globalEmitDone) return;
  for (const stage of stages) {
    for (const mention of stage.mentions) {
      globalEmitDone(
        {
          agentId: mention.agentId,
          agentName: mention.agentName,
          triggerMessageId,
        },
        chatRoomId,
      );
    }
  }
}

interface StageBatchParams {
  chatRoomId: string;
  rootMessageId: string;
  /** 发起者（收敛者）上下文，所有分支由此 advance。 */
  ownerContext: HandoffContext;
  ownerAgentId: string;
  ownerAgentName: string;
  /** 触发来源消息（发起者消息），spread 进各分支触发。 */
  source: Message;
  mentions: HandoffMention[];
  /** 串行链：前序产出，存在则用串行触发正文显式注入依赖输入。 */
  priorOutputs?: SerialChainOutput[];
  /** 历史锚点（含本身），开了群历史的目标可读到前序原文。 */
  historyAnchorMessageId: string;
}

/**
 * 把一组目标作为「并行收敛单元」派发（单目标即退化为单分支批）。
 * 并行批与串行链阶段共用：差异仅在触发正文与历史锚点。
 * 返回 { ok:false } 表示护栏/预算已拦截（已发提示），由调用方决定收尾。
 */
async function dispatchStageBatch(
  params: StageBatchParams,
): Promise<{ ok: boolean; batchId?: string }> {
  const { chatRoomId, rootMessageId, ownerContext, mentions, source } = params;
  if (
    Number.isFinite(config.agent.handoffFanoutMax) &&
    config.agent.handoffFanoutMax > 0 &&
    mentions.length > config.agent.handoffFanoutMax
  ) {
    await notifyGuardrail(chatRoomId, source, 'fanout', `本次目标数：${mentions.length}。`);
    return { ok: false };
  }

  const targets: Array<{ mention: HandoffMention; agent: Agent }> = [];
  for (const mention of mentions) {
    const agent = await resolveAvailableTarget(chatRoomId, mention);
    if (!agent) {
      await notifyGuardrail(chatRoomId, source, 'target_unavailable', `目标：${mention.agentName}。`);
      return { ok: false };
    }
    const guardrail = evaluateHandoffTargetGuardrail(ownerContext, agent.id);
    if (guardrail) {
      await notifyGuardrail(chatRoomId, source, guardrail, `目标：${agent.name}。`);
      return { ok: false };
    }
    targets.push({ mention, agent });
  }

  const reservation = reserveHandoffDispatches(
    ownerContext,
    targets.length,
    config.agent.handoffBudgetMax,
  );
  if (!reservation.ok) {
    await notifyGuardrail(chatRoomId, source, 'budget', `本次目标数：${targets.length}。`);
    return { ok: false };
  }

  const batchId = randomUUID();
  startStructuredHandoffBatch({
    id: batchId,
    chatRoomId,
    rootMessageId,
    ownerAgentId: params.ownerAgentId,
    ownerAgentName: params.ownerAgentName,
    ownerContext,
    sourceMessage: source,
    pendingAgentIds: new Set(targets.map(({ agent }) => agent.id)),
    results: [],
    userIntervened: false,
  });

  for (const { mention, agent } of targets) {
    const leafContext = advanceHandoffContext(ownerContext, agent.id, {
      dispatchCount: reservation.dispatchCount,
      batchId,
      convergenceOwnerId: params.ownerAgentId,
      convergenceOwnerName: params.ownerAgentName,
      isLeaf: true,
    });
    const trigger = params.priorOutputs
      ? buildSerialChainTrigger(source, params.ownerAgentName, agent, mention.task, params.priorOutputs)
      : buildTargetTriggerMessage(source, params.ownerAgentName, agent, mention.task);
    try {
      await enqueueAgentTask(chatRoomId, trigger, agent, null, {
        handoffContext: leafContext,
        historyAnchorMessageId: params.historyAnchorMessageId,
        historyInclusive: true,
      });
    } catch (error) {
      releaseHandoffDispatches(rootMessageId, 1);
      const completion = completeStructuredHandoffBranch(batchId, {
        agentId: agent.id,
        agentName: agent.name,
        status: 'failed',
        suggestions: [],
      });
      if (completion.kind === 'ready') await onBatchConverged(completion.batch);
      debugLog('structuredHandoffBranchEnqueueFailed', {
        chatRoomId,
        batchId,
        agentId: agent.id,
        error: String(error),
      });
    }
  }
  return { ok: true, batchId };
}

/** 单阶段并行批：沿用既有「一次 @ 多个=并行收敛回发起者」语义。 */
async function dispatchBatch(
  event: AgentTaskSettledEvent,
  context: HandoffContext,
  mentions: HandoffMention[],
): Promise<void> {
  const source = event.finalMessage!;
  const result = await dispatchStageBatch({
    chatRoomId: event.chatRoomId,
    rootMessageId: context.rootMessageId,
    ownerContext: context,
    ownerAgentId: event.agentId,
    ownerAgentName: source.agentName ?? event.agentId,
    source,
    mentions,
    historyAnchorMessageId: source.id,
  });
  if (!result.ok) finishHandoffCascade(context.rootMessageId);
}

/**
 * 把本轮登记的批次归一化成有序的串行阶段队列：
 * - parallel 批（或单目标） → 1 个并行收敛阶段；
 * - serial 批（多目标） → 展开成多个单目标阶段；
 * - 多次调用按顺序拼接（多次调用之间恒串行）。
 */
export function normalizeStages(batches: HandoffMentionBatch[]): SerialChainStage[] {
  const stages: SerialChainStage[] = [];
  for (const batch of batches) {
    if (batch.mentions.length === 0) continue;
    if (batch.mode === 'serial' && batch.mentions.length > 1) {
      for (const mention of batch.mentions) stages.push({ mentions: [mention] });
    } else {
      stages.push({ mentions: batch.mentions });
    }
  }
  return stages;
}

/** 多阶段串行链：登记链（含剩余阶段）并派发首个阶段。 */
async function startSerialChainAndDispatchFirst(
  event: AgentTaskSettledEvent,
  context: HandoffContext,
  stages: SerialChainStage[],
): Promise<void> {
  const source = event.finalMessage!;
  const ownerName = source.agentName ?? event.agentId;
  const [first, ...rest] = stages;

  // 先登记链，确保首阶段 batch 收敛时能查到归属链。
  startSerialChain({
    rootMessageId: context.rootMessageId,
    chatRoomId: event.chatRoomId,
    ownerAgentId: event.agentId,
    ownerAgentName: ownerName,
    ownerContext: context,
    sourceMessage: source,
    remainingStages: rest,
    priorOutputs: [],
    completedStageCount: 0,
  });

  // 后续阶段先显示「等待执行」，让用户看到串行排队（首阶段由 enqueue 自己出 typing）。
  emitQueuedStageTyping(event.chatRoomId, source.id, rest);

  const dispatched = await dispatchStageBatch({
    chatRoomId: event.chatRoomId,
    rootMessageId: context.rootMessageId,
    ownerContext: context,
    ownerAgentId: event.agentId,
    ownerAgentName: ownerName,
    source,
    mentions: first!.mentions,
    historyAnchorMessageId: source.id,
  });
  if (!dispatched.ok || !dispatched.batchId) {
    clearQueuedStageTyping(event.chatRoomId, source.id, rest);
    clearSerialChain(context.rootMessageId);
    finishHandoffCascade(context.rootMessageId);
    return;
  }
  setSerialChainBatch(context.rootMessageId, dispatched.batchId);
}

export async function settleStructuredHandoff(event: AgentTaskSettledEvent): Promise<void> {
  const context = event.handoffContext;
  if (!context || event.agentId === GROUP_COORDINATOR_ID) return;
  if (context.isLeaf) {
    await settleLeaf(event, context);
    return;
  }
  if (event.status !== 'completed' || !event.finalMessage) {
    finishHandoffCascade(context.rootMessageId);
    return;
  }

  // 批次列表是权威来源；缺失时回退到旧的 pendingMentions（视作单个 parallel 批）。
  const batches: HandoffMentionBatch[] = event.pendingMentionBatches
    ?? (event.pendingMentions && event.pendingMentions.length > 0
      ? [{ mentions: event.pendingMentions, mode: 'parallel' }]
      : []);
  const stages = normalizeStages(batches);
  if (stages.length === 0) {
    finishHandoffCascade(context.rootMessageId);
    return;
  }

  debugLog('structuredHandoffSettled', {
    chatRoomId: event.chatRoomId,
    taskId: event.taskId,
    agentId: event.agentId,
    stageCount: stages.length,
    targets: stages.map((stage) => stage.mentions.map((m) => m.agentId)),
    intent: event.mentionIntent,
  });

  if (stages.length === 1) {
    // 单阶段：完全沿用既有行为（单目标=接力，多目标=并行收敛）。
    const stage = stages[0]!;
    if (stage.mentions.length === 1) {
      await dispatchSingle(event, context, stage.mentions[0]!);
    } else {
      await dispatchBatch(event, context, stage.mentions);
    }
    return;
  }

  // 多阶段：串行链。
  await startSerialChainAndDispatchFirst(event, context, stages);
}
