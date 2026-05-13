import prisma from '../../lib/prisma.js';

interface AttachmentData {
  type?: 'image' | 'audio' | 'file';
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
  transcript?: string;
  waveform?: string;
}

export const messageService = {
  async create(data: {
    id: string;
    type: 'MESSAGE' | 'REPLY';
    content: string;
    time: Date;
    userId?: string | null;
    agentId?: string | null;
    chatRoomId: string;
    replyMessageId?: string | null;
    isHuman?: boolean;
    executionRecordId?: string | null;
  }) {
    const now = new Date();
    return prisma.message.create({
      data: {
        ...data,
        type: data.type,
        updatedAt: now,
      },
    });
  },

  /**
   * 创建带附件的消息
   */
  async createWithAttachments(data: {
    id: string;
    type: 'MESSAGE' | 'REPLY';
    content: string;
    time: Date;
    userId?: string | null;
    agentId?: string | null;
    chatRoomId: string;
    replyMessageId?: string | null;
    isHuman?: boolean;
    attachments?: AttachmentData[];
  }) {
    const now = new Date();
    return prisma.message.create({
      data: {
        id: data.id,
        type: data.type,
        content: data.content,
        time: data.time,
        userId: data.userId,
        agentId: data.agentId,
        chatRoomId: data.chatRoomId,
        replyMessageId: data.replyMessageId,
        isHuman: data.isHuman ?? true,
        updatedAt: now,
        attachments: data.attachments ? {
          create: data.attachments.map(att => ({
            type: att.type ?? 'image',
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            url: att.url,
            width: att.width,
            height: att.height,
            durationMs: att.durationMs,
            transcript: att.transcript,
            waveform: att.waveform,
          })),
        } : undefined,
      },
      include: {
        user: true,
        agent: true,
        attachments: true,
      },
    });
  },

  async findMany(options?: { take?: number }) {
    return prisma.message.findMany({
      include: { user: true, agent: true, attachments: true },
      orderBy: { time: 'asc' },
      take: options?.take ?? 100,
    });
  },

  async findById(id: string) {
    return prisma.message.findUnique({
      where: { id },
      include: { user: true, agent: true, attachments: true },
    });
  },

  async findByChatRoomId(chatRoomId: string, options?: { take?: number; order?: 'asc' | 'desc' }) {
    return prisma.message.findMany({
      where: { chatRoomId },
      include: { user: true, agent: true, attachments: true },
      orderBy: { time: options?.order ?? 'asc' },
      take: options?.take ?? 100,
    });
  },

  /**
   * 获取指定消息之后的新消息（用于增量注入）
   */
  async findMessagesAfterId(chatRoomId: string, afterMessageId: string, take?: number) {
    // 先获取 afterMessageId 的时间
    const afterMessage = await prisma.message.findUnique({
      where: { id: afterMessageId },
      select: { time: true },
    });
    if (!afterMessage) {
      // 如果消息不存在，返回空数组（可能被删除了）
      return [];
    }

    // 获取该时间之后的消息
    return prisma.message.findMany({
      where: {
        chatRoomId,
        time: { gt: afterMessage.time },
      },
      include: { user: true, agent: true, attachments: true },
      orderBy: { time: 'asc' },
      take: take ?? 50,
    });
  },

  async deleteByChatRoomId(chatRoomId: string) {
    return prisma.message.deleteMany({
      where: { chatRoomId },
    });
  },

  async deleteById(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.message.updateMany({
        where: { replyMessageId: id },
        data: { replyMessageId: null },
      });

      return tx.message.delete({
        where: { id },
      });
    });
  },

  // 批量更新 executionRecordId、executionDuration 和 token 信息
  async updateExecutionRecordId(
    messageIds: string[],
    executionRecordId: string,
    executionDuration?: number,
    totalTokens?: number,
    cacheReadTokens?: number,
  ) {
    return prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: {
        executionRecordId,
        executionDuration: executionDuration ?? null,
        totalTokens: totalTokens ?? null,
        cacheReadTokens: cacheReadTokens ?? null,
      },
    });
  },

  // 获取消息及其执行记录
  async getMessageWithExecutionRecord(messageId: string) {
    return prisma.message.findUnique({
      where: { id: messageId },
      include: {
        executionRecord: true,
        agent: true,
        user: true,
        attachments: true,
      },
    });
  },
};
