import { EventEmitter } from 'events';
import type { Agent } from '@prisma/client';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { agentMemoryService } from '../../../modules/agent-memory/agent-memory.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { agentService } from '../agent.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import type { Message } from '../../../types/message.js';
import { SKILLS_HELPER_AGENT_ID } from '../tools/index.js';
import { setGlobalCallbacks, globalEmitTyping, broadcastAgentStatus } from './status.js';
import type { AgentStatus } from './status.js';
import type { ToolCall } from '../executor.interface.js';
import { getExecutor } from './executor-manager.js';
import { processQueue } from './processor.js';
import { parseMentions } from './message-utils.js';
import { debugLog } from './debug.js';

// 消息接收事件接口
interface ReceivedMessageEvent {
  message: Message;
  chatRoomId: string;
}

// 消息事件发射器
const emitter = new EventEmitter();

export const messageEventEmitter = emitter as {
  on(
    event: 'receivedMessage',
    listener: (data: ReceivedMessageEvent) => void,
  ): void;
  emit(event: 'receivedMessage', data: ReceivedMessageEvent): boolean;
};

async function enqueueAgentTask(
  chatRoomId: string,
  message: Message,
  agent: Agent,
  quickChatTargetAgent?: Agent | null,
) {
  // 发送正在处理的事件
  if (globalEmitTyping) {
    globalEmitTyping(
      {messageId: message.id, agentId: agent.id, agentName: agent.name, status: 'pending'},
      chatRoomId,
    );
  }

  // 获取该助手在群内的配置，决定是否注入群历史
  const chatRoomAgent = await chatRoomService.getAgentMember(
    chatRoomId,
    agent.id,
  );
  const injectGroupHistory = chatRoomAgent?.injectGroupHistory ?? true;

  // 获取 executor（用于检查 lastInjectedMessageId 和后续更新）
  const executor = await getExecutor(chatRoomId, agent.name);

  // 获取群历史摘要和最近消息。压缩在后台异步执行，不阻塞当前任务。
  let history: any[] | undefined;
  if (injectGroupHistory && executor) {
    history = await agentMemoryService.buildHistory(chatRoomId, agent.id, message.id);
    console.log(`${agent.name}: 构建群历史上下文 ${history.length} 条（摘要 + 最近消息）`);
  }

  // 记录任务入队
  debugLog('taskEnqueue', {
    chatRoomId,
    agentId: agent.id,
    agentName: agent.name,
    triggerMessageId: message.id,
    triggerContent: message.content,
    historyCount: history?.length ?? 0,
    isIncremental: !!executor?.lastInjectedMessageId,
    history: history?.map(h => ({sender: h.senderName, content: h.content})),
  });

  // 准备 attachments 数据（提取 base64）
  const attachmentsData = message.attachments?.map(att => ({
    url: att.url,
    filename: att.filename,
    mimeType: att.mimeType,
    base64: att.base64 || '',  // 使用前端传来的 base64
  }))?.filter(att => att.base64);  // 只保留有 base64 的附件

  // 构建消息内容：如果是技能安装助手且在快速对话中，注入默认目标助手信息
  let processedMessageContent = message.content;
  if (agent.id === SKILLS_HELPER_AGENT_ID && quickChatTargetAgent) {
    // 在消息前附加默认目标助手信息
    processedMessageContent = `[默认目标助手: ${quickChatTargetAgent.name} (ID: ${quickChatTargetAgent.id})]\n${message.content}`;
    console.log(`[agent.handler] 技能安装助手在快速对话中被调用，注入默认目标: ${quickChatTargetAgent.name}`);
  }

  // 任务入队，保存当前历史快照
  await taskQueueService.enqueue({
    chatRoomId,
    agentId: agent.id,
    agentName: agent.name,
    messageId: message.id,
    messageContent: processedMessageContent,
    history,
    attachments: attachmentsData,  // 传递图片附件
  });

  // 入队后更新 lastInjectedMessageId（获取群聊最新消息的 ID）
  // 系统助手是虚拟成员，没有 ChatRoomAgent 记录，跳过更新
  if (injectGroupHistory && executor && agent.agentLevel !== 'system') {
    const latestMessages = await messageService.findByChatRoomId(
      chatRoomId,
      {take: 1, order: 'desc'},
    );
    if (latestMessages.length > 0) {
      const newLastInjectedId = latestMessages[0].id;
      // 更新 executor 实例
      executor.setLastInjectedMessageId(newLastInjectedId);
      // 更新数据库
      await chatRoomService.updateLastInjectedMessageId(chatRoomId, agent.id, newLastInjectedId);
      console.log(`${agent.name}: 更新上次注入位置为 ${newLastInjectedId}`);
    }
  }

  // 入队后广播状态更新（队列长度可能变化）
  broadcastAgentStatus(chatRoomId);

  // 触发队列处理
  processQueue(chatRoomId, agent.id);
}

