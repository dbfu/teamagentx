import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { processingMap, executorCache } from './cache.js';

// Agent status type
export type AgentStatus = 'idle' | 'executing' | 'busy';

// Global emit callbacks (set by setupAIHandlers)
export let globalEmit: ((msg: any, chatRoomId: string) => Promise<void> | void) | null = null;
export let globalBroadcastMessage:
  | ((msg: any, chatRoomId: string) => Promise<void> | void)
  | null = null;
export let globalEmitTyping:
  | ((
      data: {messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing'; startedAt?: number},
      chatRoomId: string,
    ) => void)
  | null = null;
export let globalEmitDone:
  | ((data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number; cacheReadTokens?: number; model?: string}, chatRoomId: string) => void)
  | null = null;
export let globalEmitStream:
  | ((data: { messageId: string; agentId: string; agentName: string; content: string }, chatRoomId: string) => void)
  | null = null;
export let globalEmitToolCall:
  | ((data: { messageId: string; agentId: string; agentName: string; toolCall: any }, chatRoomId: string) => void)
  | null = null;
export let globalEmitThinking:
  | ((data: { messageId: string; agentId: string; agentName: string; thinking: string }, chatRoomId: string) => void)
  | null = null;
export let globalEmitStatus:
  | ((data: { chatRoomId: string; statuses: Record<string, AgentStatus>; queueCounts?: Record<string, number> }, chatRoomId2: string) => void)
  | null = null;
export let globalEmitTodoCreated:
  | ((todo: any, userId: string) => void)
  | null = null;

// 广播群聊创建的回调
export let globalEmitChatRoomCreated:
  | ((chatRoom: any) => void)
  | null = null;

// 广播群聊助手列表更新的回调
export let globalEmitAgentsUpdated:
  | ((chatRoomId: string) => void)
  | null = null;

// 广播群聊信息更新（如群规则、调度规则等）的回调
export let globalEmitChatRoomUpdated:
  | ((chatRoomId: string) => void)
  | null = null;

