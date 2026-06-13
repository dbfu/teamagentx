import prisma from '../../lib/prisma.js';
import { uploadService } from '../upload/upload.service.js';
import { randomUUID } from 'crypto';

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

function buildArchiveTitle(messages: Array<{ content: string; time: Date }>) {
  const firstContent = messages.find((message) => message.content.trim())?.content.trim();
  if (firstContent) {
    const normalized = firstContent.replace(/\s+/g, ' ');
    return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
  }

  const firstTime = messages[0]?.time;
  return firstTime ? `聊天记录 ${firstTime.toLocaleString('zh-CN')}` : '聊天记录';
}

export const messageService = {
  async create(data: {
    id: string;
    type: 'MESSAGE' | 'REPLY' | 'SYSTEM';
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
    type: 'MESSAGE' | 'REPLY' | 'SYSTEM';
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
      where: { archiveId: null },
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

  async findByChatRoomId(chatRoomId: string, options?: { take?: number; order?: 'asc' | 'desc'; beforeMessageId?: string }) {
    const beforeMessage = options?.beforeMessageId
      ? await prisma.message.findUnique({
          where: { id: options.beforeMessageId },
          select: { id: true, chatRoomId: true, time: true },
        })
      : null;

    if (options?.beforeMessageId && (!beforeMessage || beforeMessage.chatRoomId !== chatRoomId)) {
      return [];
    }

    const order = options?.order ?? 'asc';
    return prisma.message.findMany({
      where: {
        chatRoomId,
        archiveId: null,
        ...(beforeMessage
          ? {
              OR: [
                { time: { lt: beforeMessage.time } },
                { time: beforeMessage.time, id: { lt: beforeMessage.id } },
              ],
            }
          : {}),
      },
      include: { user: true, agent: true, attachments: true },
      orderBy: [{ time: order }, { id: order }],
      take: options?.take ?? 100,
    });
  },

  async search(query: string, options?: { take?: number }) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    return prisma.message.findMany({
      where: {
        archiveId: null,
        content: {
          contains: normalizedQuery,
        },
      },
      include: {
        user: true,
        agent: true,
        attachments: true,
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
            isQuickChatRoom: true,
            quickChatAgentId: true,
          },
        },
      },
      orderBy: [{ time: 'desc' }, { id: 'desc' }],
      take: options?.take ?? 20,
    });
  },

  /**
   * 获取指定消息之后的新消息（用于增量注入）
   */
  async findMessagesAfterId(chatRoomId: string, afterMessageId: string, take?: number) {
    // 先获取 afterMessageId 的时间
    const afterMessage = await prisma.message.findUnique({
      where: { id: afterMessageId },
      select: { time: true, archiveId: true },
    });
    if (!afterMessage || afterMessage.archiveId) {
      // 如果消息不存在或已归档，返回空数组
      return [];
    }

    // 获取该时间之后的消息
    return prisma.message.findMany({
      where: {
        chatRoomId,
        archiveId: null,
        time: { gt: afterMessage.time },
      },
      include: { user: true, agent: true, attachments: true },
      orderBy: { time: 'asc' },
      take: take ?? 50,
    });
  },

  async findArchivesByChatRoomId(chatRoomId: string) {
    return prisma.chatRoomMessageArchive.findMany({
      where: { chatRoomId },
      orderBy: { archivedAt: 'desc' },
    });
  },

  async findArchiveById(id: string) {
    return prisma.chatRoomMessageArchive.findUnique({
      where: { id },
    });
  },

  async findByArchiveId(archiveId: string, options?: { take?: number; order?: 'asc' | 'desc'; beforeMessageId?: string }) {
    const beforeMessage = options?.beforeMessageId
      ? await prisma.message.findUnique({
          where: { id: options.beforeMessageId },
          select: { id: true, archiveId: true, time: true },
        })
      : null;

    if (options?.beforeMessageId && (!beforeMessage || beforeMessage.archiveId !== archiveId)) {
      return [];
    }

    const order = options?.order ?? 'asc';
    return prisma.message.findMany({
      where: {
        archiveId,
        ...(beforeMessage
          ? {
              OR: [
                { time: { lt: beforeMessage.time } },
                { time: beforeMessage.time, id: { lt: beforeMessage.id } },
              ],
            }
          : {}),
      },
      include: { user: true, agent: true, attachments: true },
      orderBy: [{ time: order }, { id: order }],
      take: options?.take ?? 100,
    });
  },

  async archiveByChatRoomId(chatRoomId: string, createdBy?: string | null) {
    const now = new Date();
    const messages = await prisma.message.findMany({
      where: { chatRoomId, archiveId: null },
      select: { id: true, content: true, time: true },
      orderBy: [{ time: 'asc' }, { id: 'asc' }],
    });

    if (messages.length === 0) {
      await prisma.chatRoom.updateMany({
        where: { id: chatRoomId },
        data: { updatedAt: now },
      });
      return { count: 0, archive: null };
    }

    const archiveId = randomUUID();
    const archive = await prisma.$transaction(async (tx) => {
      const createdArchive = await tx.chatRoomMessageArchive.create({
        data: {
          id: archiveId,
          chatRoomId,
          title: buildArchiveTitle(messages),
          messageCount: messages.length,
          startedAt: messages[0]?.time ?? null,
          endedAt: messages[messages.length - 1]?.time ?? null,
          archivedAt: now,
          createdBy: createdBy ?? null,
        },
      });

      await tx.message.updateMany({
        where: { chatRoomId, archiveId: null },
        data: { archiveId },
      });

      await tx.chatRoom.updateMany({
        where: { id: chatRoomId },
        data: { updatedAt: now },
      });

      return createdArchive;
    });

    return { count: messages.length, archive };
  },

  async deleteByChatRoomId(chatRoomId: string) {
    const now = new Date();
    // 删除消息前先收集音频附件，删完数据库再清理磁盘文件
    const audioAttachments = await prisma.attachment.findMany({
      where: { type: 'audio', message: { chatRoomId } },
      select: { url: true },
    });
    const result = await prisma.message.deleteMany({
      where: { chatRoomId },
    });
    for (const att of audioAttachments) {
      await uploadService.deleteAudio(att.url).catch(() => {});
    }
    await prisma.chatRoom.updateMany({
      where: { id: chatRoomId },
      data: { updatedAt: now },
    });
    return result;
  },

  async deleteById(id: string) {
    // 删除消息前先收集音频附件，事务结束后清理磁盘
    const audioAttachments = await prisma.attachment.findMany({
      where: { type: 'audio', messageId: id },
      select: { url: true },
    });
    const result = await prisma.$transaction(async (tx) => {
      await tx.message.updateMany({
        where: { replyMessageId: id },
        data: { replyMessageId: null },
      });

      return tx.message.delete({
        where: { id },
      });
    });
    for (const att of audioAttachments) {
      await uploadService.deleteAudio(att.url).catch(() => {});
    }
    return result;
  },

  async deleteByIds(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (uniqueIds.length === 0) return { count: 0, chatRoomIds: [] as string[] };

    const messages = await prisma.message.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, chatRoomId: true },
    });
    if (messages.length === 0) return { count: 0, chatRoomIds: [] as string[] };

    const existingIds = messages.map((message) => message.id);
    const chatRoomIds = Array.from(new Set(messages.map((message) => message.chatRoomId)));
    const audioAttachments = await prisma.attachment.findMany({
      where: { type: 'audio', messageId: { in: existingIds } },
      select: { url: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.message.updateMany({
        where: { replyMessageId: { in: existingIds } },
        data: { replyMessageId: null },
      });

      return tx.message.deleteMany({
        where: { id: { in: existingIds } },
      });
    });

    for (const att of audioAttachments) {
      await uploadService.deleteAudio(att.url).catch(() => {});
    }

    return { count: result.count, chatRoomIds };
  },

  // 批量更新 executionRecordId、executionDuration 和 token 信息
  async updateExecutionRecordId(
    messageIds: string[],
    executionRecordId: string,
    executionDuration?: number,
    totalTokens?: number,
    cacheReadTokens?: number,
    model?: string | null,
  ) {
    return prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: {
        executionRecordId,
        executionDuration: executionDuration ?? null,
        totalTokens: totalTokens ?? null,
        cacheReadTokens: cacheReadTokens ?? null,
        model: model ?? null,
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
