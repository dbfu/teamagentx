import prisma from '../../lib/prisma.js';
import type { Todo, TodoStatus } from '@prisma/client';

export interface TodoCreateData {
  chatRoomId: string;
  messageId: string;
  triggerAgentId: string;
  ownerUserId?: string | null;
  contentSummary: string;
}

export interface TodoWithRelations {
  id: string;
  chatRoomId: string;
  messageId: string;
  triggerAgentId: string;
  ownerUserId: string | null;
  contentSummary: string;
  status: TodoStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  chatRoom: {
    id: string;
    name: string;
  };
  triggerAgent: {
    id: string;
    name: string;
    avatar: string | null;
    avatarColor: string | null;
  };
}

export const todoService = {
  // 创建待办
  async create(data: TodoCreateData): Promise<Todo> {
    return prisma.todo.create({
      data: {
        chatRoomId: data.chatRoomId,
        messageId: data.messageId,
        triggerAgentId: data.triggerAgentId,
        ownerUserId: data.ownerUserId ?? null,
        contentSummary: data.contentSummary,
        status: 'pending',
      },
    });
  },

  // 根据 ID 获取单个待办
  async getById(id: string): Promise<Todo | null> {
    return prisma.todo.findUnique({
      where: { id },
    });
  },

  // 根据 messageId 获取待办（检查是否已存在）
  async getByMessageId(messageId: string): Promise<Todo | null> {
    return prisma.todo.findUnique({
      where: { messageId },
    });
  },

  // 获取用户的所有待办（按 ownerUserId 查询）
  async getByOwnerUserId(userId: string, status?: TodoStatus): Promise<TodoWithRelations[]> {
    const whereClause: any = { ownerUserId: userId };
    if (status) {
      whereClause.status = status;
    }

    return prisma.todo.findMany({
      where: whereClause,
      include: {
        chatRoom: {
          select: { id: true, name: true },
        },
        triggerAgent: {
          select: { id: true, name: true, avatar: true, avatarColor: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // 获取用户待处理待办的数量
  async getPendingCountByOwnerUserId(userId: string): Promise<number> {
    return prisma.todo.count({
      where: { ownerUserId: userId, status: 'pending' },
    });
  },

  // 更新待办状态
  async updateStatus(id: string, status: TodoStatus): Promise<Todo | null> {
    try {
      const data: any = { status };
      if (status === 'completed') {
        data.completedAt = new Date();
      }
      return await prisma.todo.update({
        where: { id },
        data,
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  },

  // 完成待办
  async complete(id: string): Promise<Todo | null> {
    return this.updateStatus(id, 'completed');
  },

  // 忽略待办
  async dismiss(id: string): Promise<Todo | null> {
    return this.updateStatus(id, 'dismissed');
  },

  // 删除待办
  async delete(id: string): Promise<void> {
    try {
      await prisma.todo.delete({
        where: { id },
      });
    } catch (error: any) {
      if (error.code !== 'P2025') {
        throw error;
      }
    }
  },

  // 删除群聊的所有待办
  async deleteByChatRoomId(chatRoomId: string): Promise<void> {
    await prisma.todo.deleteMany({
      where: { chatRoomId },
    });
  },
};