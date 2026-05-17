import { EventEmitter } from 'events';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { agentService } from '../agent.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import type { Message } from '../../../types/message.js';
import { setGlobalCallbacks, setGlobalEmitReceivedMessage } from './status.js';
import type { AgentStatus } from './status.js';
import type { ToolCall } from '../executor.interface.js';
import { parseKnownMentions } from './message-utils.js';
import { debugLog } from './debug.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
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
  emitChatRoomCreated: (chatRoom: any) => void,
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
    emitChatRoomCreated,
  });

  // 注入 receivedMessage 触发器，供 broadcastCronTriggerMessage 调用
  setGlobalEmitReceivedMessage((message, chatRoomId) => {
    emitter.emit('receivedMessage', { message, chatRoomId });
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

      const chatRoom = await chatRoomService.findById(chatRoomId);

      // 手动模式下，助手消息中的 @ 只作为公开展示。
      if (!message.isHuman && chatRoom?.agentTriggerMode !== 'auto') {
        debugLog('assistantMentionTriggerSkipped', {
          chatRoomId,
          messageId: message.id,
          reason: 'manualMode',
        });
        return;
      }

      // 先解析 @mentions，判断是否有 @助手
      const activeAgents = await agentService.findActive();
      const activeAgentByName = new Map(activeAgents.map((agent) => [agent.name, agent]));
      const mentionNames = parseKnownMentions(message.content, activeAgents.map((agent) => agent.name));
      const hasMentions = mentionNames.length > 0;

      // 快速对话群聊：如果没有 @其他助手，则触发快速对话助手
      if (message.isHuman && chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId && !hasMentions) {
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

          const attachmentsData = message.attachments?.map(att => ({
            url: att.url,
            filename: att.filename,
            mimeType: att.mimeType,
            base64: att.base64 || '',  // 使用前端传来的 base64
          }))?.filter(att => att.base64);  // 只保留有 base64 的附件

          await enqueueAgentTask(chatRoomId, message, agent, null, {
            skipHistory: true,
            sessionDir, // 仅在快速对话显式指定工作目录时传递
            attachments: attachmentsData,  // 传递图片附件
          });
        }
        // 快速对话助手已触发，直接返回（不处理 @mentions）
        return;
      }

      // 普通群聊：无 @ 发言时，触发默认接收助手。
      // Socket 入口已校验发送者是群聊成员；这里不再限制必须由群主触发，
      // 避免多人群聊或历史 ownerId 漂移时默认助手静默失效。
      if (!hasMentions) {
        if (
          message.isHuman &&
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          chatRoom.defaultAgentId &&
          message.userId
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

      // 获取快速对话的目标助手信息（用于注入默认目标）
      const quickChatTargetAgent = chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId
        ? await agentService.findById(chatRoom.quickChatAgentId)
        : null;

      // 将所有被 @ 的助手任务入队
      for (const agentName of mentionNames) {
        // Find agent by name
        const agent = activeAgentByName.get(agentName);
        if (!agent || !agent.isActive) continue;
        if (!message.isHuman && message.agentId && agent.id === message.agentId) {
          debugLog('assistantMentionTriggerSkipped', {
            chatRoomId,
            messageId: message.id,
            agentId: agent.id,
            agentName: agent.name,
            reason: 'selfMention',
          });
          continue;
        }

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
