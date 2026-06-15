import { EventEmitter } from 'events';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { agentService } from '../agent.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import type { Message } from '../../../types/message.js';
import type { Platform } from '../../../modules/bridge/bridge.service.js';
import { setGlobalCallbacks, setGlobalEmitReceivedMessage } from './status.js';
import type { AgentStatus } from './status.js';
import type { ToolCall } from '../executor.interface.js';
import { parseKnownMentions } from './message-utils.js';
import { debugLog } from './debug.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { workbenchTaskService } from '../../../modules/workbench/workbench.service.js';
import { scheduleStallWatchdog, resetStallWatchdog, abortWatchdogDispatch } from './stall-watchdog.js';
import { runCoordinatorDispatch, tryAdvanceSerialChain } from '../coordinator-dispatch.js';
import { messageMentionsRoomUser, findDirectReplyAgentId } from './user-mention-utils.js';
import { checkAndClearInterrupted } from './stall-watchdog.js';
import {
  startParallelBatch,
  markBatchAgentComplete,
  markBatchUserIntervention,
} from './parallel-batch-tracker.js';
import {
  isCurrentSerialTask,
  markSerialUserIntervention,
} from './serial-chain-tracker.js';
import { setAgentTaskSettledHandler } from './task-lifecycle.js';
import { normalizeTriggerMode } from './trigger-mode.js';
import {
  resetCollaborationBudget,
  registerHandoff,
  notifyCollaborationBudgetExceeded,
} from './collaboration-budget.js';

// 消息接收事件接口
interface ReceivedMessageEvent {
  message: Message;
  chatRoomId: string;
  bridgeInfo?: {
    platform: Platform;
    externalId: string;
    sourceMessageId?: string;
  };
}

export interface AssistantHandoffClassification {
  kind: 'none' | 'single' | 'multiple';
  names: string[];
}

/**
 * 业务助手消息的交接分类（智能协作模式）：
 * - none：无 @（或只 @ 了自己）→ 任务完成或交还用户，watchdog 兜底；
 * - single：恰好一个其他助手 → 快路径直接接力；
 * - multiple：≥2 个 → 歧义信号，升级协调器裁决，不再静默截断到第一个。
 */
export function classifyAssistantHandoff(params: {
  mentionNames: string[];
  selfAgentId?: string | null;
  agentIdByName: Map<string, string>;
}): AssistantHandoffClassification {
  const names = [...new Set(params.mentionNames)].filter((name) => {
    const id = params.agentIdByName.get(name);
    return !!id && id !== params.selfAgentId;
  });
  if (names.length === 0) return { kind: 'none', names };
  return { kind: names.length === 1 ? 'single' : 'multiple', names };
}

