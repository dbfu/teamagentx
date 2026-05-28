import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import type { IAgentExecutor, AgentDebugInfo, ChatRoomAgentInfo } from '../executor.interface.js';
import { createExecutor } from '../executor.factory.js';
import { resolveAgentImageProvider } from '../image-generation.service.js';
import { clearAgentLog } from '../agent-log.js';
import { agentService } from '../agent.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import {
  createInternalCoordinatorAgent,
  isInternalCoordinatorAgentName,
} from '../internal-coordinator-agent.js';
import { clearExecutorCacheEntries, executorCache, getCacheKey } from './cache.js';
import { setBroadcastCronTriggerMessageFn } from '../../cron/cron-scheduler.service.js';
import { broadcastCronTriggerMessage } from './message-utils.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { roomMessageIndexService } from '../../../modules/message/room-message-index.service.js';
import type { HistoryMessage } from '../../../modules/task-queue/task-queue.service.js';
import { globalEmit, globalEmitDone } from './status.js';
import { buildAIMessage } from './message-utils.js';
import { DEBUG_LOG_PATH } from './debug.js';

function getRequiredAcpProviderProtocol(acpTool?: string | null): 'anthropic' | 'openai' | null {
  if ((acpTool || 'claude') === 'claude') return 'anthropic';
  if (acpTool === 'codex') return 'openai';
  return null;
}

async function findCompatibleDefaultProvider(requiredProtocol: 'anthropic' | 'openai') {
  const defaultProvider = await llmProviderService.findDefault();
  if (((defaultProvider as any)?.apiProtocol || 'anthropic') === requiredProtocol) {
    return defaultProvider;
  }

  const activeProviders = await llmProviderService.findActive();
  return activeProviders.find((provider) => ((provider as any).apiProtocol || 'anthropic') === requiredProtocol) ?? null;
}

