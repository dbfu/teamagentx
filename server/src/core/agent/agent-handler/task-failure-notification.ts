import type { TaskQueue } from '@prisma/client';
import { agentService } from '../agent.service.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { sendMessageToAgent } from './agent-dispatch.service.js';

/**
 * 任务失败后通知分配者助手
 * 通过 TaskQueue.messageId -> Message.agentId 反查分配者助手
 * 然后调用 sendMessageToAgent 让失败助手发布一条 @分配者助手 的消息
 *
 * 流程：
 * 1. 失败助手（codex1）通过 sendMessageToAgent 发布 @分配者助手 的消息
 * 2. 自动模式下，统一消息处理流程会解析 @ 并触发分配者助手任务入队
 */
export async function notifySourceAgentOnFailure(params: {
  task: TaskQueue;
  errorMessage: string | null;
  executionRecordId: string;
  chatRoomId: string;
}): Promise<void> {
  const { task, errorMessage, executionRecordId, chatRoomId } = params;

  // 1. 通过 task.messageId 获取触发消息
  const triggerMessage = await messageService.findById(task.messageId);

  // 2. 检查是否有分配者助手（agentId 存在且 isHuman=false）
  if (!triggerMessage) {
    console.warn('[notifySourceAgentOnFailure] 触发消息不存在:', task.messageId);
    return;
  }

  // 用户触发的任务（isHuman=true 或无 agentId）跳过通知
  if (triggerMessage.isHuman || !triggerMessage.agentId) {
    return;
  }

  // 3. 获取分配者助手（sourceAgent）信息
  const sourceAgent = await agentService.findById(triggerMessage.agentId);
  if (!sourceAgent) {
    console.warn('[notifySourceAgentOnFailure] 分配者助手不存在:', triggerMessage.agentId);
    return;
  }
  if (!sourceAgent.isActive) {
    console.warn('[notifySourceAgentOnFailure] 分配者助手已禁用:', sourceAgent.name);
    return;
  }

  // 4. 获取失败助手（failedAgent）信息
  const failedAgent = await agentService.findById(task.agentId);
  if (!failedAgent || !failedAgent.isActive) {
    console.warn('[notifySourceAgentOnFailure] 失败助手不存在或已禁用:', task.agentId);
    return;
  }

  // 5. 检查分配者助手是否仍在群聊中（system 级助手不需要检查）
  const isSourceInRoom = sourceAgent.agentLevel === 'system'
    || await chatRoomService.isAgentMember(chatRoomId, sourceAgent.id);

  if (!isSourceInRoom) {
    console.warn('[notifySourceAgentOnFailure] 分配者助手不在群聊中:', sourceAgent.name);
    return;
  }

  // 6. 检查群聊触发模式（手动模式下助手不能自动触发其他助手，失败通知也跳过）
  const chatRoom = await chatRoomService.findById(chatRoomId);
  if (chatRoom?.agentTriggerMode === 'manual') {
    console.warn('[notifySourceAgentOnFailure] 群聊为手动模式，跳过自动通知');
    return;
  }

  // 7. 构建通知消息内容（包含 @分配者助手）
  const notificationContent = buildFailureNotificationMessage({
    sourceAgentName: sourceAgent.name,
    failedAgentName: task.agentName,
    taskContent: task.messageContent,
    errorMessage,
    executionRecordId,
  });

  // 8. 调用 sendMessageToAgent，以失败助手的名义发布消息给分配者助手
  // sendMessageToAgent 只创建并广播消息，任务触发由统一消息处理流程完成
  try {
    await sendMessageToAgent({
      chatRoomId,
      sourceAgentId: failedAgent.id, // 以失败助手的名义发送
      targetAgentId: sourceAgent.id, // 发给分配者助手
      content: notificationContent,
    });

    console.log(`[notifySourceAgentOnFailure] ${failedAgent.name} 已通知 ${sourceAgent.name}: 任务执行失败`);
  } catch (error) {
    console.error('[notifySourceAgentOnFailure] 发送失败通知时出错:', error);
  }
}

/**
 * 构建失败通知消息内容
 */
function buildFailureNotificationMessage(params: {
  sourceAgentName: string;
  failedAgentName: string;
  taskContent: string;
  errorMessage: string | null;
  executionRecordId: string;
}): string {
  const { sourceAgentName, failedAgentName, taskContent, errorMessage, executionRecordId } = params;

  // 截断任务内容（最多100字符）
  const truncatedTaskContent = taskContent.length > 100
    ? taskContent.slice(0, 100) + '...'
    : taskContent;

  // 截断错误信息（最多200字符）
  const truncatedError = errorMessage && errorMessage.length > 200
    ? errorMessage.slice(0, 200) + '...'
    : errorMessage;

  // 消息开头 @分配者助手（sendMessageToAgent 会自动添加 @目标助手，这里不重复）
  return `任务执行失败通知\n\n` +
    `**执行助手**: ${failedAgentName}\n` +
    `**任务内容**: ${truncatedTaskContent}\n` +
    `**失败原因**: ${truncatedError || '未知错误'}\n` +
    `**执行记录 ID**: ${executionRecordId}\n\n` +
    `请检查任务内容或考虑重新分配任务。`;
}
