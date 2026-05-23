import { agentMemoryService } from '../../../modules/agent-memory/agent-memory.service.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { executionRecordService } from '../../../modules/execution-record/execution-record.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import {
  INTERNAL_COORDINATOR_AGENT_NAME,
  INTERNAL_COORDINATOR_EXECUTOR_AGENT_ID,
} from '../internal-coordinator-agent.js';
import { GROUP_ASSISTANT_ID } from '../system-assistant.constants.js';
import { clearClaudeSdkFileSystemContext } from '../claude-sdk.executor.js';
import {
  abortControllers,
  clearExecutorCacheEntries,
  discardExecutionResultKeys,
  executorCache,
  processingMap,
} from './cache.js';

const INTERNAL_COORDINATOR_AGENT_IDS = [
  GROUP_ASSISTANT_ID,
  INTERNAL_COORDINATOR_EXECUTOR_AGENT_ID,
];

interface ClearInternalCoordinatorContextOptions {
  abortRunning?: boolean;
  deleteTasksAndExecutions?: boolean;
}

export async function clearInternalCoordinatorContext(
  chatRoomId: string,
  options: ClearInternalCoordinatorContextOptions = {},
): Promise<void> {
  const abortRunning = options.abortRunning ?? true;
  const deleteTasksAndExecutions = options.deleteTasksAndExecutions ?? true;

  for (const agentId of INTERNAL_COORDINATOR_AGENT_IDS) {
    await agentMemoryService.clear(chatRoomId, agentId);

    const executionKey = `${chatRoomId}_${agentId}`;
    if (abortRunning) {
      const abortController = abortControllers.get(executionKey);
      if (abortController) {
        discardExecutionResultKeys.add(executionKey);
        abortController.abort();
        abortControllers.delete(executionKey);
      } else {
        discardExecutionResultKeys.delete(executionKey);
      }
      processingMap.delete(executionKey);
    }

    if (deleteTasksAndExecutions) {
      await Promise.all([
        taskQueueService.deleteByChatRoomAndAgent(chatRoomId, agentId),
        executionRecordService.deleteByChatRoomAndAgent(chatRoomId, agentId),
      ]);
    }
  }

  for (const [cacheKey, executor] of executorCache.entries()) {
    if (
      cacheKey.startsWith(`${chatRoomId}_`) &&
      cacheKey.includes(`_${INTERNAL_COORDINATOR_AGENT_NAME}`)
    ) {
      try {
        await executor.cleanup?.();
      } catch (error) {
        console.warn(`[ClearCoordinatorContext] 清理群调度助手 executor 失败: ${cacheKey}`, error);
      }
    }
  }

  clearExecutorCacheEntries(INTERNAL_COORDINATOR_AGENT_NAME, chatRoomId);
  const chatRoom = await chatRoomService.findById(chatRoomId);
  const chatRoomWorkDir = chatRoom?.workDir?.trim() || undefined;
  clearClaudeSdkFileSystemContext(INTERNAL_COORDINATOR_EXECUTOR_AGENT_ID, chatRoomId, chatRoomWorkDir);
  clearClaudeSdkFileSystemContext(GROUP_ASSISTANT_ID, chatRoomId, chatRoomWorkDir);
}
