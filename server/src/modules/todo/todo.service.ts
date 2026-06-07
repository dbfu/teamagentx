import type { TodoStatus } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { getMentionedKnownUsernames } from './todo-mentions.js';

export interface TodoData {
  id: string;
  chatRoomId: string;
  messageId: string;
  triggerAgentId: string;
  triggerAgentName: string;
  ownerUserId: string | null;
  contentSummary: string;
  chatRoomName: string;
  status: TodoStatus;
  createdAt: Date;
}

export interface CreateTodoFromMentionParams {
  chatRoomId: string;
  messageId: string;
  messageTime: Date;
  triggerAgentId: string;
  triggerAgentName: string;
  content: string;
}

type TodoWithRelations = {
  id: string;
  chatRoomId: string;
  messageId: string;
  triggerAgentId: string;
  ownerUserId: string | null;
  contentSummary: string;
  status: TodoStatus;
  createdAt: Date;
  chatRoom: { id: string; name: string };
  triggerAgent: { id: string; name: string };
};

function toTodoData(todo: TodoWithRelations): TodoData {
  return {
    id: todo.id,
    chatRoomId: todo.chatRoomId,
    messageId: todo.messageId,
    triggerAgentId: todo.triggerAgentId,
    triggerAgentName: todo.triggerAgent.name,
    ownerUserId: todo.ownerUserId,
    contentSummary: todo.contentSummary,
    chatRoomName: todo.chatRoom.name,
    status: todo.status,
    createdAt: todo.createdAt,
  };
}

function summarizeContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export const todoService = {
  async getById(id: string) {
    return prisma.todo.findUnique({
      where: { id },
    });
  },

  async getByMessageId(messageId: string) {
    return prisma.todo.findUnique({
      where: { messageId },
    });
  },

  async getByOwnerUserId(userId: string, status?: TodoStatus): Promise<TodoData[]> {
    const todos = await prisma.todo.findMany({
      where: {
        ownerUserId: userId,
        ...(status ? { status } : {}),
      },
      include: {
        chatRoom: {
          select: { id: true, name: true },
        },
        triggerAgent: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return todos.map(toTodoData);
  },

  async getPendingCountByOwnerUserId(userId: string): Promise<number> {
    return prisma.todo.count({
      where: { ownerUserId: userId, status: 'pending' },
    });
  },

  async createFromMentionedUser(params: CreateTodoFromMentionParams): Promise<TodoData | null> {
    const chatRoom = await prisma.chatRoom.findUnique({
      where: { id: params.chatRoomId },
      select: {
        id: true,
        name: true,
        owner: {
          select: { id: true, username: true },
        },
      },
    });

    if (!chatRoom?.owner) return null;

    const mentionedUsernames = getMentionedKnownUsernames(params.content, [chatRoom.owner.username]);
    if (!mentionedUsernames.includes(chatRoom.owner.username)) return null;

    const ownerMembership = await prisma.chatRoomAgent.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId: params.chatRoomId,
          userId: chatRoom.owner.id,
        },
      },
      select: { lastReadAt: true },
    });

    if (!ownerMembership || params.messageTime <= ownerMembership.lastReadAt) {
      return null;
    }

    try {
      const todo = await prisma.todo.create({
        data: {
          chatRoomId: params.chatRoomId,
          messageId: params.messageId,
          triggerAgentId: params.triggerAgentId,
          ownerUserId: chatRoom.owner.id,
          contentSummary: summarizeContent(params.content),
          status: 'pending',
        },
        include: {
          chatRoom: {
            select: { id: true, name: true },
          },
          triggerAgent: {
            select: { id: true, name: true },
          },
        },
      });

      return toTodoData(todo);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return null;
      }
      throw error;
    }
  },

  async updateStatus(id: string, status: TodoStatus) {
    try {
      return await prisma.todo.update({
        where: { id },
        data: {
          status,
          completedAt: status === 'completed' ? new Date() : null,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2025') {
        return null;
      }
      throw error;
    }
  },

  async complete(id: string) {
    return this.updateStatus(id, 'completed');
  },

  async dismiss(id: string) {
    return this.updateStatus(id, 'dismissed');
  },

  async completePendingByOwnerAndChatRoom(ownerUserId: string, chatRoomId: string): Promise<string[]> {
    const pendingTodos = await prisma.todo.findMany({
      where: {
        ownerUserId,
        chatRoomId,
        status: 'pending',
      },
      select: { id: true },
    });

    if (pendingTodos.length === 0) return [];

    await prisma.todo.updateMany({
      where: {
        id: { in: pendingTodos.map((todo) => todo.id) },
      },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
    });

    return pendingTodos.map((todo) => todo.id);
  },

  async deleteByChatRoomId(chatRoomId: string): Promise<void> {
    await prisma.todo.deleteMany({
      where: { chatRoomId },
    });
  },
};
