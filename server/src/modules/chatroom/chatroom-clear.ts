import prisma from '../../lib/prisma.js';
import { messageService } from '../message/message.service.js';
import { agentMemoryService } from '../agent-memory/agent-memory.service.js';
import { checkpointService } from '../checkpoint/checkpoint.service.js';
import { taskQueueService } from '../task-queue/task-queue.service.js';
import { executionRecordService } from '../execution-record/execution-record.service.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import {
  clearExecutorCache,
  executorCache,
  clearClaudeSdkFileSystemContext,
  clearCodexSdkFileSystemContext,
} from '../../core/agent/agent-handler/index.js';

export interface ClearChatRoomResult {
  affectedAgentIds: string[];
  affectedUserIds: string[];
}

export async function clearChatRoom(chatRoomId: string): Promise<ClearChatRoomResult> {
  const affectedAgentIds = new Set<string>();

  // 收集已有 board task 的 agent
  const existingBoardTasks = await taskQueueService.getChatRoomBoardTasks(chatRoomId);
  existingBoardTasks.forEach(task => affectedAgentIds.add(task.agentId));

  // 删除 task queue
  await taskQueueService.deleteByChatRoomId(chatRoomId);

  // 删除遗留 todo 数据。todo runtime 已移除，这里直接用 Prisma 避免恢复 todo service。
  const affectedTodos = await prisma.todo.findMany({
    where: { chatRoomId },
    select: { ownerUserId: true },
  });
  const affectedUserIds = [...new Set(
    affectedTodos.map(t => t.ownerUserId).filter((id): id is string => id !== null),
  )];
  await prisma.todo.deleteMany({ where: { chatRoomId } });

  // 删除执行记录
  await executionRecordService.deleteByChatRoomId(chatRoomId);

  // 清空每个助手的上下文
  const chatRoomAgents = await prisma.chatRoomAgent.findMany({
    where: { chatRoomId },
    include: { agent: { select: { id: true, name: true, type: true, acpTool: true } } },
  });

  for (const cra of chatRoomAgents) {
    if (!cra.agent) continue;
    affectedAgentIds.add(cra.agent.id);

    await agentMemoryService.clear(chatRoomId, cra.agent.id);

    if (cra.agent.type === 'builtin') {
      await checkpointService.clearChatRoomAgentContext(chatRoomId, cra.agent.name);
    } else if (cra.agent.type === 'acp') {
      for (const [cacheKey, executor] of executorCache.entries()) {
        if (cacheKey.startsWith(`${chatRoomId}_`) && cacheKey.includes(`_${cra.agent.name}`)) {
          await executor.cleanup?.().catch(() => {});
        }
      }
      if (cra.agent.acpTool === 'codex') {
        clearCodexSdkFileSystemContext(cra.agent.id, chatRoomId);
      } else {
        clearClaudeSdkFileSystemContext(cra.agent.id, chatRoomId);
      }
    }

    clearExecutorCache(cra.agent.name, chatRoomId);
    await chatRoomService.updateLastInjectedMessageId(chatRoomId, cra.agent.id, null);
  }

  // 删除消息
  await messageService.deleteByChatRoomId(chatRoomId);

  return { affectedAgentIds: [...affectedAgentIds], affectedUserIds };
}
