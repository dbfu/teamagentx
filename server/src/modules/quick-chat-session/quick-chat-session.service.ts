import prisma from '../../lib/prisma.js';
import type { QuickChatSession, ChatRoom } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface QuickChatSessionCreateData {
  agentId: string;
  chatRoomId: string;
}

export interface QuickChatSessionWithRoom extends QuickChatSession {
  chatRoom: ChatRoom & {
    chatRoomAgents: Array<{
      id: string;
      userId: string | null;
      agentId: string | null;
    }>;
  };
}

export const quickChatSessionService = {
  /**
   * 创建快速对话会话
   * 自动创建会话工作目录 ~/.teamagentx/{agentId}/{sessionId}
   */
  async create(data: QuickChatSessionCreateData): Promise<{ sessionId: string; workDir: string; session: QuickChatSession }> {
    const sessionId = randomUUID();
    const workDir = path.join(os.homedir(), '.teamagentx', data.agentId, sessionId);

    // 创建工作目录
    fs.mkdirSync(workDir, { recursive: true });

    const session = await prisma.quickChatSession.create({
      data: {
        agentId: data.agentId,
        chatRoomId: data.chatRoomId,
        sessionId,
        workDir,
      },
    });

    return { sessionId, workDir, session };
  },

  /**
   * 根据 chatRoomId 获取快速对话会话
   */
  async getByChatRoomId(chatRoomId: string): Promise<QuickChatSession | null> {
    return prisma.quickChatSession.findFirst({
      where: { chatRoomId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * 获取助手的快速对话历史
   */
  async getByAgent(agentId: string, limit: number = 50): Promise<QuickChatSession[]> {
    return prisma.quickChatSession.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /**
   * 获取用户与某助手的快速对话群聊列表（直接查询 ChatRoom）
   */
  async getUserQuickChatRooms(userId: string, agentId: string): Promise<QuickChatSessionWithRoom[]> {
    // 直接查询该助手关联的快速对话群聊，用户作为成员参与
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        isQuickChatRoom: true,
        quickChatAgentId: agentId,
        chatRoomAgents: {
          some: { userId },
        },
      },
      include: {
        chatRoomAgents: {
          select: {
            id: true,
            userId: true,
            agentId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 转换为 QuickChatSessionWithRoom 格式（兼容前端类型）
    return chatRooms.map(room => ({
      id: room.id,
      agentId: agentId,
      chatRoomId: room.id,
      sessionId: room.id, // 使用 room.id 作为 sessionId
      workDir: '',
      status: 'active',
      createdAt: room.createdAt.toISOString(),
      archivedAt: null,
      chatRoom: {
        id: room.id,
        name: room.name,
        description: room.description,
        ownerId: room.ownerId,
        isQuickChatRoom: room.isQuickChatRoom,
        quickChatAgentId: room.quickChatAgentId,
        createdAt: room.createdAt.toISOString(),
        updatedAt: room.updatedAt.toISOString(),
        avatar: room.avatar,
        avatarColor: room.avatarColor,
        chatRoomAgents: room.chatRoomAgents,
      },
    })) as unknown as QuickChatSessionWithRoom[];
  },

  /**
   * 获取用户在某个助手上的快速对话群聊数量
   */
  async getUserQuickChatCount(userId: string, agentId: string): Promise<number> {
    const sessions = await prisma.quickChatSession.findMany({
      where: { agentId },
      include: {
        chatRoom: {
          include: {
            chatRoomAgents: {
              where: { userId },
              select: { id: true },
            },
          },
        },
      },
    });

    return sessions.filter(s => s.chatRoom.chatRoomAgents.length > 0).length;
  },

  /**
   * 归档会话
   */
  async archive(sessionId: string): Promise<void> {
    await prisma.quickChatSession.update({
      where: { sessionId },
      data: {
        status: 'archived',
        archivedAt: new Date(),
      },
    });
  },

  /**
   * 删除会话（同时删除工作目录）
   */
  async delete(sessionId: string): Promise<void> {
    const session = await prisma.quickChatSession.findUnique({
      where: { sessionId },
    });

    if (session && fs.existsSync(session.workDir)) {
      fs.rmSync(session.workDir, { recursive: true, force: true });
    }

    await prisma.quickChatSession.delete({
      where: { sessionId },
    });
  },
};