import prisma from '../../lib/prisma.js';
import type { CoordinatorLog } from '@prisma/client';

export interface CreateCoordinatorLogInput {
  chatRoomId: string;
  triggerMessageId: string;
  decision: string;
  targetAgentIds?: string[];
  content?: string;
  forwardVerbatim?: boolean;
  reason?: string;
  sourceAgentId?: string;
  sourceIsHuman?: boolean;
  sourceContent?: string;
  success?: boolean;
  errorMessage?: string;
}

export type CoordinatorLogWithRelations = CoordinatorLog & {
  chatRoom?: {
    id: string;
    name: string;
    avatar?: string | null;
  };
  sourceAgent?: {
    id: string;
    name: string;
  } | null;
};

export const coordinatorLogService = {
  async create(data: CreateCoordinatorLogInput): Promise<CoordinatorLog> {
    return prisma.coordinatorLog.create({
      data: {
        chatRoomId: data.chatRoomId,
        triggerMessageId: data.triggerMessageId,
        decision: data.decision,
        targetAgentIds: data.targetAgentIds ? JSON.stringify(data.targetAgentIds) : null,
        content: data.content ?? null,
        forwardVerbatim: data.forwardVerbatim ?? false,
        reason: data.reason ?? null,
        sourceAgentId: data.sourceAgentId ?? null,
        sourceIsHuman: data.sourceIsHuman ?? true,
        sourceContent: data.sourceContent ?? null,
        success: data.success ?? true,
        errorMessage: data.errorMessage ?? null,
      },
    });
  },

  async findByChatRoom(chatRoomId: string, limit = 50): Promise<CoordinatorLogWithRelations[]> {
    return prisma.coordinatorLog.findMany({
      where: { chatRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        chatRoom: {
          select: { id: true, name: true, avatar: true },
        },
        sourceAgent: {
          select: { id: true, name: true },
        },
      },
    });
  },

  async findByChatRoomGrouped(limitPerRoom = 20): Promise<Map<string, CoordinatorLogWithRelations[]>> {
    // 获取所有群聊
    const chatRooms = await prisma.chatRoom.findMany({
      select: { id: true, name: true },
    });

    const grouped = new Map<string, CoordinatorLogWithRelations[]>();

    for (const room of chatRooms) {
      const logs = await this.findByChatRoom(room.id, limitPerRoom);
      if (logs.length > 0) {
        grouped.set(room.id, logs);
      }
    }

    return grouped;
  },

  async findAll(limit = 100): Promise<CoordinatorLogWithRelations[]> {
    return prisma.coordinatorLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        chatRoom: {
          select: { id: true, name: true, avatar: true },
        },
        sourceAgent: {
          select: { id: true, name: true },
        },
      },
    });
  },

  async getStats(): Promise<{
    total: number;
    byDecision: Record<string, number>;
    byChatRoom: Array<{ chatRoomId: string; chatRoomName: string; count: number }>;
  }> {
    const total = await prisma.coordinatorLog.count();

    const byDecisionRaw = await prisma.coordinatorLog.groupBy({
      by: ['decision'],
      _count: { id: true },
    });
    const byDecision: Record<string, number> = {};
    for (const item of byDecisionRaw) {
      byDecision[item.decision] = item._count.id;
    }

    const byChatRoomRaw = await prisma.coordinatorLog.groupBy({
      by: ['chatRoomId'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    const chatRoomIds = byChatRoomRaw.map(item => item.chatRoomId);
    const chatRooms = await prisma.chatRoom.findMany({
      where: { id: { in: chatRoomIds } },
      select: { id: true, name: true },
    });

    const byChatRoom = byChatRoomRaw.map(item => ({
      chatRoomId: item.chatRoomId,
      chatRoomName: chatRooms.find(r => r.id === item.chatRoomId)?.name ?? '未知群聊',
      count: item._count.id,
    }));

    return { total, byDecision, byChatRoom };
  },
};