import type { IAgentExecutor, ToolCall } from '../executor.interface.js';

// Agent executor cache - keyed by chatRoomId_agentName for memory isolation
export const executorCache = new Map<string, IAgentExecutor>();

// Processing state - track which queues are currently being processed
export const processingMap = new Map<string, boolean>();

// Abort controllers - track running executions for cancellation
export const abortControllers = new Map<string, AbortController>();

// Executions cleared by context/message cleanup should not write final records.
export const discardExecutionResultKeys = new Set<string>();

// Running task start times - keyed by TaskQueue.id. Used to restore elapsed time after room switches.
export const taskExecutionStartedAt = new Map<string, number>();

// 流式事件缓存 - 用于刷新页面后恢复数据
interface CachedStreamEvent {
  id: string;
  type: 'thinking' | 'tool_call' | 'output';
  content?: string;
  toolCall?: ToolCall;
  status?: 'in_progress' | 'completed' | 'error';
  timestamp: number;
  endTime?: number;
}

// 缓存每个 agent 的流式事件（按 messageId_agentId 存储）
export const streamEventsCache = new Map<string, CachedStreamEvent[]>();

export function clearExecutorCacheEntries(agentName?: string, chatRoomId?: string): number {
  if (!agentName && chatRoomId) {
    let clearedCount = 0;
    for (const key of executorCache.keys()) {
      if (key.startsWith(`${chatRoomId}_`)) {
        executorCache.delete(key);
        clearedCount++;
        console.log(`[clearExecutorCache] 已删除缓存: ${key}`);
      }
    }
    return clearedCount;
  }

  if (!agentName) {
    const count = executorCache.size;
    executorCache.clear();
    return count;
  }

  let clearedCount = 0;
  for (const key of executorCache.keys()) {
    const matchesAgent = key.includes(`_${agentName}`);
    const matchesChatRoom = !chatRoomId || key.startsWith(`${chatRoomId}_`);

    if (matchesAgent && matchesChatRoom) {
      executorCache.delete(key);
      clearedCount++;
      console.log(`[clearExecutorCache] 已删除缓存: ${key}`);
    }
  }

  return clearedCount;
}

// 获取缓存的流式事件
export function getCachedStreamEvents(chatRoomId: string, messageId: string, agentId: string): CachedStreamEvent[] {
  const key = `${chatRoomId}_${messageId}_${agentId}`;
  return streamEventsCache.get(key) || [];
}

// 清除缓存的流式事件
export function clearCachedStreamEvents(chatRoomId: string, messageId: string, agentId: string): void {
  const key = `${chatRoomId}_${messageId}_${agentId}`;
  streamEventsCache.delete(key);
}

// Stop agent execution
export function stopAgentExecution(chatRoomId: string, agentId: string): boolean {
  const key = `${chatRoomId}_${agentId}`;
  const controller = abortControllers.get(key);

  if (controller) {
    console.log(`[stopAgentExecution] 中止执行: ${key}`);
    controller.abort();
    abortControllers.delete(key);
    return true;
  }

  console.log(`[stopAgentExecution] 未找到执行中的任务: ${key}`);
  return false;
}

// 清理所有执行状态（启动时调用）
export function clearAllExecutionState(): void {
  // 清理内存中的状态
  executorCache.clear();
  processingMap.clear();
  abortControllers.clear();
  discardExecutionResultKeys.clear();
  taskExecutionStartedAt.clear();
  streamEventsCache.clear();

  console.log('[AgentHandler] 已清理所有执行状态');
}

// Get cache key for chatRoom-scoped agent
export function getCacheKey(chatRoomId: string, agentName: string): string {
  return `${chatRoomId}_${agentName}`;
}