// 唤起内置群调度助手裁决（智能协作模式的协调器介入点统一入口）
async function triggerCoordinatorAgentDispatch(
  chatRoomId: string,
  message: Message,
  reason: string,
): Promise<void> {
  const coordinatorAgent = await agentService.findById(GROUP_COORDINATOR_ID);
  if (!coordinatorAgent || !coordinatorAgent.isActive) {
    console.warn(`[coordinatorAgentTrigger] 内置协调助手不存在或未启用: ${GROUP_COORDINATOR_ID}`);
    return;
  }
  debugLog('coordinatorAgentTrigger', {
    chatRoomId,
    reason,
    agentId: coordinatorAgent.id,
    agentName: coordinatorAgent.name,
    triggerMessageId: message.id,
    sourceAgentId: message.agentId,
    sourceIsHuman: message.isHuman,
  });
  await runCoordinatorDispatch(chatRoomId, message, coordinatorAgent, {
    routingReason: reason,
  });
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
    data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number; model?: string},
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

  setAgentTaskSettledHandler(async (event) => {
    const serialResult = await tryAdvanceSerialChain(
      event.chatRoomId,
      event.agentId,
      event.taskId,
      event.finalMessage?.id ?? '',
      event.status,
    );
    if (serialResult === 'none') return;
    if (serialResult === 'advanced') return;
    if (serialResult === 'terminated') {
      debugLog('serialChainTerminated', {
        chatRoomId: event.chatRoomId,
        agentId: event.agentId,
        taskId: event.taskId,
        status: event.status,
      });
      return;
    }
    if (serialResult === 'completed_user_intervened') {
      debugLog('serialChainJoinSilenced', {
        chatRoomId: event.chatRoomId,
        agentId: event.agentId,
        taskId: event.taskId,
        reason: 'userIntervened',
      });
      return;
    }
    if (!event.finalMessage) {
      debugLog('serialChainJoinSkipped', {
        chatRoomId: event.chatRoomId,
        agentId: event.agentId,
        taskId: event.taskId,
        reason: 'missingFinalMessage',
      });
      return;
    }
    debugLog('serialChainJoin', {
      chatRoomId: event.chatRoomId,
      agentId: event.agentId,
      taskId: event.taskId,
      triggerMessageId: event.finalMessage.id,
    });
    await triggerCoordinatorAgentDispatch(
      event.chatRoomId,
      event.finalMessage,
      'serialChainJoin',
    );
  });

  // 注入 receivedMessage 触发器，供 broadcastCronTriggerMessage 调用
  setGlobalEmitReceivedMessage((message, chatRoomId) => {
    emitter.emit('receivedMessage', { message, chatRoomId });
  });

  messageEventEmitter.on(
    'receivedMessage',
    async (data: ReceivedMessageEvent) => {
      const {message, chatRoomId, bridgeInfo} = data;

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

      // 智能协作（coordinator，合并自原 auto/coordinator 两种模式）或手动（manual）
      const agentTriggerMode = normalizeTriggerMode(chatRoom?.agentTriggerMode);
      const isSmartMode = agentTriggerMode === 'coordinator';
      // 助手 @用户时不触发自动接力或卡住检测：说明需要用户确认。
      let hasUserMentions = false;
      if (!message.isHuman && chatRoom) {
        hasUserMentions = await messageMentionsRoomUser(chatRoomId, message.content);
        if (hasUserMentions) {
          try {
            await workbenchTaskService.syncNeedsInputOnUserMention(chatRoomId);
          } catch (error) {
            console.error('[workbench] 同步需补充状态失败:', error);
          }
        }
      }

      // 卡住检测兜底（智能协作模式）：人类发言清零协作预算与连续救援计数；
      // 业务助手发完消息后重置房间防抖定时器，超时且房间空闲时唤醒群调度助手裁决。
      // 但如果房间刚刚被用户中断（手动停止任务），不触发 watchdog，防止群调度介入。
      if (message.isHuman) {
        resetStallWatchdog(chatRoomId);
        // 用户介入 = 新协作回合：清零跳数/环路熔断计数
        resetCollaborationBudget(chatRoomId);
        // 用户主动发言：终止卡住检测触发的「自动续跑」调度（含已派发的助手），让位于用户。
        abortWatchdogDispatch(chatRoomId);
        // 批次期间用户发言 = 用户接管：join 降级为静默收口，不再自动派发，
        // 避免与用户介入后的新链路（直达回复 / 显式 @ / 兜底裁决）重复派发或上下文竞争。
        if (!chatRoom?.isQuickChatRoom) {
          markBatchUserIntervention(chatRoomId);
          markSerialUserIntervention(chatRoomId);
        }
      } else if (
        isSmartMode &&
        chatRoom &&
        !chatRoom.isQuickChatRoom &&
        message.agentId !== GROUP_COORDINATOR_ID
      ) {
        if (hasUserMentions) {
          debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'messageMentionsUser' });
        } else if (checkAndClearInterrupted(chatRoomId)) {
          // 检查房间是否刚刚被用户中断，如果是则跳过 watchdog
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

      // ===== 串行链消息拦截（推进由 processor 的任务完成事件负责）=====
      // 串行任务执行期间产生的普通/错误消息只展示，不参与助手交接判定。
      // 必须同时匹配 taskQueueId，避免同一助手的其它任务消息被误认为当前链步骤。
      if (
        isSmartMode &&
        !message.isHuman &&
        message.agentId &&
        message.taskQueueId &&
        message.agentId !== GROUP_COORDINATOR_ID &&
        !chatRoom?.isQuickChatRoom &&
        isCurrentSerialTask(chatRoomId, message.agentId, message.taskQueueId)
      ) {
        debugLog('serialChainTaskMessageObserved', {
          chatRoomId,
          agentId: message.agentId,
          taskId: message.taskQueueId,
          messageId: message.id,
        });
        return;
      }

      // ===== 并行批次拦截（公共路径，必须在任何触发判定之前，包括快路径）=====
      // 批次进行中，成员消息里的任何 @ 一律不触发、只挂起；全部完成（join）后由协调器
      // 拿全部产出 + 挂起的交接意向统一裁决。挂起无需单独存储：消息已照常入库/广播，
      // join 时协调器通过分层上下文自然读到。
      if (
        isSmartMode &&
        !message.isHuman &&
        message.agentId &&
        message.agentId !== GROUP_COORDINATOR_ID &&
        !chatRoom?.isQuickChatRoom
      ) {
        const batchResult = markBatchAgentComplete(chatRoomId, message.agentId);
        if (batchResult === 'pending') {
          debugLog('parallelBatchWaiting', {
            chatRoomId,
            agentId: message.agentId,
            reason: 'waitingForOtherParallelAgents',
          });
          return;
        }
        if (batchResult === 'last') {
          debugLog('parallelBatchJoin', {
            chatRoomId,
            agentId: message.agentId,
            triggerMessageId: message.id,
          });
          await triggerCoordinatorAgentDispatch(chatRoomId, message, 'parallelBatchJoin');
          return;
        }
        if (batchResult === 'last_user_intervened') {
          // 用户已在批次期间接管：静默收口，后续推进由用户链路驱动，watchdog 兜底
          debugLog('parallelBatchJoinSilenced', {
            chatRoomId,
            agentId: message.agentId,
            reason: 'userIntervened',
          });
          return;
        }
        // 'none'：不在批次里，继续正常流程
      }

      // 先解析 @mentions，判断是否有 @助手
      const activeAgents = await agentService.findActive();
      const activeAgentByName = new Map(activeAgents.map((agent) => [agent.name, agent]));
      const mentionNames = parseKnownMentions(
        message.content,
        activeAgents.map((agent) => agent.name),
        { allowInline: true },
      );
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
            bridgeInfo,  // 传递 Bridge 信息
          });
        }
        // 快速对话助手已触发，直接返回（不处理 @mentions）
        return;
      }

      // 获取快速对话的目标助手信息（用于注入默认目标）
      const quickChatTargetAgent = chatRoom?.isQuickChatRoom && chatRoom.quickChatAgentId
        ? await agentService.findById(chatRoom.quickChatAgentId)
        : null;

      // ===== 业务助手消息（智能协作模式；手动模式已在上方返回）=====
      if (!message.isHuman && message.agentId !== GROUP_COORDINATOR_ID) {
        const handoff = classifyAssistantHandoff({
          mentionNames,
          selfAgentId: message.agentId,
          agentIdByName: new Map(activeAgents.map((agent) => [agent.name, agent.id])),
        });

        // 无 @（或仅 @自己 / @用户）：按交接协议视为任务完成或交还用户，watchdog 兜底
        if (handoff.kind === 'none') {
          return;
        }

        // 快速对话群没有协调器介入：保留旧行为，仅接力第一个被 @ 的助手
        if (chatRoom?.isQuickChatRoom) {
          const agent = activeAgentByName.get(handoff.names[0]);
          if (agent && agent.isActive) {
            await enqueueAgentTask(chatRoomId, message, agent, quickChatTargetAgent, { bridgeInfo });
          }
          return;
        }

        // 多 @ 歧义：不静默截断，升级协调器裁决（真并行 → 开批次；单一真交接 → 派一个；不明 → ask_owner）
        if (handoff.kind === 'multiple') {
          debugLog('assistantMultiMentionEscalated', {
            chatRoomId,
            messageId: message.id,
            mentionNames: handoff.names,
          });
          await triggerCoordinatorAgentDispatch(chatRoomId, message, 'assistantMultiMention');
          return;
        }

        const agent = activeAgentByName.get(handoff.names[0])!;
        // 成员校验：被 @ 的助手不在群里 → 交协调器纠错，而非静默丢弃（系统级助手跳过成员检查）
        if (agent.agentLevel !== 'system') {
          const isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
          if (!isMember) {
            debugLog('assistantInvalidMentionEscalated', {
              chatRoomId,
              messageId: message.id,
              agentName: agent.name,
              reason: 'notMember',
            });
            await triggerCoordinatorAgentDispatch(chatRoomId, message, 'assistantMentionNotMember');
            return;
          }
        }

        // 协作预算：跳数 / 环路熔断，超限则停止接力并 @群主 说明卡点
        if (message.agentId) {
          const verdict = registerHandoff(chatRoomId, message.agentId, agent.id);
          if (verdict !== 'ok') {
            await notifyCollaborationBudgetExceeded({
              chatRoomId,
              triggerMessage: message,
              verdict,
              sourceAgentName: message.agentName,
              targetAgentName: agent.name,
            });
            return;
          }
        }

        debugLog('assistantHandoffTrigger', {
          chatRoomId,
          agentId: agent.id,
          agentName: agent.name,
          triggerMessageId: message.id,
        });
        await enqueueAgentTask(chatRoomId, message, agent, null, { bridgeInfo });
        return;
      }

      // ===== 用户消息（及内置群调度助手的派发消息）=====
      // 普通群聊：无 @ 发言时的路由优先级：
      // 手动引用(replyMessageId) > 直达回复 > 默认助手 > 群调度助手兜底（仅智能协作模式）。
      // Socket 入口已校验发送者是群聊成员；这里不再限制必须由群主触发，
      // 避免多人群聊或历史 ownerId 漂移时默认助手静默失效。
      if (!hasMentions) {
        // 直达回复：用户这条无 @、且未手动引用的回复，若紧邻的上一条是「助手 @ 了本用户」，
        // 说明用户在回复那个助手的提问/确认，直接派给该助手。
        if (
          isSmartMode &&
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          message.isHuman &&
          !message.replyMessageId
        ) {
          const directReplyAgentId = await findDirectReplyAgentId(
            chatRoomId,
            message,
          );
          if (directReplyAgentId) {
            const agent = await agentService.findById(directReplyAgentId);
            if (agent && agent.isActive) {
              let isMember = true;
              if (agent.agentLevel !== 'system') {
                isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
              }
              if (isMember) {
                debugLog('directReplyTrigger', {
                  chatRoomId,
                  agentId: agent.id,
                  agentName: agent.name,
                  triggerMessageId: message.id,
                });
                await enqueueAgentTask(chatRoomId, message, agent, null, { bridgeInfo });
                return;
              }
            }
          }
        }

        // 引用回复：用户手动引用了某条助手消息 → 触发该助手（优先于默认助手）
        if (
          isSmartMode &&
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          message.isHuman &&
          message.replyMessageId
        ) {
          const replyTargetMessage = await messageService.findById(message.replyMessageId);
          const replyTargetAgentId = replyTargetMessage?.chatRoomId === chatRoomId && !replyTargetMessage.isHuman
            ? replyTargetMessage.agentId
            : null;

          if (replyTargetAgentId) {
            const agent = await agentService.findById(replyTargetAgentId);

            if (agent && agent.isActive) {
              let isMember = true;
              if (agent.agentLevel !== 'system') {
                isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
              }
              if (isMember) {
                debugLog('ownerMentionReplyTrigger', {
                  chatRoomId,
                  agentId: agent.id,
                  agentName: agent.name,
                  triggerMessageId: message.id,
                  replyMessageId: message.replyMessageId,
                });
                await enqueueAgentTask(chatRoomId, message, agent, null, { bridgeInfo });
                return;
              }
              console.log(
                `Reply target agent ${agent.name} is not a member of chatRoom ${chatRoomId}`,
              );
            }
          }
          // 引用目标不可用时落到默认助手 / 群调度助手兜底
        }

        // 默认接收助手
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
            let isMember = true;
            if (agent.agentLevel !== 'system') {
              isMember = await chatRoomService.isAgentMember(chatRoomId, agent.id);
            }
            if (isMember) {
              debugLog('defaultAgentTrigger', {
                chatRoomId,
                agentId: agent.id,
                agentName: agent.name,
                triggerMessageId: message.id,
              });
              await enqueueAgentTask(chatRoomId, message, agent, null, { bridgeInfo });
              return;
            }
            console.log(
              `Default agent ${agent.name} is not a member of chatRoom ${chatRoomId}`,
            );
          }
          // 默认助手不可用时落到群调度助手兜底
        }

        // 智能协作兜底：以上路由全部落空时，交给群调度助手裁决（介入点 ①）。
        // 批次进行中也立即兜底：用户介入已把 join 降级为静默收口（markBatchUserIntervention），
        // 不会与本次裁决重复派发。
        if (
          isSmartMode &&
          chatRoom &&
          !chatRoom.isQuickChatRoom &&
          message.isHuman
        ) {
          await triggerCoordinatorAgentDispatch(chatRoomId, message, 'humanUnroutedMessage');
        }
        return;
      }

      // ===== 显式 @ 触发 =====
      const allowParallel = isSmartMode && !chatRoom?.isQuickChatRoom;

      // 用户多 @：升级协调器裁决并行 / 串行（对称于助手侧 assistantMultiMention）。
      // 由协调器根据用户意图（"按顺序/依次/逐个"→串行，否则并行）决定执行方式与顺序，
      // 不再在 handler 里直接并行扇出。单 @ 仍走下方快路径直接派发，省一次协调器 LLM。
      if (message.isHuman && allowParallel && mentionNames.length > 1) {
        debugLog('humanMultiMentionEscalated', {
          chatRoomId,
          messageId: message.id,
          mentionNames,
        });
        await triggerCoordinatorAgentDispatch(chatRoomId, message, 'humanMultiMention');
        return;
      }

      // 单 @（人类）/ 内置协调器派发消息：直接派发被 @ 的助手。
      // 手动模式 / 快速对话只取第一个；内置协调器派发消息保持全部触发。
      const triggerMentionNames = !message.isHuman
        ? mentionNames
        : mentionNames.slice(0, 1);

      debugLog('mentionsFound', {
        chatRoomId,
        mentionNames,
        triggerMentionNames,
        ignoredMentionNames: mentionNames.filter((name) => !triggerMentionNames.includes(name)),
      });

      const dispatchedAgentIds: string[] = [];
      for (const agentName of triggerMentionNames) {
        // Find agent by name
        const agent = activeAgentByName.get(agentName);
        if (!agent || !agent.isActive) continue;
        if (dispatchedAgentIds.includes(agent.id)) continue;
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

        await enqueueAgentTask(chatRoomId, message, agent, quickChatTargetAgent, { bridgeInfo });
        dispatchedAgentIds.push(agent.id);
      }

      // 并行派发了多个助手时，启动批次追踪，等全部完成后再由协调器汇合裁决
      if (allowParallel && dispatchedAgentIds.length > 1) {
        startParallelBatch(chatRoomId, dispatchedAgentIds);
      }
    },
  );
}