// 设置 AI 处理器
export function setupAIHandlers(
  emit: (msg: Message, chatRoomId: string) => Promise<void> | void,
  emitTyping: (
    data: {messageId: string; agentId: string; agentName: string},
    chatRoomId: string,
  ) => void,
  emitDone: (
    data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number},
    chatRoomId: string,
  ) => void,
  emitStream: (
    data: {messageId: string; agentId: string; agentName: string; content: string},
    chatRoomId: string,
  ) => void,
  emitToolCall: (
    data: {messageId: string; agentId: string; agentName: string; toolCall: ToolCall},
    chatRoomId: string,
  ) => void,
  emitThinking: (
    data: {messageId: string; agentId: string; agentName: string; thinking: string},
    chatRoomId: string,
  ) => void,
  emitStatus: (
    data: { chatRoomId: string; statuses: Record<string, AgentStatus>; queueCounts?: Record<string, number> },
    chatRoomId2: string,
  ) => void,
  broadcastTaskQueue: (
    chatRoomId: string,
    agentId: string,
    tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[],
  ) => void,
  emitTodoCreated: (
    todo: {
      id: string;
      chatRoomId: string;
      messageId: string;
      triggerAgentId: string;
      triggerAgentName: string;
      ownerUserId: string;
      contentSummary: string;
      chatRoomName: string;
      status: string;
      createdAt: Date;
    },
    ownerUserId: string,
  ) => void,
) {
  // 保存全局回调
  setGlobalCallbacks({
    emit,
    emitTyping,
    emitDone,
    emitStream,
    emitToolCall,
    emitThinking,
    emitStatus,
    broadcastTaskQueue,
    emitTodoCreated,
  });

  messageEventEmitter.on(
    'receivedMessage',
    async (data: ReceivedMessageEvent) => {
      const {message, chatRoomId} = data;

      // 更新恢复服务的群状态
      const agentName = message.isHuman ? undefined : message.agentName;
      recoveryService.updateRoomState(chatRoomId, agentName);

      // 记录收到的消息
      debugLog('receivedMessage', {
        chatRoomId,
        messageId: message.id,
        content: message.content,
        sender: message.isHuman ? message.user : message.agentName,
        isHuman: message.isHuman,
        agentId: message.agentId,
      });

      // 先解析 @mentions，判断是否有 @助手
      const mentionNames = parseMentions(message.content);
      const hasMentions = mentionNames.length > 0;

      // 检查是否是快速对话群聊
      const chatRoom = await chatRoomService.findById(chatRoomId);

      // 快速对话群聊：如果没有 @其他助手，则触发快速对话助手
      if (chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId && message.isHuman && !hasMentions) {
        // 快速对话群聊：直接触发助手，不需要 @mentions
        const agent = await agentService.findById(chatRoom.quickChatAgentId);
        if (agent && agent.isActive) {
          debugLog('quickChatTrigger', {
            chatRoomId,
            agentId: agent.id,
            agentName: agent.name,
            triggerMessageId: message.id,
          });

          // 快速对话也使用群聊工作目录；未显式配置时让执行器回落到默认群目录。
          let sessionDir: string | undefined;
          if (chatRoom.workDir && chatRoom.workDir.trim()) {
            sessionDir = chatRoom.workDir.trim();
            console.log(`${agent.name}: 使用群工作目录 ${sessionDir}`);
          } else {
            sessionDir = undefined;
            console.log(`${agent.name}: 使用默认群工作目录`);
          }

          debugLog('quickChatWorkDirResolved', {
            chatRoomId,
            sessionDir,
          });

          // 发送正在处理的事件
          if (globalEmitTyping) {
            globalEmitTyping(
              {messageId: message.id, agentId: agent.id, agentName: agent.name, status: 'pending'},
              chatRoomId,
            );
          }

          // 准备 attachments 数据（提取 base64）
          const attachmentsData = message.attachments?.map(att => ({
            url: att.url,
            filename: att.filename,
            mimeType: att.mimeType,
            base64: att.base64 || '',  // 使用前端传来的 base64
          }))?.filter(att => att.base64);  // 只保留有 base64 的附件

          // 快速对话不注入群历史，直接入队
          await taskQueueService.enqueue({
            chatRoomId,
            agentId: agent.id,
            agentName: agent.name,
            messageId: message.id,
            messageContent: message.content,
            history: undefined,  // 快速对话不注入群历史
            sessionDir, // 仅在快速对话显式指定工作目录时传递
            attachments: attachmentsData,  // 传递图片附件
          });

          // 入队后广播状态更新（队列长度可能变化）
          broadcastAgentStatus(chatRoomId);

          // 触发队列处理
          processQueue(chatRoomId, agent.id);
        }
        // 快速对话助手已触发，直接返回（不处理 @mentions）
        return;
      }

      // 普通群聊：群主无 @ 发言时，触发默认接收助手
      if (!hasMentions) {
        if (
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          chatRoom.defaultAgentId &&
          message.isHuman &&
          message.userId &&
          message.userId === chatRoom.ownerId
        ) {
          const agent = await agentService.findById(chatRoom.defaultAgentId);

          if (agent && agent.isActive) {
            // 系统助手（agentLevel: 'system'）是虚拟成员，跳过成员检查
            // 普通助手需要检查是否是群聊成员
            if (agent.agentLevel !== 'system') {
              const isMember = await chatRoomService.isAgentMember(
                chatRoomId,
                agent.id,
              );
              if (!isMember) {
                console.log(
                  `Default agent ${agent.name} is not a member of chatRoom ${chatRoomId}`,
                );
                return;
              }
            }

            debugLog('defaultAgentTrigger', {
              chatRoomId,
              agentId: agent.id,
              agentName: agent.name,
              triggerMessageId: message.id,
            });

            await enqueueAgentTask(chatRoomId, message, agent);
          }
        }
        return;
      }

      debugLog('mentionsFound', {chatRoomId, mentionNames});

      // 手动模式下，助手消息的 @ 不触发其他助手
      if (chatRoom?.agentTriggerMode === 'manual' && !message.isHuman) {
        debugLog('manualModeSkip', { chatRoomId, agentName: message.agentName, mentions: mentionNames });
        return;
      }

      // 获取快速对话的目标助手信息（用于注入默认目标）
      const quickChatTargetAgent = chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId
        ? await agentService.findById(chatRoom.quickChatAgentId)
        : null;

      // 将所有被 @ 的助手任务入队
      for (const agentName of mentionNames) {
        // Find agent by name
        const agent = await agentService.findByName(agentName);
        if (!agent || !agent.isActive) continue;

        // 系统助手（agentLevel: 'system'）是虚拟成员，跳过成员检查
        // 普通助手需要检查是否是群聊成员
        if (agent.agentLevel !== 'system') {
          const isMember = await chatRoomService.isAgentMember(
            chatRoomId,
            agent.id,
          );
          if (!isMember) {
            console.log(
              `Agent ${agent.name} is not a member of chatRoom ${chatRoomId}`,
            );
            continue;
          }
        }

        await enqueueAgentTask(chatRoomId, message, agent, quickChatTargetAgent);
      }
    },
  );
}
