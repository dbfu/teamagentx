import prisma from '../../lib/prisma.js';

export interface CreateChatRoomCommandData {
  chatRoomId: string;
  name: string;
  content: string;
  sortOrder?: number;
  createdBy?: string;
}

export interface UpdateChatRoomCommandData {
  name?: string;
  content?: string;
  sortOrder?: number;
}

export interface ChatRoomCommand {
  id: string;
  chatRoomId: string;
  name: string;
  content: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export const chatRoomCommandService = {
  // 获取群聊的自定义指令列表（按排序、创建时间）
  async findByChatRoom(chatRoomId: string): Promise<ChatRoomCommand[]> {
    return prisma.chatRoomCommand.findMany({
      where: { chatRoomId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  },

  async findById(id: string): Promise<ChatRoomCommand | null> {
    return prisma.chatRoomCommand.findUnique({ where: { id } });
  },

  // 创建自定义指令
  async create(data: CreateChatRoomCommandData): Promise<ChatRoomCommand> {
    return prisma.chatRoomCommand.create({
      data: {
        chatRoomId: data.chatRoomId,
        name: data.name.trim(),
        content: data.content,
        sortOrder: data.sortOrder ?? 0,
        createdBy: data.createdBy,
      },
    });
  },

  async update(id: string, data: UpdateChatRoomCommandData): Promise<ChatRoomCommand> {
    return prisma.chatRoomCommand.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
  },

  async delete(id: string): Promise<void> {
    await prisma.chatRoomCommand.delete({ where: { id } });
  },
};