// Get or create Agent executor for a specific chatRoom
export async function getExecutor(
  chatRoomId: string,
  agentName: string,
  sessionDir?: string,  // 显式运行目录；快速对话未指定时使用群默认目录
): Promise<IAgentExecutor | null> {
  const cacheKey = sessionDir
    ? `${chatRoomId}_${agentName}_${sessionDir}`  // 自定义运行目录使用独立缓存 key
    : getCacheKey(chatRoomId, agentName);

  // Check cache
  if (executorCache.has(cacheKey)) {
    return executorCache.get(cacheKey)!;
  }

  // Load from database. The internal coordinator has its own hidden system agent.
  const isInternalCoordinator = isInternalCoordinatorAgentName(agentName);
  const baseAgent = isInternalCoordinator
    ? await agentService.findById(GROUP_COORDINATOR_ID)
    : await agentService.findByName(agentName);
  const agent = isInternalCoordinator && baseAgent
    ? createInternalCoordinatorAgent(baseAgent, { executorOnly: true })
    : baseAgent;
  if (!agent || !agent.isActive) {
    return null;
  }

  // Get ChatRoomAgent settings
  const chatRoomAgent = await chatRoomService.getAgentMember(
    chatRoomId,
    agent.id,
  );
  const injectGroupHistory = chatRoomAgent?.injectGroupHistory ?? false;
  const lastInjectedMessageId = chatRoomAgent?.lastInjectedMessageId ?? undefined;  // 上次注入位置

  // 获取群聊配置
  const chatRoom = await chatRoomService.findById(chatRoomId);
  const roomHumanNames = new Set<string>();
  const roomOwnerUsername = chatRoom?.owner?.username;
  if (chatRoom?.owner?.username) {
    roomHumanNames.add(chatRoom.owner.username);
  }
  for (const member of chatRoom?.chatRoomAgents ?? []) {
    if (member.user?.username) {
      roomHumanNames.add(member.user.username);
    }
  }
  const humanMentionInstruction = roomOwnerUsername
    ? `When you need a human user to answer a question or confirm something, mention the chatroom owner in your final reply as @${roomOwnerUsername}. Do not mention other human members for questions or confirmations unless the user explicitly asked you to contact a different person. Mentionable human users in this chatroom: ${[...roomHumanNames].join(', ')}. A mentioned user will receive a todo reminder.`
    : '';
  const chatRoomRules = [chatRoom?.rules?.trim(), humanMentionInstruction]
    .filter((rule): rule is string => Boolean(rule))
    .join('\n\n') || undefined;
  const chatRoomWorkDir = chatRoom?.workDir ?? undefined;

  // Get all agents in this chatRoom
  const chatRoomAgents = await chatRoomService.getAgents(chatRoomId);
  const agentInfos: ChatRoomAgentInfo[] = chatRoomAgents
    .map((cra) => ({
      name: cra.agent?.name || '',
      agentId: cra.agent?.id || '',
      workDir: cra.agent?.workDir,
      customWorkDir: chatRoomWorkDir,
    }))
    .filter((info) => info.name && info.agentId);

  // 获取 LLM Provider：优先使用助手绑定的；builtin 和系统 ACP 未绑定时使用兼容默认供应商。
  // 普通 ACP 未绑定时沿用 CLI 自身配置，避免改变已有外部助手行为。
  let llmProvider = agent.llmProvider;
  if (!llmProvider && agent.type === 'builtin') {
    // builtin 类型助手如果没有绑定供应商，尝试获取默认供应商
    llmProvider = await llmProviderService.findDefault();
    if (llmProvider) {
      console.log(`${agentName}: 使用默认 LLM Provider ${llmProvider.name}`);
    } else {
      console.warn(`${agentName}: 未找到 LLM Provider 配置`);
    }
  }
  if (!llmProvider && agent.type === 'acp' && agent.agentLevel === 'system') {
    const requiredProtocol = getRequiredAcpProviderProtocol(agent.acpTool);
    if (requiredProtocol) {
      llmProvider = await findCompatibleDefaultProvider(requiredProtocol);
      if (llmProvider) {
        console.log(`${agentName}: 系统助手使用 ${requiredProtocol} LLM Provider ${llmProvider.name}`);
      } else {
        console.warn(`${agentName}: 未找到 ${requiredProtocol} 协议 LLM Provider，将沿用本地 ${agent.acpTool || 'claude'} 配置`);
      }
    }
  }
  const imageGenerationProvider = agent.id ? await resolveAgentImageProvider(agent.id) : null;

  // Create executor using factory and cache
  const executor = createExecutor({
    agent,
    chatRoomId,
    threadId: cacheKey,
    injectGroupHistory,
    chatRoomAgents: agentInfos,
    sessionDir,
    customWorkDir: chatRoomWorkDir,
    llmProvider: llmProvider ?? undefined,
    imageGenerationProvider,
    lastInjectedMessageId,  // 传递上次注入位置
    chatRoomRules,  // 传递群规则
    stateless: agent.id === GROUP_COORDINATOR_ID,
  });
  executorCache.set(cacheKey, executor);
  return executor;
}

// Clear executor cache
export function clearExecutorCache(agentName?: string, chatRoomId?: string) {
  const clearedCount = clearExecutorCacheEntries(agentName, chatRoomId);

  if (agentName) {
    console.log(`[clearExecutorCache] 共删除 ${clearedCount} 个缓存（agentName: ${agentName}）`);
  }
}

// Get debug info for an agent in a chatRoom
export function getAgentDebugInfo(
  chatRoomId: string,
  agentName: string,
): AgentDebugInfo | null {
  const cacheKey = getCacheKey(chatRoomId, agentName);
  const executor = executorCache.get(cacheKey);
  if (!executor) {
    return null;
  }
  return executor.getDebugInfo();
}

// For testing: inject debug info into cache
export function _testInjectDebugInfo(
  chatRoomId: string,
  agentName: string,
  debugInfo: Partial<AgentDebugInfo>,
): void {
  const cacheKey = getCacheKey(chatRoomId, agentName);
  const fullDebugInfo: AgentDebugInfo = {
    name: debugInfo.name ?? agentName,
    type: 'acp',
    systemPrompt: debugInfo.systemPrompt ?? 'test prompt',
    lastContext: debugInfo.lastContext ?? null,
    lastInvokeResult: debugInfo.lastInvokeResult ?? null,
    lastHistory: debugInfo.lastHistory ?? null,
    threadId: debugInfo.threadId ?? cacheKey,
    chatRoomId: debugInfo.chatRoomId ?? chatRoomId,
    injectGroupHistory: debugInfo.injectGroupHistory ?? false,
    chatRoomAgents: debugInfo.chatRoomAgents ?? [],
    workDir: debugInfo.workDir,
    lastResponse: debugInfo.lastResponse ?? null,
    acpTool: debugInfo.acpTool,
    agentId: debugInfo.agentId,
    llmProvider: debugInfo.llmProvider,
  };

  const executor: IAgentExecutor = {
    name: fullDebugInfo.name,
    chatRoomId: fullDebugInfo.chatRoomId,
    injectGroupHistory: fullDebugInfo.injectGroupHistory,
    workDir: fullDebugInfo.workDir,
    lastInjectedMessageId: undefined,
    async exec() {
      return { actions: [] };
    },
    getDebugInfo(): AgentDebugInfo {
      return fullDebugInfo;
    },
    setLastInjectedMessageId() {
      // Test helper only needs debug info injection.
    },
  };

  executorCache.set(cacheKey, executor);
}

