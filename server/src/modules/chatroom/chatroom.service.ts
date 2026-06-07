// ChatRoom service - handles all chatroom-related database operations
import prisma from '../../lib/prisma.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentService } from '../../core/agent/agent.service.js';
import {
  getSystemAgentsCached,
  type SystemAgentInfo as CachedSystemAgentInfo,
} from './system-agents-cache.js';
import { shouldEnableRoomHistoryByDefault } from '../../core/agent/system-assistant.constants.js';

export interface CreateChatRoomData {
  name: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  workDir?: string | null;
  ownerId?: string;
  rules?: string;
  agentTriggerMode?: 'auto' | 'manual' | 'coordinator';
}

export interface DuplicateChatRoomData {
  sourceChatRoomId: string;
  name?: string;
}

export interface UpdateChatRoomData {
  name?: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  rules?: string;
  workDir?: string | null;
  envVars?: string | null;
  defaultAgentId?: string | null;
  agentTriggerMode?: 'auto' | 'manual' | 'coordinator';
}

export interface AddAgentData {
  chatRoomId: string;
  userId?: string;
  agentId?: string;
  role?: string;
  injectGroupHistory?: boolean;
}

/**
 * 确保群聊工作目录存在
 * 如果指定了 workDir，使用指定的路径；否则使用默认路径 ~/.teamagentx/workspace/<chatRoomId>
 */
