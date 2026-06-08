import { EventEmitter } from 'events';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { agentService } from '../agent.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import type { Message } from '../../../types/message.js';
import { setGlobalCallbacks, setGlobalEmitReceivedMessage } from './status.js';
import type { AgentStatus } from './status.js';
import type { ToolCall } from '../executor.interface.js';
import { parseKnownMentions } from './message-utils.js';
import { debugLog } from './debug.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { createInternalCoordinatorAgent } from '../internal-coordinator-agent.js';
import { scheduleStallWatchdog, resetStallWatchdog } from './stall-watchdog.js';
import {
  buildCoordinatorRecentContext,
  withCoordinatorContext,
} from './coordinator-context.js';
import { checkAndClearInterrupted } from './stall-watchdog.js';
import {
  startParallelBatch,
  markBatchAgentComplete,
} from './parallel-batch-tracker.js';

// 消息接收事件接口
interface ReceivedMessageEvent {
  message: Message;
  chatRoomId: string;
}

export function shouldTriggerCoordinatorAgent(params: {
  agentTriggerMode: string;
  isQuickChatRoom?: boolean | null | undefined;
  hasMentions: boolean;
  messageIsHuman?: boolean | undefined;
  sourceAgentId?: string | null;
  hasUserMentions?: boolean;
}) {
  if (params.agentTriggerMode !== 'coordinator') return false;
  if (params.isQuickChatRoom) return false;
  if (params.sourceAgentId === GROUP_COORDINATOR_ID) return false;
  // 助手直接 @用户时不触发群调度，让用户直接看到助手的消息
  if (params.hasUserMentions) return false;

  return !params.hasMentions || !params.messageIsHuman;
}