// Initialize all active agents (preload into cache)
export async function initAgents() {
  const agents = await agentService.findActive();
  console.log(`已加载 ${agents.length} 个活跃 Agent`);

  // 清空调试日志文件
  try {
    if (existsSync(DEBUG_LOG_PATH)) {
      unlinkSync(DEBUG_LOG_PATH);
    }
    writeFileSync(DEBUG_LOG_PATH, '', 'utf-8');
    console.log(`调试日志已重置: ${DEBUG_LOG_PATH}`);
  } catch (err) {
    console.error('Failed to reset debug log:', err);
  }

  // 清空 Agent 执行日志
  await clearAgentLog();

  // 任务持久化恢复逻辑已在 app.ts 中处理，此处不再清空任务队列

  // 设置恢复服务的 Agent 触发回调
  recoveryService.setTriggerAgentCallback(
    async (
      chatRoomId: string,
      agentName: string,
      recoveryPrompt: string,
    ) => {
      const agent = await agentService.findByName(agentName);
      if (!agent || !agent.isActive) {
        console.log(`[恢复] Agent ${agentName} 不存在或未激活`);
        return;
      }

      // 检查 Agent 是否在群内
      const isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
      if (!isMember) {
        console.log(`[恢复] Agent ${agentName} 不在群 ${chatRoomId} 中`);
        return;
      }

      // 使用原有的 executor，保持上下文连续性
      const executor = await getExecutor(chatRoomId, agentName);
      if (!executor) {
        console.log(`[恢复] 无法获取 Agent ${agentName} 的执行器`);
        return;
      }

      // 获取 agent 完整信息
      const agentInfo = await agentService.findById(agent.id);

      // 创建 emit 回调
      const emitCallback = async (content: string, replyMessageId?: string) => {
        const aiMessage = buildAIMessage(
          content,
          replyMessageId || null,
          agentName,
          agent.id,
          chatRoomId,
          agentInfo?.avatar,
          agentInfo?.avatarColor,
        );

        try {
          await messageService.create({
            id: aiMessage.id,
            type: 'REPLY',
            content: aiMessage.content,
            time: aiMessage.time,
            agentId: agent.id,
            chatRoomId,
            replyMessageId: aiMessage.replyMessageId || null,
            isHuman: false,
          });
          if (globalEmit) {
            await globalEmit(aiMessage, chatRoomId);
          }
        } catch (err) {
          console.error('[恢复] 保存消息失败:', err);
        }
      };

      // 恢复时只构建群消息索引，不触发长期摘要。
      let history: HistoryMessage[] | undefined;
      if (executor.injectGroupHistory) {
        const latestMessages = await messageService.findByChatRoomId(chatRoomId, { take: 1, order: 'desc' });
        history = latestMessages[0]
          ? await roomMessageIndexService.buildMessageIndex(
              chatRoomId,
              latestMessages[0].id,
              executor.lastInjectedMessageId,
            )
          : [];
      }

      // 执行恢复，恢复提示会注入到 Agent 的对话历史中
      await executor.exec(recoveryPrompt, emitCallback, '', history);

      // 恢复执行完成，通知前端（使用特殊标识作为 triggerMessageId）
      if (globalEmitDone) {
        globalEmitDone({ agentId: agent.id, agentName, triggerMessageId: 'recovery', executionRecordId: undefined, messageIds: [], duration: undefined }, chatRoomId);
      }

      // 更新恢复服务状态
      recoveryService.setProcessingState(chatRoomId, false);
    },
  );

  // 启动恢复服务（暂时禁用）
  // recoveryService.start();

  // 设置广播定时任务触发消息函数引用给 cron scheduler
  setBroadcastCronTriggerMessageFn(broadcastCronTriggerMessage);
}
