import { randomUUID } from 'crypto';
import type { Agent } from '@prisma/client';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { roomMessageIndexService } from '../../../modules/message/room-message-index.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import type { AttachmentData } from '../../../modules/task-queue/task-queue.service.js';
import type { TaskQueue } from '@prisma/client';
import { agentService } from '../agent.service.js';
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import type { Message } from '../../../types/message.js';
import { getExecutor } from './executor-manager.js';
import { processQueue } from './processor.js';
import { broadcastAgentStatus, globalEmit, globalEmitTyping } from './status.js';
import { debugLog } from './debug.js';
import { bridgeInfoCache, type BridgeInfo } from './cache.js';

export async function enqueueAgentTask(
  chatRoomId: string,
  message: Message,
  agent: Agent,
  quickChatTargetAgent?: Agent | null,
  options?: {
    history?: any[];
    sessionDir?: string;
    attachments?: AttachmentData[];
    skipHistory?: boolean;
    bridgeInfo?: BridgeInfo;
    // 构建群历史时的上界消息（默认用 message.id）。串行链后续步骤的触发消息锚定在
    // 汇总调度消息上，但历史边界需推进到「上一个助手的回复」，故单独传入。
    historyAnchorMessageId?: string;
    // 历史上界是否包含 historyAnchorMessageId 本身（串行链需含上一个助手回复，置 true）。
    historyInclusive?: boolean;
    /** 任务落库后、启动队列处理前调用，用于绑定需要精确 taskId 的调度状态。 */
    onTaskEnqueued?: (task: TaskQueue) => void;
    /** 任务绑定后若后续准备失败，用于回滚调用方状态。 */
    onTaskEnqueueFailed?: (task: TaskQueue) => void;
  },
) {
  if (globalEmitTyping) {
    globalEmitTyping(
      {messageId: message.id, agentId: agent.id, agentName: agent.name, status: 'pending'},
      chatRoomId,
    );
  }

  const chatRoomAgent = await chatRoomService.getAgentMember(
    chatRoomId,
    agent.id,
  );
  const injectGroupHistory = chatRoomAgent?.injectGroupHistory ?? false;
  const executor = await getExecutor(chatRoomId, agent.name);

  let history = options?.history;
  if (!options?.skipHistory && history === undefined && injectGroupHistory && executor) {
    history = await roomMessageIndexService.buildMessageIndex(
      chatRoomId,
      options?.historyAnchorMessageId ?? message.id,
      executor.lastInjectedMessageId,
      { inclusive: options?.historyInclusive },
    );
    console.log(`${agent.name}: 构建群消息索引 ${history.length} 条`);
  }

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

  const attachmentsData = options?.attachments ?? message.attachments?.map(att => ({
    url: att.url,
    filename: att.filename,
    mimeType: att.mimeType,
    base64: att.base64 || '',
  }))?.filter(att => att.base64);

  let processedMessageContent = message.content;
  if (agent.id === GROUP_ASSISTANT_ID && quickChatTargetAgent) {
    processedMessageContent = `[默认目标助手: ${quickChatTargetAgent.name} (ID: ${quickChatTargetAgent.id})]\n${message.content}`;
    console.log(`[agent.dispatch] 群助手在快速对话中被调用，注入默认目标: ${quickChatTargetAgent.name}`);
  }

  const task = await taskQueueService.enqueue({
    chatRoomId,
    agentId: agent.id,
    agentName: agent.name,
    messageId: message.id,
    messageContent: processedMessageContent,
    history,
    sessionDir: options?.sessionDir,
    attachments: attachmentsData,
  });
  let taskBindingApplied = false;

  try {
    options?.onTaskEnqueued?.(task);
    taskBindingApplied = true;

    // 存储 Bridge 信息到缓存，用于执行时注入到提示词
    if (options?.bridgeInfo) {
      bridgeInfoCache.set(task.id, options.bridgeInfo);
      debugLog('bridgeInfoCached', {
        taskId: task.id,
        platform: options.bridgeInfo.platform,
        externalId: options.bridgeInfo.externalId,
      });
    }

    if (!options?.skipHistory && injectGroupHistory && executor && agent.agentLevel !== 'system') {
      const latestMessages = await messageService.findByChatRoomId(
        chatRoomId,
        {take: 1, order: 'desc'},
      );
      if (latestMessages.length > 0) {
        const newLastInjectedId = latestMessages[0].id;
        executor.setLastInjectedMessageId(newLastInjectedId);
        await chatRoomService.updateLastInjectedMessageId(chatRoomId, agent.id, newLastInjectedId);
        console.log(`${agent.name}: 更新上次注入位置为 ${newLastInjectedId}`);
      }
    }

    await broadcastAgentStatus(chatRoomId);
    processQueue(chatRoomId, agent.id);
    return task;
  } catch (error) {
    bridgeInfoCache.delete(task.id);
    await taskQueueService.delete(task.id).catch(() => undefined);
    if (taskBindingApplied) {
      options?.onTaskEnqueueFailed?.(task);
    }
    throw error;
  }
}

