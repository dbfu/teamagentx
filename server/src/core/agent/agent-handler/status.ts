import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { processingMap, executorCache } from './cache.js';

// Agent status type
export type AgentStatus = 'idle' | 'executing' | 'busy';

// Global emit callbacks (set by setupAIHandlers)
export let globalEmit: ((msg: any, chatRoomId: string) => Promise<void> | void) | null = null;
export let globalEmitTyping:
  | ((
      data: {messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing'},
      chatRoomId: string,
    ) => void)
  | null = null;
export let globalEmitDone:
  | ((data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number; cacheReadTokens?: number}, chatRoomId: string) => void)
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

// 广播任务队列更新的回调
export let globalBroadcastTaskQueue:
  | ((chatRoomId: string, agentId: string, tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => void)
  | null = null;

// 广播待办创建的回调
export let globalEmitTodoCreated:
  | ((todo: {
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
    }, ownerUserId: string) => void)
  | null = null;

// 设置全局回调
export function setGlobalCallbacks(callbacks: {
  emit: (msg: any, chatRoomId: string) => Promise<void> | void;
  emitTyping: (data: {messageId: string; agentId: string; agentName: string; status?: 'pending' | 'executing'}, chatRoomId: string) => void;
  emitDone: (data: {agentId: string; agentName: string; triggerMessageId: string; executionRecordId?: string; messageIds?: string[]; duration?: number; totalTokens?: number; cacheReadTokens?: number}, chatRoomId: string) => void;
  emitStream: (data: { messageId: string; agentId: string; agentName: string; content: string }, chatRoomId: string) => void;
  emitToolCall: (data: { messageId: string; agentId: string; agentName: string; toolCall: any }, chatRoomId: string) => void;
  emitThinking: (data: { messageId: string; agentId: string; agentName: string; thinking: string }, chatRoomId: string) => void;
  emitStatus: (data: { chatRoomId: string; statuses: Record<string, AgentStatus>; queueCounts?: Record<string, number> }, chatRoomId2: string) => void;
  broadcastTaskQueue: (chatRoomId: string, agentId: string, tasks: { id: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => void;
  emitTodoCreated: (todo: any, ownerUserId: string) => void;
}) {
  globalEmit = callbacks.emit;
  globalEmitTyping = callbacks.emitTyping;
  globalEmitDone = callbacks.emitDone;
  globalEmitStream = callbacks.emitStream;
  globalEmitToolCall = callbacks.emitToolCall;
  globalEmitThinking = callbacks.emitThinking;
  globalEmitStatus = callbacks.emitStatus;
  globalBroadcastTaskQueue = callbacks.broadcastTaskQueue;
  globalEmitTodoCreated = callbacks.emitTodoCreated;
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
export async function getAgentStatuses(chatRoomId: string): Promise<Map<string, AgentStatus>> {
  const statuses = new Map<string, AgentStatus>();

  // Get all agents in this chatRoom
  const chatRoomAgents = await chatRoomService.getAgents(chatRoomId);

  for (const cra of chatRoomAgents) {
    if (cra.agent) {
      const status = await getAgentStatus(chatRoomId, cra.agent.id);
      statuses.set(cra.agent.id, status);
    }
  }

  return statuses;
}

// Broadcast agent status changes to the chatRoom
export async function broadcastAgentStatus(chatRoomId: string) {
  if (globalEmitStatus) {
    const statuses = await getAgentStatuses(chatRoomId);
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
