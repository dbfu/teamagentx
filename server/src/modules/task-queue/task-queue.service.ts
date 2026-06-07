import prisma from '../../lib/prisma.js';
import type { TaskQueue } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface HistoryMessage {
  content: string;
  senderName: string;
  isHuman: boolean;
  kind?: 'message' | 'memory_summary' | 'message_index';
  messageId?: string;
  time?: string;
  senderType?: 'user' | 'agent';
  preview?: string;
  attachments?: Array<{filename?: string | null; type?: string | null}>;
}

// 附件数据（用于传递给 LLM）
export interface AttachmentData {
  url: string;
  filename: string;
  mimeType: string;
  base64: string;  // 图片的 base64 数据
}

export interface TaskQueueData {
  chatRoomId: string;
  agentId: string;
  agentName: string;
  messageId: string;
  messageContent: string;
  history?: HistoryMessage[];
  sessionDir?: string;  // 显式运行目录；快速对话未指定时留空，执行器使用群默认目录
  attachments?: AttachmentData[];  // 附件数据
}

export const taskQueueService = {
  async enqueue(data: TaskQueueData): Promise<TaskQueue> {
    return prisma.taskQueue.create({
      data: {
        id: randomUUID(),
        chatRoomId: data.chatRoomId,
        agentId: data.agentId,
        agentName: data.agentName,
        messageId: data.messageId,
        messageContent: data.messageContent,
        history: data.history ? JSON.stringify(data.history) : null,
        sessionDir: data.sessionDir,
        attachments: data.attachments ? JSON.stringify(data.attachments) : null,
        status: 'pending',  // 新任务默认为 pending 状态
      },
    });
  },

  // 根据 ID 获取单个任务
  async getById(id: string): Promise<TaskQueue | null> {
    return prisma.taskQueue.findUnique({
      where: { id },
    });
  },

  // 更新任务状态
  async updateStatus(id: string, status: string): Promise<TaskQueue | null> {
    try {
      return await prisma.taskQueue.update({
        where: { id },
        data: { status },
      });
    } catch (error: any) {
      // 记录不存在时返回 null
      if (error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  },

  // 获取队列中第一个 pending 状态的任务
  async peek(chatRoomId: string, agentId: string): Promise<TaskQueue | null> {
    return prisma.taskQueue.findFirst({
      where: { chatRoomId, agentId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  },

  async delete(id: string): Promise<void> {
    try {
      await prisma.taskQueue.delete({
        where: { id },
      });
    } catch (error: any) {
      // 忽略记录不存在的错误（可能是启动时清理或其他进程已删除）
      if (error.code !== 'P2025') {
        throw error;
      }
    }
  },

  async getQueueLength(chatRoomId: string, agentId: string): Promise<number> {
    return prisma.taskQueue.count({
      where: { chatRoomId, agentId, status: 'pending' },
    });
  },

  // 获取非活跃任务（interrupted + cancelled - 异常状态，需恢复）
  async getInactiveTasks(chatRoomId: string): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: {
        chatRoomId,
        status: { in: ['interrupted', 'cancelled'] }
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  // 获取群聊中所有正在执行的任务（用于恢复 typing 状态）
  async getActiveTasks(chatRoomId: string): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: { chatRoomId, status: { in: ['pending', 'executing'] } },
      orderBy: { createdAt: 'asc' },
    });
  },

  // 获取群聊任务看板中的队列任务
  async getChatRoomBoardTasks(chatRoomId: string): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: { chatRoomId, status: { in: ['pending', 'executing', 'cancelled', 'interrupted'] } },
      orderBy: { createdAt: 'asc' },
    });
  },

  // 批量标记 executing 状态的任务为 interrupted（服务启动时调用）
  async markAsInterrupted(): Promise<number> {
    const result = await prisma.taskQueue.updateMany({
      where: { status: 'executing' },
      data: { status: 'interrupted' },
    });
    return result.count;
  },

  // 批量标记 pending 状态的任务为 interrupted（服务启动时调用）
  async markPendingAsInterrupted(): Promise<number> {
    const result = await prisma.taskQueue.updateMany({
      where: { status: 'pending' },
      data: { status: 'interrupted' },
    });
    return result.count;
  },

  // 恢复任务执行（将 interrupted/cancelled 状态改为 pending）
  async resumeTask(id: string): Promise<TaskQueue | null> {
    const task = await this.getById(id);
    if (!task) return null;
    if (task.status !== 'interrupted' && task.status !== 'cancelled') {
      return null;  // 只能恢复 interrupted 或 cancelled 状态的任务
    }
    return this.updateStatus(id, 'pending');
  },

  // 获取群聊中某个助手的任务队列（用于前端显示，只包含 pending - 正常排队）
  async getAgentQueue(chatRoomId: string, agentId: string): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: { chatRoomId, agentId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  },

  // 获取群聊中某个助手的所有任务（包括非活跃状态）
  async getAgentQueueAll(chatRoomId: string, agentId: string): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: { chatRoomId, agentId },
      orderBy: { createdAt: 'asc' },
    });
  },

  async getAllPending(): Promise<TaskQueue[]> {
    return prisma.taskQueue.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  },

  async deleteByChatRoomId(chatRoomId: string): Promise<void> {
    await prisma.taskQueue.deleteMany({
      where: { chatRoomId },
    });
  },

  async deleteByChatRoomAndAgent(chatRoomId: string, agentId: string): Promise<{ count: number }> {
    return prisma.taskQueue.deleteMany({
      where: { chatRoomId, agentId },
    });
  },

  async clearAll(): Promise<void> {
    await prisma.taskQueue.deleteMany();
  },

  // 获取 pending 状态任务数量
  async getPendingCount(): Promise<number> {
    return prisma.taskQueue.count({
      where: { status: 'pending' },
    });
  },

  // 清理所有 pending 状态的任务（启动时调用）
  async cleanupAllTasks(): Promise<number> {
    const count = await prisma.taskQueue.count({
      where: { status: 'pending' },
    });
    if (count > 0) {
      await prisma.taskQueue.deleteMany({
        where: { status: 'pending' },
      });
    }
    return count;
  },

  // Parse history from JSON string
  parseHistory(task: TaskQueue): HistoryMessage[] | undefined {
    if (!task.history) return undefined;
    try {
      return JSON.parse(task.history);
    } catch {
      return undefined;
    }
  },

  // Parse attachments from JSON string
  parseAttachments(task: TaskQueue): AttachmentData[] | undefined {
    if (!task.attachments) return undefined;
    try {
      return JSON.parse(task.attachments);
    } catch {
      return undefined;
    }
  },
};