export async function sendMessageToAgent(params: {
  chatRoomId: string;
  sourceAgentId: string;
  targetAgentId?: string;
  targetAgentName?: string;
  content: string;
}) {
  const content = params.content.trim();
  if (!content) {
    throw new Error('消息内容不能为空');
  }
  if (!params.targetAgentId && !params.targetAgentName) {
    throw new Error('必须指定目标助手');
  }

  const chatRoom = await chatRoomService.findById(params.chatRoomId);
  if (!chatRoom) {
    throw new Error('群聊不存在');
  }
  const sourceAgent = await agentService.findById(params.sourceAgentId);
  if (!sourceAgent || !sourceAgent.isActive) {
    throw new Error('来源助手不存在或未启用');
  }
  // 手动模式下，只有内置群调度助手可以派发其他助手；
  // 智能协作模式允许助手互相派发（消息进入统一处理流程后走快路径，受协作预算约束）。
  if (
    chatRoom.agentTriggerMode === 'manual' &&
    sourceAgent.id !== GROUP_COORDINATOR_ID
  ) {
    throw new Error('当前群聊为手动模式，只有群调度助手可以派发其他助手');
  }
  if (sourceAgent.agentLevel !== 'system') {
    const isSourceMember = await chatRoomService.isAgentMember(params.chatRoomId, sourceAgent.id);
    if (!isSourceMember) {
      throw new Error(`来源助手 ${sourceAgent.name} 不在当前群聊中`);
    }
  }

  const targetAgent = params.targetAgentId
    ? await agentService.findById(params.targetAgentId)
    : await agentService.findByName(params.targetAgentName!);
  if (!targetAgent || !targetAgent.isActive) {
    throw new Error('目标助手不存在或未启用');
  }
  if (targetAgent.id === sourceAgent.id) {
    throw new Error('不能向自己发送助手任务');
  }

  if (targetAgent.agentLevel !== 'system') {
    const isMember = await chatRoomService.isAgentMember(params.chatRoomId, targetAgent.id);
    if (!isMember) {
      throw new Error(`目标助手 ${targetAgent.name} 不在当前群聊中`);
    }
  }

  const displayContent = `@${targetAgent.name} ${content}`;
  const messageId = randomUUID();
  const now = new Date();

  await messageService.create({
    id: messageId,
    type: 'MESSAGE',
    content: displayContent,
    time: now,
    agentId: sourceAgent.id,
    chatRoomId: params.chatRoomId,
    replyMessageId: null,
    isHuman: false,
  });

  const message: Message = {
    id: messageId,
    type: 'message',
    content: displayContent,
    time: now,
    user: sourceAgent.name,
    agentId: sourceAgent.id,
    agentName: sourceAgent.name,
    avatar: sourceAgent.avatar,
    avatarColor: sourceAgent.avatarColor,
    chatRoomId: params.chatRoomId,
    replyMessageId: null,
    isHuman: false,
  };

  if (globalEmit) {
    await globalEmit(message, params.chatRoomId);
  }

  debugLog('agentToolSendMessage', {
    chatRoomId: params.chatRoomId,
    sourceAgentId: sourceAgent.id,
    sourceAgentName: sourceAgent.name,
    targetAgentId: targetAgent.id,
    targetAgentName: targetAgent.name,
    messageId,
    dispatchMode: 'messageEvent',
  });

  return {
    messageId,
    targetAgentId: targetAgent.id,
    targetAgentName: targetAgent.name,
    content: displayContent,
  };
}
