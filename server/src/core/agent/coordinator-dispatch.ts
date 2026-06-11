import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LlmProvider } from '@prisma/client';
import type { AgentWithRelations } from './agent.service.js';
import { chatRoomService } from '../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../modules/message/message.service.js';
import { agentService } from './agent.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';
import { workbenchTaskService } from '../../modules/workbench/workbench.service.js';
import { taskQueueService } from '../../modules/task-queue/task-queue.service.js';
import { coordinatorLogService } from '../../modules/coordinator-log/coordinator-log.service.js';
import {
  buildInternalCoordinatorPrompt,
  INTERNAL_COORDINATOR_AGENT_NAME,
} from './internal-coordinator-agent.js';
import { GROUP_COORDINATOR_ID } from './system-assistant.constants.js';
import {
  buildCoordinatorLayeredContext,
  coordinatorPendingDecisionLabel,
  withCoordinatorContext,
} from './agent-handler/coordinator-context.js';
import { pickLocaleText, type Locale, normalizeLocale } from './agent-handler/locale.js';
import { enqueueAgentTask } from './agent-handler/agent-dispatch.service.js';
import { startParallelBatch } from './agent-handler/parallel-batch-tracker.js';
import {
  globalEmit,
  globalBroadcastMessage,
  globalEmitTyping,
  globalEmitDone,
} from './agent-handler/status.js';
import { buildAIMessage } from './agent-handler/message-utils.js';
import type { Message } from '../../types/message.js';
import { debugLog } from './agent-handler/debug.js';

export interface DispatchDecision {
  decision: 'dispatch' | 'no_dispatch' | 'ask_owner' | 'cannot_dispatch';
  targetAgentIds?: string[];
  content?: string;
  forwardVerbatim?: boolean;
  reason?: 'no_suitable_assistant' | 'system_management';
}

export interface CoordinatorDispatchOptions {
  /** 中止信号：用于在自由协作（auto）模式卡住检测自动调度途中，被用户发言打断时取消本次调度。 */
  signal?: AbortSignal;
  /** 本次调度实际派发的目标助手 id 回调（含尚未执行的排队任务），供调用方在用户介入时一并停掉。 */
  onAgentsDispatched?: (agentIds: string[]) => void;
}

const DISPATCH_TOOL_NAME = 'dispatch_decision';

function getDispatchToolDescription(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN': '协调决策工具：输出调度决策（dispatch/no_dispatch/ask_owner/cannot_dispatch）。',
      'en-US':
        'Coordination decision tool: output a dispatch decision (dispatch/no_dispatch/ask_owner/cannot_dispatch).',
    },
    locale,
  );
}

function getDispatchToolParameters(locale?: string) {
  const pendingMarker = coordinatorPendingDecisionLabel(locale);
  return {
    type: 'object' as const,
    properties: {
      decision: {
        type: 'string',
        enum: ['dispatch', 'no_dispatch', 'ask_owner', 'cannot_dispatch'],
        description: pickLocaleText(
          {
            'zh-CN': '决策类型：dispatch=调度助手；no_dispatch=无需调度；ask_owner=需群主确认；cannot_dispatch=系统管理请求',
            'en-US':
              'Decision type: dispatch = dispatch an assistant; no_dispatch = no dispatch needed; ask_owner = owner confirmation needed; cannot_dispatch = system-management request',
          },
          locale,
        ),
      },
      targetAgentIds: {
        type: 'array',
        items: { type: 'string' },
        description: pickLocaleText(
          {
            'zh-CN': 'dispatch 时必填：目标助手的「名称」数组，必须与群成员清单中的助手名称完全一致（逐字、不要自造 ID），可多个（并行）',
            'en-US':
              'Required for dispatch: an array of target assistant "names", each matching a chatroom member name exactly (verbatim, never invent IDs); may be multiple (parallel)',
          },
          locale,
        ),
      },
      content: {
        type: 'string',
        description: pickLocaleText(
          {
            'zh-CN': 'dispatch/ask_owner 时的消息内容；ask_owner 时格式：@群主用户名 + 问题（保留 Markdown）',
            'en-US':
              'Message content for dispatch/ask_owner; for ask_owner the format is @owner_username + question (preserve Markdown)',
          },
          locale,
        ),
      },
      forwardVerbatim: {
        type: 'boolean',
        description: pickLocaleText(
          {
            'zh-CN': `true 时后端直接用 [${pendingMarker}] 原文发送给目标助手，忽略 content`,
            'en-US': `When true, the backend sends the [${pendingMarker}] original text directly to the target assistant and ignores content`,
          },
          locale,
        ),
      },
      reason: {
        type: 'string',
        enum: ['no_suitable_assistant', 'system_management'],
        description: pickLocaleText(
          {
            'zh-CN': 'cannot_dispatch 时的原因',
            'en-US': 'Reason when cannot_dispatch',
          },
          locale,
        ),
      },
    },
    required: ['decision'],
  };
}

