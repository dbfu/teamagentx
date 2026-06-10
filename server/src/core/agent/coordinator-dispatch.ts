import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LlmProvider } from '@prisma/client';
import type { AgentWithRelations } from './agent.service.js';
import { chatRoomService } from '../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../modules/message/message.service.js';
import { agentService } from './agent.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';
import {
  buildInternalCoordinatorPrompt,
  INTERNAL_COORDINATOR_AGENT_NAME,
} from './internal-coordinator-agent.js';
import { GROUP_COORDINATOR_ID } from './system-assistant.constants.js';
import {
  buildCoordinatorLayeredContext,
  withCoordinatorContext,
} from './agent-handler/coordinator-context.js';
import { enqueueAgentTask } from './agent-handler/agent-dispatch.service.js';
import { startParallelBatch } from './agent-handler/parallel-batch-tracker.js';
import { globalEmit, globalEmitTyping, globalEmitDone } from './agent-handler/status.js';
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

const DISPATCH_TOOL_NAME = 'dispatch_decision';
const DISPATCH_TOOL_DESCRIPTION = '协调决策工具：输出调度决策（dispatch/no_dispatch/ask_owner/cannot_dispatch）。';
const DISPATCH_TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    decision: {
      type: 'string',
      enum: ['dispatch', 'no_dispatch', 'ask_owner', 'cannot_dispatch'],
      description: '决策类型：dispatch=调度助手；no_dispatch=无需调度；ask_owner=需群主确认；cannot_dispatch=系统管理请求',
    },
    targetAgentIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'dispatch 时必填：目标助手的 agentId 数组（从群成员清单获取），可多个（并行）',
    },
    content: {
      type: 'string',
      description: 'dispatch/ask_owner 时的消息内容；ask_owner 时格式：@群主用户名 + 问题（保留 Markdown）',
    },
    forwardVerbatim: {
      type: 'boolean',
      description: 'true 时后端直接用 [待裁决消息] 原文发送给目标助手，忽略 content',
    },
    reason: {
      type: 'string',
      enum: ['no_suitable_assistant', 'system_management'],
      description: 'cannot_dispatch 时的原因',
    },
  },
  required: ['decision'],
};

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
): string {
  const agentLines = chatRoomAgents
    .filter((cra) => cra.agent && (cra.agent as any).isActive && cra.agent.id !== GROUP_COORDINATOR_ID)
    .map((cra) => `- ${cra.agent!.name}（ID: ${cra.agent!.id}）`);

  const humanLines: string[] = [];
  if (ownerUsername) humanLines.push(`群主：@${ownerUsername}`);
  for (const member of humanMembers) {
    const name = member.user?.username;
    if (name && name !== ownerUsername) humanLines.push(`成员：@${name}`);
  }

  const agentSection = agentLines.length > 0
    ? `业务助手：\n${agentLines.join('\n')}`
    : '业务助手：（无）';
  const humanSection = humanLines.length > 0 ? `\n人类成员：\n${humanLines.join('\n')}` : '';

  return `## 当前群聊成员\n${agentSection}${humanSection}`;
}

async function callAnthropicCoordinator(
  provider: LlmProvider,
  systemPrompt: string,
  memberSection: string,
  userContent: string,
): Promise<DispatchDecision | null> {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: Anthropic.Messages.Tool = {
    name: DISPATCH_TOOL_NAME,
    description: DISPATCH_TOOL_DESCRIPTION,
    input_schema: DISPATCH_TOOL_PARAMETERS as Anthropic.Messages.Tool['input_schema'],
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
  });

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
): Promise<DispatchDecision | null> {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: OpenAI.Chat.Completions.ChatCompletionTool = {
    type: 'function',
    function: {
      name: DISPATCH_TOOL_NAME,
      description: DISPATCH_TOOL_DESCRIPTION,
      parameters: DISPATCH_TOOL_PARAMETERS,
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
  });

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

async function executeDecision(
  chatRoomId: string,
  triggerMessage: Message,
  decision: DispatchDecision,
  coordinatorAgent: AgentWithRelations,
): Promise<void> {
  debugLog('coordinatorStructuredDecision', {
    chatRoomId,
    decision: decision.decision,
    targetAgentIds: decision.targetAgentIds,
    reason: decision.reason,
    forwardVerbatim: decision.forwardVerbatim,
  });

  switch (decision.decision) {
    case 'no_dispatch':
    case 'cannot_dispatch':
      return;

    case 'ask_owner': {
      const content = decision.content?.trim();
      if (!content) return;
      const msg = buildAIMessage(
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
      return;
    }

    case 'dispatch': {
      const ids = decision.targetAgentIds ?? [];
      if (ids.length === 0) {
        console.warn('[coordinator-dispatch] dispatch decision missing targetAgentIds');
        return;
      }

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

      // 保存并广播协调助手的调度消息（与旧流程一致，前端可见）
      const mentionPart = targetAgents.map((a) => `@${a!.name}`).join(' ');
      const visibleContent = `${mentionPart} ${dispatchContent}`;
      const dispatchMsg = buildAIMessage(
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
      if (globalEmit) await globalEmit(dispatchMsg, chatRoomId);

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
      return;
    }
  }
}

export async function runCoordinatorDispatch(
  chatRoomId: string,
  message: Message,
  coordinatorAgent: AgentWithRelations,
): Promise<void> {
  const provider = await findCoordinatorProvider(coordinatorAgent);
  if (!provider) {
    console.warn('[coordinator-dispatch] 找不到 LLM Provider，跳过协调');
    return;
  }

  const chatRoom = await chatRoomService.findById(chatRoomId);
  if (!chatRoom) return;

  const chatRoomMembers = await chatRoomService.getAgents(chatRoomId);
  const humanMembers = chatRoom.chatRoomAgents.filter((cra: any) => cra.user);
  const memberSection = buildMemberSection(chatRoomMembers, chatRoom.owner?.username, humanMembers);

  const contextBlock = await buildCoordinatorLayeredContext(chatRoomId, message.id);
  const userContent = withCoordinatorContext(message.content, contextBlock);

  const systemPrompt = buildInternalCoordinatorPrompt();
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
      ? await callOpenAICoordinator(provider, systemPrompt, memberSection, userContent)
      : await callAnthropicCoordinator(provider, systemPrompt, memberSection, userContent);
  } catch (error) {
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

  await executeDecision(chatRoomId, message, decision, coordinatorAgent);

  if (globalEmitDone) {
    globalEmitDone(
      { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
      chatRoomId,
    );
  }
}
