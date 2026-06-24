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
} from '../../../types/handoff.js';
import { agentService } from '../agent.service.js';
import { buildAIMessage } from './message-utils.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
import { globalEmit } from './status.js';
import { debugLog } from './debug.js';
import {
  GROUP_COORDINATOR_ID,
} from '../system-assistant.constants.js';
import { INTERNAL_COORDINATOR_AGENT_NAME } from '../internal-coordinator-agent.js';
import type { AgentTaskSettledEvent } from './task-lifecycle.js';
import {
  completeStructuredHandoffBranch,
  finishHandoffCascade,
  releaseHandoffDispatches,
  reserveHandoffDispatches,
  startStructuredHandoffBatch,
  type HandoffBatch,
} from './structured-handoff-runtime.js';

type GuardrailReason = 'fanout' | 'depth' | 'budget' | 'revisit' | 'target_unavailable';

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
    const boundedOutput = output.length > 12000 ? `${output.slice(0, 12000)}\n…（已截断）` : output;
    const suggestions = result.suggestions.length > 0
      ? `\n分支建议：\n${result.suggestions.map((item) => `- @${item.agentName} ${item.task}`.trimEnd()).join('\n')}`
      : '';
    return `### 分支 ${index + 1}：${result.agentName}（${result.status}）\n${boundedOutput}${suggestions}`;
  }).join('\n\n');
  return `[结构化交接汇合]\n你此前并行交接的所有分支已经结束。请综合下面结果，直接给出收口结论；如果仍需其他助手继续，重新调用 mention_agents 明确交接。\n\n${branches}`;
}

async function resumeConvergenceOwner(batch: HandoffBatch): Promise<void> {
  const ownerMention: HandoffMention = {
    agentId: batch.ownerAgentId,
    agentName: batch.ownerAgentName,
    task: '汇总并行分支结果并收口',
  };
  const owner = await resolveAvailableTarget(batch.chatRoomId, ownerMention);
  if (!owner) {
    await notifyGuardrail(
      batch.chatRoomId,
      batch.sourceMessage,
      'target_unavailable',
      `收敛者：${batch.ownerAgentName}。`,
    );
    finishHandoffCascade(batch.rootMessageId);
    return;
  }

  // 收敛者把并行分支的结果接回自己收口，是 fanout 的正常终点，不算"重访循环"，
  // 因此忽略 revisit 护栏；depth/其它护栏仍然生效，失控由 handoffBudgetMax 兜底。
  const guardrail = evaluateHandoffTargetGuardrail(batch.ownerContext, owner.id);
  if (guardrail && guardrail !== 'revisit') {
    await notifyGuardrail(
      batch.chatRoomId,
      batch.sourceMessage,
      guardrail,
      `收敛者：${owner.name}。`,
    );
    finishHandoffCascade(batch.rootMessageId);
    return;
  }
  const reservation = reserveHandoffDispatches(
    batch.ownerContext,
    1,
    config.agent.handoffBudgetMax,
  );
  if (!reservation.ok) {
    await notifyGuardrail(
      batch.chatRoomId,
      batch.sourceMessage,
      'budget',
      `收敛者：${owner.name}。`,
    );
    finishHandoffCascade(batch.rootMessageId);
    return;
  }

  const context = advanceHandoffContext(batch.ownerContext, owner.id, {
    dispatchCount: reservation.dispatchCount,
    batchId: undefined,
    convergenceOwnerId: undefined,
    convergenceOwnerName: undefined,
    isLeaf: false,
  });
  const prompt = buildConvergencePrompt(batch);
  const latestMessage = [...batch.results]
    .reverse()
    .find((result) => result.finalMessage)?.finalMessage;
  const triggerMessage: Message = {
    ...batch.sourceMessage,
    content: prompt,
  };
  try {
    await enqueueAgentTask(batch.chatRoomId, triggerMessage, owner, null, {
      handoffContext: context,
      historyAnchorMessageId: latestMessage?.id ?? batch.sourceMessage.id,
      historyInclusive: true,
    });
  } catch (error) {
    releaseHandoffDispatches(batch.rootMessageId, 1);
    throw error;
  }
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
    await resumeConvergenceOwner(result.batch);
  } else if (result.kind === 'silenced') {
    finishHandoffCascade(context.rootMessageId);
  }
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