async function findCoordinatorProvider(coordinatorAgent: AgentWithRelations): Promise<LlmProvider | null> {
  if (coordinatorAgent.llmProvider) return coordinatorAgent.llmProvider;

  const requiredProtocol: 'anthropic' | 'openai' =
    (coordinatorAgent as any).acpTool === 'codex' ? 'openai' : 'anthropic';

  const defaultProvider = await llmProviderService.findDefault();
  if (defaultProvider && ((defaultProvider as any).apiProtocol ?? 'anthropic') === requiredProtocol) {
    return defaultProvider;
  }
  const active = await llmProviderService.findActive();
  return active.find((p) => ((p as any).apiProtocol ?? 'anthropic') === requiredProtocol) ?? null;
}

function buildMemberSection(
  chatRoomAgents: Awaited<ReturnType<typeof chatRoomService.getAgents>>,
  ownerUsername: string | null | undefined,
  humanMembers: Array<{ user?: { username?: string | null } | null }>,
  locale?: string,
): string {
  const t = (entry: Record<Locale, string>) => pickLocaleText(entry, locale);
  const ownerLabel = t({ 'zh-CN': '群主：', 'en-US': 'Owner: ' });
  const memberLabel = t({ 'zh-CN': '成员：', 'en-US': 'Member: ' });

  const agentLines = chatRoomAgents
    .filter((cra) => cra.agent && (cra.agent as any).isActive && cra.agent.id !== GROUP_COORDINATOR_ID)
    .map((cra) => `- ${cra.agent!.name}`);

  const humanLines: string[] = [];
  if (ownerUsername) humanLines.push(`${ownerLabel}@${ownerUsername}`);
  for (const member of humanMembers) {
    const name = member.user?.username;
    if (name && name !== ownerUsername) humanLines.push(`${memberLabel}@${name}`);
  }

  const agentsTitle = t({ 'zh-CN': '业务助手：', 'en-US': 'Business assistants:' });
  const noneText = t({ 'zh-CN': '业务助手：（无）', 'en-US': 'Business assistants: (none)' });
  const humansTitle = t({ 'zh-CN': '人类成员：', 'en-US': 'Human members:' });
  const sectionTitle = t({ 'zh-CN': '当前群聊成员', 'en-US': 'Current chatroom members' });

  const agentSection = agentLines.length > 0
    ? `${agentsTitle}\n${agentLines.join('\n')}`
    : noneText;
  const humanSection = humanLines.length > 0 ? `\n${humansTitle}\n${humanLines.join('\n')}` : '';

  return `## ${sectionTitle}\n${agentSection}${humanSection}`;
}