// 广播任务队列更新的回调
export let globalBroadcastTaskQueue:
  | ((chatRoomId: string, agentId: string, tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => void)
  | null = null;

// 触发 agent 消息处理的回调（避免 message-utils ↔ handler 循环依赖）
export let globalEmitReceivedMessage:
  | ((message: any, chatRoomId: string) => void)
  | null = null;

export function setGlobalEmitReceivedMessage(fn: (message: any, chatRoomId: string) => void) {
  globalEmitReceivedMessage = fn;
}

// 工作台任务状态更新的回调（推送给任务创建者 user:<userId>，实现前端实时刷新）
export let globalEmitWorkbenchTaskUpdated:
  | ((task: any, userId: string) => void)
  | null = null;

export function setGlobalEmitWorkbenchTaskUpdated(fn: (task: any, userId: string) => void) {
  globalEmitWorkbenchTaskUpdated = fn;
}

export function setGlobalBroadcastMessage(
  fn: ((message: any, chatRoomId: string) => Promise<void> | void) | null,
) {
  globalBroadcastMessage = fn;
}

// 设置全局回调
export function setGlobalCallbacks(callbacks: {
  emit: (msg: any, chatRoomId: string) => Promise<void> | void;
  emitTyping: (data: {messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing'; startedAt?: number}, chatRoomId: string) => void;
  emitDone: (data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number; cacheReadTokens?: number; model?: string}, chatRoomId: string) => void;
  emitStream: (data: { messageId: string; agentId: string; agentName: string; content: string }, chatRoomId: string) => void;
  emitToolCall: (data: { messageId: string; agentId: string; agentName: string; toolCall: any }, chatRoomId: string) => void;
  emitThinking: (data: { messageId: string; agentId: string; agentName: string; thinking: string }, chatRoomId: string) => void;
  emitStatus: (data: { chatRoomId: string; statuses: Record<string, AgentStatus>; queueCounts?: Record<string, number> }, chatRoomId2: string) => void;
  emitTodoCreated: (todo: any, userId: string) => void;
  broadcastTaskQueue: (chatRoomId: string, agentId: string, tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => void;
  emitChatRoomCreated: (chatRoom: any) => void;
  emitAgentsUpdated: (chatRoomId: string) => void;
  emitChatRoomUpdated?: (chatRoomId: string) => void;
}) {
  globalEmit = callbacks.emit;
  globalEmitTyping = callbacks.emitTyping;
  globalEmitDone = callbacks.emitDone;
  globalEmitStream = callbacks.emitStream;
  globalEmitToolCall = callbacks.emitToolCall;
  globalEmitThinking = callbacks.emitThinking;
  globalEmitStatus = callbacks.emitStatus;
  globalEmitTodoCreated = callbacks.emitTodoCreated;
  globalBroadcastTaskQueue = callbacks.broadcastTaskQueue;
  globalEmitChatRoomCreated = callbacks.emitChatRoomCreated;
  globalEmitAgentsUpdated = callbacks.emitAgentsUpdated;
  globalEmitChatRoomUpdated = callbacks.emitChatRoomUpdated ?? null;
}

// Get agent status for a specific chatRoom-agent combination
export async function getAgentStatus(
  chatRoomId: string,
  agentId: string,
): Promise<AgentStatus> {
  const key = `${chatRoomId}_${agentId}`;
  const isProcessing = processingMap.get(key) ?? false;
  const queueLength = await taskQueueService.getQueueLength(chatRoomId, agentId);

  if (isProcessing) {
    return queueLength >= 3 ? 'busy' : 'executing';
  }
  return queueLength >= 3 ? 'busy' : 'idle';
}

// Get all agent statuses for a chatRoom
export async function getAgentStatuses(chatRoomId: string, extraAgentIds: string[] = []): Promise<Map<string, AgentStatus>> {
  const statuses = new Map<string, AgentStatus>();

  // Get all visible/member agents in this chatRoom.
  const [chatRoomAgents, activeTasks] = await Promise.all([
    chatRoomService.getAgents(chatRoomId),
    taskQueueService.getActiveTasks(chatRoomId),
  ]);

  for (const cra of chatRoomAgents) {
    if (cra.agent) {
      const status = await getAgentStatus(chatRoomId, cra.agent.id);
      statuses.set(cra.agent.id, status);
    }
  }

  // Hidden system agents, such as the internal coordinator, are not room members.
  // Include them while they have active queue items so stop/resume UI can target them.
  for (const task of activeTasks) {
    if (!statuses.has(task.agentId)) {
      const status = await getAgentStatus(chatRoomId, task.agentId);
      statuses.set(task.agentId, status);
    }
  }

  for (const agentId of extraAgentIds) {
    if (!agentId || statuses.has(agentId)) continue;
    const status = await getAgentStatus(chatRoomId, agentId);
    statuses.set(agentId, status);
  }

  return statuses;
}

// Broadcast agent status changes to the chatRoom
export async function broadcastAgentStatus(chatRoomId: string, extraAgentIds: string[] = []) {
  if (globalEmitStatus) {
    const statuses = await getAgentStatuses(chatRoomId, extraAgentIds);
    const statusObj: Record<string, AgentStatus> = {};
    const queueCounts: Record<string, number> = {};
    for (const [agentId, status] of statuses) {
      statusObj[agentId] = status;
      // 获取队列数量
      queueCounts[agentId] = await taskQueueService.getQueueLength(chatRoomId, agentId);
    }
    globalEmitStatus({ chatRoomId, statuses: statusObj, queueCounts }, chatRoomId);
  }
}

// Broadcast task queue update to the chatRoom
export function broadcastAgentTaskQueue(
  chatRoomId: string,
  agentId: string,
  tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[],
) {
  if (globalBroadcastTaskQueue) {
    globalBroadcastTaskQueue(chatRoomId, agentId, tasks);
  }
}

export function broadcastChatRoomCreated(chatRoom: any) {
  if (globalEmitChatRoomCreated) {
    globalEmitChatRoomCreated(chatRoom);
  }
}

export function broadcastAgentsUpdated(chatRoomId: string) {
  if (globalEmitAgentsUpdated) {
    globalEmitAgentsUpdated(chatRoomId);
  }
}

export function broadcastChatRoomUpdated(chatRoomId: string) {
  if (globalEmitChatRoomUpdated) {
    globalEmitChatRoomUpdated(chatRoomId);
  }
}