export function getTriggerMentionNames(params: {
  agentTriggerMode: string;
  sourceAgentId?: string | null;
  mentionNames: string[];
}) {
  const isInternalCoordinatorDispatch =
    params.agentTriggerMode === 'coordinator' &&
    params.sourceAgentId === GROUP_COORDINATOR_ID;

  return isInternalCoordinatorDispatch
    ? params.mentionNames
    : params.mentionNames.slice(0, 1);
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
    data: {messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing'; startedAt?: number},
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
  emitTodoCreated: (todo: any, userId: string) => void,
  broadcastTaskQueue: (
    chatRoomId: string,
    agentId: string,
    tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[],
  ) => void,
  emitChatRoomCreated: (chatRoom: any) => void,
  emitAgentsUpdated: (chatRoomId: string) => void,
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
    emitTodoCreated,
    broadcastTaskQueue,
    emitChatRoomCreated,
    emitAgentsUpdated,
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

      const agentTriggerMode = chatRoom?.agentTriggerMode ?? 'coordinator';

      // 卡住检测兜底（仅自由协作 auto 模式）：人类发言清零连续救援计数；
      // 业务助手发完消息后重置房间防抖定时器，超时且房间空闲时唤醒群调度助手裁决。
      // 但如果房间刚刚被用户中断（手动停止任务），不触发 watchdog，防止群调度介入。
      if (message.isHuman) {
        resetStallWatchdog(chatRoomId);
      } else if (
        agentTriggerMode === 'auto' &&
        chatRoom &&
        !chatRoom.isQuickChatRoom &&
        message.agentId !== GROUP_COORDINATOR_ID
      ) {
        // 检查房间是否刚刚被用户中断，如果是则跳过 watchdog
        if (checkAndClearInterrupted(chatRoomId)) {
          console.log(`[handler] ${chatRoomId} 房间刚被用户中断，跳过 watchdog`);
        } else {
          scheduleStallWatchdog(chatRoomId);
        }
      }

      // 手动模式下，助手消息中的 @ 只作为公开展示。
      if (
        !message.isHuman &&
        agentTriggerMode === 'manual'
      ) {
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
      const mentionNames = parseKnownMentions(
        message.content,
        activeAgents.map((agent) => agent.name),
        { allowInline: true },
      );
      const triggerMentionNames = getTriggerMentionNames({
        agentTriggerMode,
        sourceAgentId: message.agentId,
        mentionNames,
      });
      const hasMentions = triggerMentionNames.length > 0;

      // 助手 @用户时不触发群调度：解析消息中是否有 @人类成员
      // 如果助手直接 @用户（如群主），说明需要用户确认，不应触发群调度自动介入
      let hasUserMentions = false;
      if (!message.isHuman && chatRoom) {
        // 获取群聊中的所有用户成员
        const userMembers = await chatRoomService.getUserMembers(chatRoomId);
        const usernames = userMembers.map((m) => m.user?.username).filter(Boolean) as string[];
        // 检查消息中是否有 @这些用户
        const userMentions = parseKnownMentions(message.content, usernames, { allowInline: true });
        hasUserMentions = userMentions.length > 0;
      }

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

      // 协调模式：用户显式 @ 仍直接触发；助手消息即使 @ 其他助手，也先交给内置群调度助手裁决。
      // 但如果助手直接 @用户，不触发群调度，让用户直接看到助手的消息。
      if (
        chatRoom &&
        shouldTriggerCoordinatorAgent({
          agentTriggerMode,
          isQuickChatRoom: chatRoom.isQuickChatRoom,
          hasMentions,
          messageIsHuman: message.isHuman,
          sourceAgentId: message.agentId,
          hasUserMentions,
        })
      ) {
        // 并行批次检查：协调者同时派发多个助手时，等所有助手都完成后再触发协调者一次，
        // 避免每个助手完成时都白白调用一次 LLM（中途必然输出"无需调度"）。
        if (!message.isHuman && message.agentId) {
          const batchResult = markBatchAgentComplete(chatRoomId, message.agentId);
          if (batchResult === 'pending') {
            debugLog('parallelBatchWaiting', {
              chatRoomId,
              agentId: message.agentId,
              reason: 'waitingForOtherParallelAgents',
            });
            return;
          }
          // 'last'：最后一个并行任务完成，放行；'none'：不在批次里，正常流程
        }
        const coordinatorAgent = await agentService.findById(GROUP_COORDINATOR_ID);

        if (coordinatorAgent && coordinatorAgent.isActive) {
          debugLog('coordinatorAgentTrigger', {
            chatRoomId,
            agentId: coordinatorAgent.id,
            agentName: coordinatorAgent.name,
            triggerMessageId: message.id,
            sourceAgentId: message.agentId,
            sourceIsHuman: message.isHuman,
            hasMentions,
          });

          // 调度助手非群成员，消息索引段与回查工具都被门控；把最近群消息作为
          // 「仅供裁决参考」上下文拼进触发消息正文，让它能基于最近上下文路由。
          const contextBlock = await buildCoordinatorRecentContext(
            chatRoomId,
            message.id,
          );
          const coordinatorMessage = contextBlock
            ? { ...message, content: withCoordinatorContext(message.content, contextBlock) }
            : message;

          await enqueueAgentTask(
            chatRoomId,
            coordinatorMessage,
            createInternalCoordinatorAgent(coordinatorAgent),
          );
        } else {
          console.warn(`[coordinatorAgentTrigger] 内置协调助手不存在或未启用: ${GROUP_COORDINATOR_ID}`);
        }
        return;
      }

      // 普通群聊：无 @ 发言时，触发默认接收助手。
      // Socket 入口已校验发送者是群聊成员；这里不再限制必须由群主触发，
      // 避免多人群聊或历史 ownerId 漂移时默认助手静默失效。
      if (!hasMentions) {
        if (
          message.isHuman &&
          chatRoom &&
          agentTriggerMode === 'auto' &&
          !chatRoom.isQuickChatRoom &&
          !chatRoom.defaultAgentId &&
          message.replyMessageId
        ) {
          const replyTargetMessage = await messageService.findById(message.replyMessageId);
          const replyTargetAgentId = replyTargetMessage?.chatRoomId === chatRoomId && !replyTargetMessage.isHuman
            ? replyTargetMessage.agentId
            : null;

          if (replyTargetAgentId) {
            const agent = await agentService.findById(replyTargetAgentId);

            if (agent && agent.isActive) {
              if (agent.agentLevel !== 'system') {
                const isMember = await chatRoomService.isAgentMember(
                  chatRoomId,
                  agent.id,
                );
                if (!isMember) {
                  console.log(
                    `Reply target agent ${agent.name} is not a member of chatRoom ${chatRoomId}`,
                  );
                  return;
                }
              }

              debugLog('ownerMentionReplyTrigger', {
                chatRoomId,
                agentId: agent.id,
                agentName: agent.name,
                triggerMessageId: message.id,
                replyMessageId: message.replyMessageId,
              });

              await enqueueAgentTask(chatRoomId, message, agent);
            }
          }
          return;
        }

        if (
          message.isHuman &&
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          chatRoom.defaultAgentId
        ) {
          const agent = await agentService.findById(chatRoom.defaultAgentId);

          if (agent && agent.isActive) {
            // 系统助手（agentLevel: 'system'）是内置执行器，跳过成员检查
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

      debugLog('mentionsFound', {
        chatRoomId,
        mentionNames,
        triggerMentionNames,
        ignoredMentionNames: mentionNames.filter((name) => !triggerMentionNames.includes(name)),
      });

      // 获取快速对话的目标助手信息（用于注入默认目标）
      const quickChatTargetAgent = chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId
        ? await agentService.findById(chatRoom.quickChatAgentId)
        : null;

      // 协调模式下只有内置群调度助手可在单条消息中同时触发多个助手；其他来源只处理第一个有效助手。
      const dispatchedAgentIds: string[] = [];
      for (const agentName of triggerMentionNames) {
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

        // 系统助手（agentLevel: 'system'）是内置执行器，跳过成员检查
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
        dispatchedAgentIds.push(agent.id);
      }

      // 协调者并行派发了多个助手时，启动批次追踪，等全部完成后再触发协调者
      if (dispatchedAgentIds.length > 1) {
        startParallelBatch(chatRoomId, dispatchedAgentIds);
      }
    },
  );
}