function ensureWorkDirExists(chatRoomId: string, workDir?: string | null): void {
  const targetDir = workDir?.trim()
    ? resolveFolderPath(workDir.trim())
    : path.join(os.homedir(), '.teamagentx', 'workspace', chatRoomId);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

/**
 * 解析文件夹路径，处理 ~ 开头的路径
 */
function resolveFolderPath(folderPath: string): string {
  return folderPath.startsWith('~')
    ? path.join(os.homedir(), folderPath.slice(1))
    : folderPath;
}

const agentInclude = {
  user: {
    select: {
      id: true,
      username: true,
      avatar: true,
      avatarColor: true,
    },
  },
  agent: {
    select: {
      id: true,
      name: true,
      avatar: true,
      avatarColor: true,
      description: true,
      type: true,
      agentLevel: true,
      workDir: true,
      speechConfig: true,
    },
  },
};

// 系统助手类型（与缓存模块共用同一结构）
type SystemAgentInfo = CachedSystemAgentInfo;

// 获取系统助手列表（带 30 秒缓存，缓存实现见 ./system-agents-cache）
async function getSystemAgents(): Promise<SystemAgentInfo[]> {
  return getSystemAgentsCached();
}

function createVirtualSystemAgentMember(chatRoomId: string, agentId: string) {
  return {
    id: `system-${agentId}`,
    chatRoomId,
    userId: null,
    agentId,
    role: 'MEMBER',
    injectGroupHistory: shouldEnableRoomHistoryByDefault(agentId),
    customWorkDir: null,
    joinedAt: new Date(),
    lastReadAt: new Date(),
    lastInjectedMessageId: null,
  };
}

async function normalizeDefaultAgentId(chatRoomId: string, defaultAgentId: string | null): Promise<string | null> {
  const normalizedAgentId = defaultAgentId?.trim() || null;
  if (!normalizedAgentId) return null;

  const agent = await prisma.agent.findUnique({
    where: { id: normalizedAgentId },
    select: {
      id: true,
      isActive: true,
      agentLevel: true,
    },
  });

  if (!agent || !agent.isActive) {
    throw new Error('默认助手不存在或未启用');
  }

  if (agent.agentLevel === 'system') {
    throw new Error('系统助手不能设为默认接收助手');
  }

  const member = await prisma.chatRoomAgent.findFirst({
    where: { chatRoomId, agentId: normalizedAgentId },
    select: { id: true },
  });

  if (!member) {
    throw new Error('默认助手必须是群聊成员');
  }

  return normalizedAgentId;
}

// 为群聊添加可见的虚拟系统助手。隐藏系统助手（如群调度）不在缓存结果中。
function addVirtualSystemAgents<T extends { id: string; chatRoomAgents: any[] }>(
  chatRoom: T,
  systemAgents: SystemAgentInfo[]
): T {
  const existingAgentIds = new Set(
    chatRoom.chatRoomAgents
      .filter((ra: any) => ra.agentId)
      .map((ra: any) => ra.agentId)
  );

  const virtualSystemAgents = systemAgents
    .filter((agent: SystemAgentInfo) => !existingAgentIds.has(agent.id))
    .map((agent: SystemAgentInfo) => ({
      ...createVirtualSystemAgentMember(chatRoom.id, agent.id),
      user: null,
      agent: {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        avatarColor: agent.avatarColor,
        description: agent.description,
        type: agent.type,
        agentLevel: agent.agentLevel,
        workDir: agent.workDir,
        speechConfig: agent.speechConfig,
      },
    }));

  return {
    ...chatRoom,
    chatRoomAgents: [...chatRoom.chatRoomAgents, ...virtualSystemAgents],
  };
}

function syncQuickChatRoomAvatar<T extends {
  isQuickChatRoom?: boolean | null;
  quickChatAgentId?: string | null;
  avatar?: string | null;
  avatarColor?: string | null;
  chatRoomAgents: Array<{ agentId?: string | null; agent?: { avatar?: string | null; avatarColor?: string | null } | null }>;
}>(chatRoom: T): T {
  if (!chatRoom.isQuickChatRoom || !chatRoom.quickChatAgentId) {
    return chatRoom;
  }

  const quickChatAgent = chatRoom.chatRoomAgents.find(
    (member) => member.agentId === chatRoom.quickChatAgentId && member.agent
  )?.agent;

  if (!quickChatAgent) {
    return chatRoom;
  }

  return {
    ...chatRoom,
    avatar: quickChatAgent.avatar ?? chatRoom.avatar ?? null,
    avatarColor: quickChatAgent.avatarColor ?? chatRoom.avatarColor ?? null,
  };
}

export const chatRoomService = {
  async create(data: CreateChatRoomData) {
    const { name, avatar, avatarColor, description, workDir, ownerId, rules, agentTriggerMode } = data;
    const now = new Date();

    const chatRoom = await prisma.chatRoom.create({
      data: {
        id: randomUUID(),
        name,
        avatar,
        avatarColor,
        description,
        workDir: workDir?.trim() || null,
        rules,
        ownerId,
        defaultAgentId: null,
        agentTriggerMode: agentTriggerMode ?? 'coordinator',
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    // 确保工作目录存在
    ensureWorkDirExists(chatRoom.id, workDir);

    // 返回更新后的群聊
    const result = await prisma.chatRoom.findUnique({
      where: { id: chatRoom.id },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!result) return null;
    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  async createWithOwner(data: CreateChatRoomData & { ownerId: string }) {
    const { name, avatar, avatarColor, description, workDir, ownerId, rules, agentTriggerMode } = data;
    const now = new Date();

    // Create chatRoom with owner
    const chatRoom = await prisma.chatRoom.create({
      data: {
        id: randomUUID(),
        name,
        avatar,
        avatarColor,
        description,
        workDir: workDir?.trim() || null,
        rules,
        ownerId,
        defaultAgentId: null,
        agentTriggerMode: agentTriggerMode ?? 'coordinator',
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    // 确保工作目录存在
    ensureWorkDirExists(chatRoom.id, workDir);

    // Automatically add owner as ChatRoomAgent with OWNER role
    await prisma.chatRoomAgent.create({
      data: {
        id: randomUUID(),
        chatRoomId: chatRoom.id,
        userId: ownerId,
        role: 'OWNER',
        injectGroupHistory: false,
      },
    });

    // Return chatRoom with updated agents
    const result = await prisma.chatRoom.findUnique({
      where: { id: chatRoom.id },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!result) return null;
    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  async duplicate(data: DuplicateChatRoomData) {
    const source = await prisma.chatRoom.findUnique({
      where: { id: data.sourceChatRoomId },
      include: {
        chatRoomAgents: true,
      },
    });

    if (!source) {
      return null;
    }

    const now = new Date();
    const newChatRoomId = randomUUID();
    const copiedName = data.name?.trim() || `${source.name} 副本`;
    const copiedWorkDir = source.workDir?.trim() || null;

    await prisma.$transaction(async (tx) => {
      await tx.chatRoom.create({
        data: {
          id: newChatRoomId,
          name: copiedName,
          avatar: source.avatar,
          avatarColor: source.avatarColor,
          description: source.description,
          rules: source.rules,
          workDir: copiedWorkDir,
          ownerId: source.ownerId,
          isQuickChatRoom: source.isQuickChatRoom,
          quickChatAgentId: source.quickChatAgentId,
          defaultAgentId: source.defaultAgentId,
          agentTriggerMode: source.agentTriggerMode,
          updatedAt: now,
        },
      });

      if (source.chatRoomAgents.length > 0) {
        await tx.chatRoomAgent.createMany({
          data: source.chatRoomAgents.map((roomAgent) => ({
            id: randomUUID(),
            chatRoomId: newChatRoomId,
            userId: roomAgent.userId,
            agentId: roomAgent.agentId,
            role: roomAgent.role,
            injectGroupHistory: roomAgent.injectGroupHistory,
            customWorkDir: roomAgent.customWorkDir,
            lastInjectedMessageId: null,
            joinedAt: now,
            lastReadAt: now,
          })),
        });
      }
    });

    ensureWorkDirExists(newChatRoomId, copiedWorkDir);

    const result = await prisma.chatRoom.findUnique({
      where: { id: newChatRoomId },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!result) return null;
    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(syncQuickChatRoomAvatar(result), systemAgents);
  },

  async findById(id: string) {
    const chatRoom = await prisma.chatRoom.findUnique({
      where: { id },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        messages: {
          where: { archiveId: null },
          include: agentInclude,
          orderBy: { time: 'asc' },
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!chatRoom) return null;

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(syncQuickChatRoomAvatar(chatRoom), systemAgents);
  },

  async findAll() {
    const chatRooms = await prisma.chatRoom.findMany({
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
        messages: {
          where: { archiveId: null },
          orderBy: { time: 'desc' },
          take: 1,
          select: {
            id: true,
            content: true,
            time: true,
            isHuman: true,
            userId: true,
            agentId: true,
            user: {
              select: {
                id: true,
                username: true,
              },
            },
            agent: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();

    // 处理数据并排序
    const processedRooms = chatRooms.map((chatRoom) => {
      // 将 messages 数组转换为 lastMessage 字段
      const { messages, ...rest } = chatRoom;
      const lastMessage = messages && messages.length > 0 ? messages[0] : null;
      return addVirtualSystemAgents(syncQuickChatRoomAvatar({ ...rest, lastMessage }), systemAgents);
    });

    // 排序：置顶在前，然后按最后消息时间倒序（无消息的按更新时间）
    processedRooms.sort((a, b) => {
      // 置顶的排在前面
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      // 都是置顶时，按置顶时间倒序
      if (a.isPinned && b.isPinned) {
        const aPinnedAt = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
        const bPinnedAt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
        return bPinnedAt - aPinnedAt;
      }
      // 都不是置顶时，按最后消息时间倒序（无消息的按更新时间）
      const aTime = a.lastMessage?.time
        ? new Date(a.lastMessage.time).getTime()
        : new Date(a.updatedAt).getTime();
      const bTime = b.lastMessage?.time
        ? new Date(b.lastMessage.time).getTime()
        : new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });

    return processedRooms;
  },

  async addAgent(data: AddAgentData) {
    const { chatRoomId, userId, agentId, role = 'MEMBER', injectGroupHistory = false } = data;

    // Validate that exactly one of userId or agentId is provided
    if ((!userId && !agentId) || (userId && agentId)) {
      throw new Error('必须提供 userId 或 agentId 中的一个（不能同时或都不提供）');
    }

    // 检查是否是快速对话群聊，快速对话群聊不允许添加新助手
    const chatRoom = await prisma.chatRoom.findUnique({
      where: { id: chatRoomId },
      select: { isQuickChatRoom: true },
    });

    if (chatRoom?.isQuickChatRoom && agentId) {
      throw new Error('快速对话群聊不允许添加新助手');
    }

    return prisma.chatRoomAgent.create({
      data: {
        id: randomUUID(),
        chatRoomId,
        userId,
        agentId,
        role,
        injectGroupHistory,
      },
      include: agentInclude,
    });
  },

  async removeAgent(agentId: string) {
    const chatRoomAgent = await prisma.chatRoomAgent.findUnique({
      where: { id: agentId },
      select: {
        chatRoomId: true,
        agentId: true,
      },
    });

    const deleted = await prisma.chatRoomAgent.delete({
      where: { id: agentId },
    });

    if (chatRoomAgent?.agentId) {
      await prisma.chatRoom.updateMany({
        where: {
          id: chatRoomAgent.chatRoomId,
          defaultAgentId: chatRoomAgent.agentId,
        },
        data: {
          defaultAgentId: null,
          updatedAt: new Date(),
        },
      });
    }

    return deleted;
  },

  async isAgent(chatRoomId: string, userId: string) {
    const agent = await prisma.chatRoomAgent.findFirst({
      where: { chatRoomId, userId },
    });
    return !!agent;
  },

  async isAgentMember(chatRoomId: string, agentId: string) {
    const agent = await prisma.chatRoomAgent.findFirst({
      where: { chatRoomId, agentId },
    });
    return !!agent;
  },

  async getAgentMember(chatRoomId: string, agentId: string) {
    const member = await prisma.chatRoomAgent.findFirst({
      where: { chatRoomId, agentId },
    });
    if (member) return member;
    if (!shouldEnableRoomHistoryByDefault(agentId)) return null;
    return createVirtualSystemAgentMember(chatRoomId, agentId);
  },

  async delete(id: string) {
    return prisma.chatRoom.delete({
      where: { id },
    });
  },

  async update(id: string, data: UpdateChatRoomData) {
    const { defaultAgentId, agentTriggerMode, ...restData } = data;
    const shouldClearDefaultAgent = agentTriggerMode === 'coordinator';
    const normalizedDefaultAgentId = defaultAgentId !== undefined
      ? await normalizeDefaultAgentId(id, defaultAgentId)
      : undefined;

    const result = await prisma.chatRoom.update({
      where: { id },
      data: {
        ...restData,
        ...(agentTriggerMode !== undefined && { agentTriggerMode }),
        ...(data.workDir !== undefined && { workDir: data.workDir?.trim() || null }),
        ...((defaultAgentId !== undefined || shouldClearDefaultAgent) && {
          defaultAgentId: shouldClearDefaultAgent ? null : normalizedDefaultAgentId,
        }),
        updatedAt: new Date(),
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  async getAgents(chatRoomId: string) {
    // 获取群聊中的普通助手
    const regularAgents = await prisma.chatRoomAgent.findMany({
      where: { chatRoomId },
      include: agentInclude,
    });

    // 获取所有系统助手
    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(
      { id: chatRoomId, chatRoomAgents: regularAgents },
      systemAgents,
    ).chatRoomAgents;
  },

  /**
   * 更新用户在某个群聊的最后阅读时间
   */
  async updateLastReadAt(chatRoomId: string, userId: string) {
    const now = new Date();
    const result = await prisma.chatRoomAgent.updateMany({
      where: { chatRoomId, userId },
      data: { lastReadAt: now },
    });

    if (result.count > 0) {
      return result;
    }

    const chatRoom = await prisma.chatRoom.findUnique({
      where: { id: chatRoomId },
      select: { ownerId: true },
    });

    if (chatRoom?.ownerId !== userId) {
      return result;
    }

    return prisma.chatRoomAgent.upsert({
      where: {
        chatRoomId_userId: {
          chatRoomId,
          userId,
        },
      },
      update: {
        lastReadAt: now,
      },
      create: {
        id: randomUUID(),
        chatRoomId,
        userId,
        role: 'OWNER',
        injectGroupHistory: false,
        lastReadAt: now,
      },
    });
  },

  /**
   * 更新群聊中助手的设置（注入群历史等）
   */
  async updateAgentSettings(chatRoomId: string, agentId: string, data: { injectGroupHistory?: boolean }) {
    const chatRoomAgent = await prisma.chatRoomAgent.findFirst({
      where: { chatRoomId, agentId },
    });

    if (!chatRoomAgent) {
      if (shouldEnableRoomHistoryByDefault(agentId)) {
        return prisma.chatRoomAgent.create({
          data: {
            id: randomUUID(),
            chatRoomId,
            agentId,
            role: 'MEMBER',
            injectGroupHistory: data.injectGroupHistory ?? true,
          },
          include: agentInclude,
        });
      }
      throw new Error('该助手不在群聊中');
    }

    return prisma.chatRoomAgent.update({
      where: { id: chatRoomAgent.id },
      data,
      include: agentInclude,
    });
  },

  /**
   * 根据 ChatRoomAgent ID 查询群聊助手关系
   */
  async findAgentById(id: string) {
    return prisma.chatRoomAgent.findUnique({
      where: { id },
      include: agentInclude,
    });
  },

  /**
   * 获取用户在某个群聊的未读消息数
   */
  async getUnreadCount(chatRoomId: string, userId: string): Promise<number> {
    // 获取用户的最后阅读时间
    const chatRoomAgent = await prisma.chatRoomAgent.findUnique({
      where: {
        chatRoomId_userId: {
          chatRoomId,
          userId,
        },
      },
      select: {
        lastReadAt: true,
      },
    });

    if (!chatRoomAgent) {
      return 0;
    }

    // 统计 lastReadAt 之后的消息数量
    // 排除用户自己发的消息（isHuman = true 且 userId = 当前用户）
    // agent 发送的消息（userId = null）应该计入未读
    const count = await prisma.message.count({
      where: {
        chatRoomId,
        archiveId: null,
        time: {
          gt: chatRoomAgent.lastReadAt,
        },
        OR: [
          // agent 发送的消息（userId 为 null）
          { userId: null },
          // 其他用户发送的消息
          { userId: { not: userId } },
        ],
      },
    });

    return count;
  },

  /**
   * 获取用户所有群聊的未读消息数
   */
  async getAllUnreadCounts(userId: string): Promise<Record<string, number>> {
    // 获取用户所在的所有群聊及其最后阅读时间
    const chatRoomAgents = await prisma.chatRoomAgent.findMany({
      where: {
        userId,
      },
      select: {
        chatRoomId: true,
        lastReadAt: true,
      },
    });

    // 并行获取每个群聊的未读数
    const unreadCounts = await Promise.all(
      chatRoomAgents.map(async (agent) => {
        const count = await prisma.message.count({
          where: {
            chatRoomId: agent.chatRoomId,
            archiveId: null,
            time: {
              gt: agent.lastReadAt,
            },
            OR: [
              // agent 发送的消息（userId 为 null）
              { userId: null },
              // 其他用户发送的消息
              { userId: { not: userId } },
            ],
          },
        });
        return {
          chatRoomId: agent.chatRoomId,
          count,
        };
      })
    );

    // 转换为 Record 格式
    return unreadCounts.reduce(
      (acc, { chatRoomId, count }) => {
        acc[chatRoomId] = count;
        return acc;
      },
      {} as Record<string, number>
    );
  },

  /**
   * 创建快速对话临时群聊
   * 自动创建临时群聊并添加用户和助手为成员
   */
  async createQuickChatRoom(agentId: string, userId: string, workDir?: string) {
    const agent = await agentService.findById(agentId);
    if (!agent) {
      throw new Error(`找不到 ID 为 ${agentId} 的助手`);
    }

    // 快速对话群聊直接使用助手名称
    const roomName = agent.name;
    const now = new Date();

    // 创建临时群聊，使用助手的图标和颜色
    const chatRoom = await prisma.chatRoom.create({
      data: {
        id: randomUUID(),
        name: roomName,
        avatar: agent.avatar,
        avatarColor: agent.avatarColor,
        workDir: workDir?.trim() || null,
        isQuickChatRoom: true,
        quickChatAgentId: agentId,
        ownerId: userId,
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    // 确保工作目录存在
    ensureWorkDirExists(chatRoom.id, workDir);

    // 添加用户为成员（OWNER 角色）
    await prisma.chatRoomAgent.create({
      data: {
        id: randomUUID(),
        chatRoomId: chatRoom.id,
        userId,
        role: 'OWNER',
        injectGroupHistory: false,
      },
    });

    // 添加助手为成员（MEMBER 角色）
    await prisma.chatRoomAgent.create({
      data: {
        id: randomUUID(),
        chatRoomId: chatRoom.id,
        agentId,
        role: 'MEMBER',
        injectGroupHistory: false,  // 快速对话默认不注入群历史
      },
    });

    // 返回更新后的群聊
    const result = await prisma.chatRoom.findUnique({
      where: { id: chatRoom.id },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!result) return null;
    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  /**
   * 获取用户的快速对话群聊列表
   */
  async getQuickChatRooms(userId: string) {
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        isQuickChatRoom: true,
        chatRoomAgents: {
          some: { userId },
        },
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const systemAgents = await getSystemAgents();
    return chatRooms.map((chatRoom) => addVirtualSystemAgents(syncQuickChatRoomAvatar(chatRoom), systemAgents));
  },

  /**
   * 更新群聊中助手的上次注入位置（用于增量注入）
   * @param messageId 新的消息 ID，传入 null 清空上次注入位置
   */
  async updateLastInjectedMessageId(chatRoomId: string, agentId: string, messageId: string | null) {
    const chatRoomAgent = await prisma.chatRoomAgent.findFirst({
      where: { chatRoomId, agentId },
    });

    if (!chatRoomAgent) {
      throw new Error('该助手不在群聊中');
    }

    return prisma.chatRoomAgent.update({
      where: { id: chatRoomAgent.id },
      data: { lastInjectedMessageId: messageId },
    });
  },

  /**
   * 置顶群聊
   */
  async pin(id: string) {
    const now = new Date();
    const result = await prisma.chatRoom.update({
      where: { id },
      data: {
        isPinned: true,
        pinnedAt: now,
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  /**
   * 取消置顶群聊
   */
  async unpin(id: string) {
    const now = new Date();
    const result = await prisma.chatRoom.update({
      where: { id },
      data: {
        isPinned: false,
        pinnedAt: null,
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  /**
   * 折叠群聊（折叠时自动取消置顶，置顶与折叠互斥）
   */
  async collapse(id: string) {
    const now = new Date();
    const result = await prisma.chatRoom.update({
      where: { id },
      data: {
        isCollapsed: true,
        collapsedAt: now,
        isPinned: false,
        pinnedAt: null,
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },

  /**
   * 取消折叠群聊
   */
  async uncollapse(id: string) {
    const now = new Date();
    const result = await prisma.chatRoom.update({
      where: { id },
      data: {
        isCollapsed: false,
        collapsedAt: null,
        updatedAt: now,
      },
      include: {
        chatRoomAgents: {
          include: agentInclude,
        },
        owner: {
          select: {
            id: true,
            username: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const systemAgents = await getSystemAgents();
    return addVirtualSystemAgents(result, systemAgents);
  },
};