async function callAnthropicCoordinator(
  provider: LlmProvider,
  systemPrompt: string,
  memberSection: string,
  userContent: string,
  locale?: string,
  signal?: AbortSignal,
): Promise<DispatchDecision | null> {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: Anthropic.Messages.Tool = {
    name: DISPATCH_TOOL_NAME,
    description: getDispatchToolDescription(locale),
    input_schema: getDispatchToolParameters(locale) as Anthropic.Messages.Tool['input_schema'],
  };

  const response = await client.messages.create({
    model: provider.model,
    max_tokens: 512,
    temperature: 0,
    system: [
      { type: 'text', text: systemPrompt },
      { type: 'text', text: memberSection, cache_control: { type: 'ephemeral' } },
    ] as Anthropic.Messages.TextBlockParam[],
    messages: [{ role: 'user', content: userContent }],
    tools: [tool],
    tool_choice: { type: 'any' },
  }, { signal });

  const toolUse = response.content.find(
    (c): c is Anthropic.Messages.ToolUseBlock =>
      c.type === 'tool_use' && c.name === DISPATCH_TOOL_NAME,
  );
  return toolUse ? (toolUse.input as DispatchDecision) : null;
}

async function callOpenAICoordinator(
  provider: LlmProvider,
  systemPrompt: string,
  memberSection: string,
  userContent: string,
  locale?: string,
  signal?: AbortSignal,
): Promise<DispatchDecision | null> {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: OpenAI.Chat.Completions.ChatCompletionTool = {
    type: 'function',
    function: {
      name: DISPATCH_TOOL_NAME,
      description: getDispatchToolDescription(locale),
      parameters: getDispatchToolParameters(locale),
    },
  };

  const response = await client.chat.completions.create({
    model: provider.model,
    max_tokens: 512,
    temperature: 0,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${memberSection}` },
      { role: 'user', content: userContent },
    ],
    tools: [tool],
    tool_choice: { type: 'function', function: { name: DISPATCH_TOOL_NAME } },
  }, { signal });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (response.choices[0]?.message?.tool_calls?.[0] as any)?.function?.arguments as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DispatchDecision;
  } catch {
    console.error('[coordinator-dispatch] JSON parse failed:', raw);
    return null;
  }
}

/**
 * 仅当群内确实没有进行中的任务（无 pending/executing 队列任务）时，
 * 才把该群「已派发 / 执行中」的工作台任务流转为 waiting_review（待确认）。
 * 与非协调模式（processor.ts finally 中的逻辑）保持一致，避免协调器在助手执行途中
 * 因中间消息触发 no_dispatch / ask_owner 而提前将任务标记为待确认。
 */
async function syncWorkbenchOnRoomIdle(chatRoomId: string): Promise<void> {
  try {
    const activeTasks = await taskQueueService.getActiveTasks(chatRoomId);
    if (activeTasks.length > 0) {
      debugLog('workbenchSyncSkippedRoomBusy', {
        chatRoomId,
        activeTaskCount: activeTasks.length,
      });
      return;
    }
    await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, true);
  } catch (error) {
    console.error('[workbench] 同步派发任务状态失败:', error);
  }
}

// 归一化助手标识 token：去首尾空白、去掉前导 @、小写，便于按名称匹配。
function normalizeAgentToken(token: string): string {
  return token.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * 把协调器返回的目标助手 token 解析为「真实 agentId」。
 *
 * 背景：让 LLM 逐字复现 36 位 UUID 极不可靠，实际线上出现过模型把多个助手的 UUID 片段
 * 拼接成不存在的 ID（如把「运维」前半段 + 「UI设计」后半段拼出 d489d615-...-eb6d06e），
 * 导致 findById 查不到、dispatch 静默失败（表现为「又不调度了」）。
 *
 * 现在提示词要求 LLM 回传助手「名称」，这里按 名称 / 真实 ID 双路解析：
 *   1) token 精确等于群内某活跃助手的真实 ID（兼容模型偶尔给出正确 UUID）
 *   2) token 归一化后等于群内某活跃助手的名称（主路径）
 *   3) 兜底原样透传：可能是系统级助手 ID（不在群成员清单内），交由后续 findById/级别校验
 */
async function resolveTargetAgentIds(chatRoomId: string, tokens: string[]): Promise<string[]> {
  const roomAgents = await chatRoomService.getAgents(chatRoomId);
  const active = roomAgents
    .map((cra) => cra.agent)
    .filter((a): a is NonNullable<typeof a> =>
      !!a && (a as any).isActive && a.id !== GROUP_COORDINATOR_ID);

  const idSet = new Set(active.map((a) => a.id));
  const nameToId = new Map(active.map((a) => [normalizeAgentToken(a.name), a.id]));

  const resolved: string[] = [];
  for (const token of tokens) {
    if (!token || !token.trim()) continue;
    if (idSet.has(token)) {
      resolved.push(token);
      continue;
    }
    const byName = nameToId.get(normalizeAgentToken(token));
    if (byName) {
      resolved.push(byName);
      continue;
    }
    // 兜底透传（系统级助手 id 或正确但不在群清单内的 id）
    resolved.push(token);
  }
  return resolved;
}

async function executeDecision(
  chatRoomId: string,
  triggerMessage: Message,
  decision: DispatchDecision,
  coordinatorAgent: AgentWithRelations,
  options?: CoordinatorDispatchOptions,
): Promise<void> {
  // 被用户发言打断：放弃执行本次调度决策（不派发、不改工作台状态）。
  if (options?.signal?.aborted) {
    debugLog('coordinatorDispatchAborted', { chatRoomId, phase: 'beforeExecute' });
    return;
  }
  debugLog('coordinatorStructuredDecision', {
    chatRoomId,
    decision: decision.decision,
    targetAgentIds: decision.targetAgentIds,
    reason: decision.reason,
    forwardVerbatim: decision.forwardVerbatim,
  });

  // 记录调度日志的辅助函数
  const writeLog = async (success: boolean = true, errorMessage?: string) => {
    try {
      await coordinatorLogService.create({
        chatRoomId,
        triggerMessageId: triggerMessage.id,
        decision: decision.decision,
        targetAgentIds: decision.targetAgentIds,
        content: decision.content,
        forwardVerbatim: decision.forwardVerbatim,
        reason: decision.reason,
        sourceAgentId: triggerMessage.agentId ?? undefined,
        sourceIsHuman: triggerMessage.isHuman,
        sourceContent: triggerMessage.content.slice(0, 500),
        success,
        errorMessage,
      });
    } catch (error) {
      console.error('[coordinator-dispatch] 写入调度日志失败:', error);
    }
  };

  switch (decision.decision) {
    case 'no_dispatch':
      // 群调度助手本次未调度助手 ≠ 群内已空闲：
      // 助手在执行过程中产生的中间消息（进度/阶段产物）也会触发协调，此时协调器通常给出
      // no_dispatch。若直接标记 waiting_review，会让任务在真正完成前就跳到「待确认」，
      // 表现为「不进入执行中、执行完成后才进待确认」。因此只有群内确实没有进行中的任务
      // （无 pending/executing 队列任务）时，才把派发任务流转为 waiting_review。
      await syncWorkbenchOnRoomIdle(chatRoomId);
      await writeLog();
      return;

    case 'cannot_dispatch':
      // 系统管理请求，不是工作任务，不更新工作台状态
      await writeLog();
      return;

    case 'ask_owner': {
      const content = decision.content?.trim();
      if (!content) return;
      const msg = await buildAIMessage(
        content,
        triggerMessage.id,
        INTERNAL_COORDINATOR_AGENT_NAME,
        GROUP_COORDINATOR_ID,
        chatRoomId,
        coordinatorAgent.avatar,
        coordinatorAgent.avatarColor,
      );
      await messageService.create({
        id: msg.id,
        type: 'REPLY',
        content: msg.content,
        time: msg.time,
        agentId: GROUP_COORDINATOR_ID,
        chatRoomId,
        replyMessageId: triggerMessage.id,
        isHuman: false,
      });
      if (globalEmit) await globalEmit(msg, chatRoomId);
      // 等待用户确认 → 同样仅在群内确实空闲时才流转为 waiting_review，避免助手仍在执行时
      // 因转发其问题而提前把任务标记为待确认。
      await syncWorkbenchOnRoomIdle(chatRoomId);
      await writeLog();
      return;
    }

    case 'dispatch': {
      const tokens = decision.targetAgentIds ?? [];
      if (tokens.length === 0) {
        console.warn('[coordinator-dispatch] dispatch decision missing targetAgentIds');
        return;
      }

      // 协调器现按「名称」回传目标助手，这里容错解析为真实 agentId，
      // 规避 LLM 编造 / 拼接 UUID 导致 findById 查不到、dispatch 静默失败的问题。
      const ids = await resolveTargetAgentIds(chatRoomId, tokens);

      const dispatchContent = decision.forwardVerbatim
        ? triggerMessage.content
        : (decision.content?.trim() || triggerMessage.content);

      // 先解析所有有效的目标助手
      const targetAgents: Awaited<ReturnType<typeof agentService.findById>>[] = [];
      for (const agentId of ids) {
        const agent = await agentService.findById(agentId);
        if (!agent || !(agent as any).isActive) {
          console.warn(`[coordinator-dispatch] agent ${agentId} not found or inactive`);
          continue;
        }
        if ((agent as any).agentLevel !== 'system') {
          const isMember = await chatRoomService.isAgentMember(chatRoomId, agentId);
          if (!isMember) {
            console.warn(`[coordinator-dispatch] agent ${agent.name} not in room ${chatRoomId}`);
            continue;
          }
        }
        targetAgents.push(agent);
      }

      if (targetAgents.length === 0) return;

      // 提前回报本次将要派发的目标助手 id：即便在「广播 / enqueue」过程中被用户打断，
      // 调用方（卡住检测 watchdog）也能凭此把这些助手的执行/排队任务一并停掉。
      options?.onAgentsDispatched?.(targetAgents.map((a) => a!.id));

      // 必须在「广播调度消息 / enqueue 助手」之前，先把工作台任务从 dispatched 推进到 in_progress。
      // 否则被调度的助手可能在该流转之前就执行完并产出消息，触发协调器再次裁决得到 no_dispatch，
      // 而此时群内已空闲（助手任务已出队），no_dispatch 会把 dispatched 直接刷成 waiting_review，
      // 跳过「执行中」，表现为任务一直停留在「已派发」后直接进「待确认」。
      try {
        await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, false);
      } catch (error) {
        console.error('[workbench] 同步派发任务状态失败:', error);
      }

      // 保存并广播协调助手的调度消息（与旧流程一致，前端可见）
      const mentionPart = targetAgents.map((a) => `@${a!.name}`).join(' ');
      const visibleContent = `${mentionPart} ${dispatchContent}`;
      const dispatchMsg = await buildAIMessage(
        visibleContent,
        triggerMessage.id,
        INTERNAL_COORDINATOR_AGENT_NAME,
        GROUP_COORDINATOR_ID,
        chatRoomId,
        coordinatorAgent.avatar,
        coordinatorAgent.avatarColor,
      );
      await messageService.create({
        id: dispatchMsg.id,
        type: 'REPLY',
        content: dispatchMsg.content,
        time: dispatchMsg.time,
        agentId: GROUP_COORDINATOR_ID,
        chatRoomId,
        replyMessageId: triggerMessage.id,
        isHuman: false,
      });
      // 关键：调度广播必须用「仅 UI 同步」的 globalBroadcastMessage，而非会触发 receivedMessage
      // 的 globalEmit。否则这条 "@运维 ..." 广播会重新进入 handler，命中 @提及分派把目标助手
      // 再入队一次；与下面 executeDecision 直接 enqueue 叠加，导致同一助手被调度两次。
      if (globalBroadcastMessage) await globalBroadcastMessage(dispatchMsg, chatRoomId);

      // 用已保存的调度消息作为触发源，让目标助手的回复能正确指向它
      const dispatchedIds: string[] = [];
      for (const agent of targetAgents) {
        const agentTriggerMessage: Message = {
          ...dispatchMsg,
          content: `@${agent!.name} ${dispatchContent}`,
        };
        await enqueueAgentTask(chatRoomId, agentTriggerMessage, agent!);
        dispatchedIds.push(agent!.id);
      }

      if (dispatchedIds.length > 1) {
        startParallelBatch(chatRoomId, dispatchedIds);
      }
      // 调度日志记录解析后的真实 agentId，而非协调器回传的名称 token。
      decision.targetAgentIds = dispatchedIds;
      await writeLog();
      return;
    }
  }
}

export async function runCoordinatorDispatch(
  chatRoomId: string,
  message: Message,
  coordinatorAgent: AgentWithRelations,
  options?: CoordinatorDispatchOptions,
): Promise<void> {
  const signal = options?.signal;
  const provider = await findCoordinatorProvider(coordinatorAgent);
  if (!provider) {
    console.warn('[coordinator-dispatch] 找不到 LLM Provider，跳过协调');
    return;
  }

  const chatRoom = await chatRoomService.findById(chatRoomId);
  if (!chatRoom) return;

  // 提示词语言跟随群主的界面语言（房间维度统一），保证注入上下文与提示词同语种。
  const locale: Locale = normalizeLocale((chatRoom.owner as any)?.preferredLanguage);

  const chatRoomMembers = await chatRoomService.getAgents(chatRoomId);
  const humanMembers = chatRoom.chatRoomAgents.filter((cra: any) => cra.user);
  const memberSection = buildMemberSection(chatRoomMembers, chatRoom.owner?.username, humanMembers, locale);

  const contextBlock = await buildCoordinatorLayeredContext(chatRoomId, message.id, locale);
  const userContent = withCoordinatorContext(message.content, contextBlock, {
    isHuman: message.isHuman,
    name: message.isHuman ? message.user : message.agentName,
  }, locale);

  const systemPrompt = buildInternalCoordinatorPrompt(locale);
  const protocol = ((provider as any).apiProtocol ?? 'anthropic') as string;

  if (globalEmitTyping) {
    globalEmitTyping(
      { messageId: message.id, agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, status: 'executing' },
      chatRoomId,
    );
  }

  let decision: DispatchDecision | null;
  try {
    decision = protocol === 'openai'
      ? await callOpenAICoordinator(provider, systemPrompt, memberSection, userContent, locale, signal)
      : await callAnthropicCoordinator(provider, systemPrompt, memberSection, userContent, locale, signal);
  } catch (error) {
    // 被用户发言打断（abort）属预期路径，不当作错误。
    if (signal?.aborted) {
      debugLog('coordinatorDispatchAborted', { chatRoomId, phase: 'llm' });
      if (globalEmitDone) {
        globalEmitDone(
          { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
          chatRoomId,
        );
      }
      return;
    }
    console.error('[coordinator-dispatch] LLM 调用失败:', error);
    if (globalEmitDone) {
      globalEmitDone(
        { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
        chatRoomId,
      );
    }
    return;
  }

  if (!decision) {
    console.error('[coordinator-dispatch] 结构化调用未返回决策，跳过');
    if (globalEmitDone) {
      globalEmitDone(
        { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
        chatRoomId,
      );
    }
    return;
  }

  console.log('[coordinator-dispatch] 调度决策:', JSON.stringify(decision, null, 2));

  await executeDecision(chatRoomId, message, decision, coordinatorAgent, options);

  if (globalEmitDone) {
    globalEmitDone(
      { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
      chatRoomId,
    );
  }
}