async function dispatchBatch(
  event: AgentTaskSettledEvent,
  context: HandoffContext,
  mentions: HandoffMention[],
): Promise<void> {
  const source = event.finalMessage!;
  if (
    Number.isFinite(config.agent.handoffFanoutMax) &&
    config.agent.handoffFanoutMax > 0 &&
    mentions.length > config.agent.handoffFanoutMax
  ) {
    await notifyGuardrail(event.chatRoomId, source, 'fanout', `本次目标数：${mentions.length}。`);
    finishHandoffCascade(context.rootMessageId);
    return;
  }

  const targets: Array<{ mention: HandoffMention; agent: Agent }> = [];
  for (const mention of mentions) {
    const agent = await resolveAvailableTarget(event.chatRoomId, mention);
    if (!agent) {
      await notifyGuardrail(event.chatRoomId, source, 'target_unavailable', `目标：${mention.agentName}。`);
      finishHandoffCascade(context.rootMessageId);
      return;
    }
    const guardrail = evaluateHandoffTargetGuardrail(context, agent.id);
    if (guardrail) {
      await notifyGuardrail(event.chatRoomId, source, guardrail, `目标：${agent.name}。`);
      finishHandoffCascade(context.rootMessageId);
      return;
    }
    targets.push({ mention, agent });
  }

  const reservation = reserveHandoffDispatches(
    context,
    targets.length,
    config.agent.handoffBudgetMax,
  );
  if (!reservation.ok) {
    await notifyGuardrail(event.chatRoomId, source, 'budget', `本次目标数：${targets.length}。`);
    finishHandoffCascade(context.rootMessageId);
    return;
  }

  const ownerName = source.agentName ?? event.agentId;
  const batchId = randomUUID();
  startStructuredHandoffBatch({
    id: batchId,
    chatRoomId: event.chatRoomId,
    rootMessageId: context.rootMessageId,
    ownerAgentId: event.agentId,
    ownerAgentName: ownerName,
    ownerContext: context,
    sourceMessage: source,
    pendingAgentIds: new Set(targets.map(({ agent }) => agent.id)),
    results: [],
    userIntervened: false,
  });

  for (const { mention, agent } of targets) {
    const leafContext = advanceHandoffContext(context, agent.id, {
      dispatchCount: reservation.dispatchCount,
      batchId,
      convergenceOwnerId: event.agentId,
      convergenceOwnerName: ownerName,
      isLeaf: true,
    });
    const trigger = buildTargetTriggerMessage(source, ownerName, agent, mention.task);
    try {
      await enqueueAgentTask(event.chatRoomId, trigger, agent, null, {
        handoffContext: leafContext,
        historyAnchorMessageId: source.id,
        historyInclusive: true,
      });
    } catch (error) {
      releaseHandoffDispatches(context.rootMessageId, 1);
      const completion = completeStructuredHandoffBranch(batchId, {
        agentId: agent.id,
        agentName: agent.name,
        status: 'failed',
        suggestions: [],
      });
      if (completion.kind === 'ready') await resumeConvergenceOwner(completion.batch);
      debugLog('structuredHandoffBranchEnqueueFailed', {
        chatRoomId: event.chatRoomId,
        batchId,
        agentId: agent.id,
        error: String(error),
      });
    }
  }
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
  const mentions = event.pendingMentions ?? [];
  if (mentions.length === 0) {
    finishHandoffCascade(context.rootMessageId);
    return;
  }

  debugLog('structuredHandoffSettled', {
    chatRoomId: event.chatRoomId,
    taskId: event.taskId,
    agentId: event.agentId,
    targets: mentions.map((mention) => mention.agentId),
    intent: event.mentionIntent,
  });
  if (mentions.length === 1) {
    await dispatchSingle(event, context, mentions[0]!);
  } else {
    await dispatchBatch(event, context, mentions);
  }
}
