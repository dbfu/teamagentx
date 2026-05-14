import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { encrypt, decrypt } from './crypto.js';
import type { Platform } from './bridge.service.js';

function computeCredentialHash(
  platform: Platform,
  botToken?: string,
  config?: Record<string, unknown>,
): string {
  const parts: string[] = [`platform=${platform}`];
  if (botToken) parts.push(`botToken=${botToken}`);
  if (config) {
    for (const key of Object.keys(config).sort()) {
      const value = config[key];
      const serialized = value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
      parts.push(`${key}=${serialized}`);
    }
  }
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export interface CreateBridgeBotInput {
  platform: Platform;
  name: string;
  botToken?: string;
  defaultAgentId?: string | null;
  config?: Record<string, unknown>;
  ownerId?: string;
}

export interface UpdateBridgeBotInput {
  name?: string;
  botToken?: string;
  defaultAgentId?: string | null;
  config?: Record<string, unknown> | null;
  enabled?: boolean;
}

export async function createBridgeBot(input: CreateBridgeBotInput) {
  const credentialHash = computeCredentialHash(input.platform, input.botToken, input.config);

  try {
    return await prisma.$transaction(async (tx) => {
      // 先查有 hash 的记录
      let existing = await tx.bridgeBot.findFirst({
        where: { platform: input.platform, credentialHash },
        select: { id: true },
      });

      // 兜底：查无 hash 的旧记录，回填并比对
      if (!existing) {
        const nullHashBots = await tx.bridgeBot.findMany({
          where: { platform: input.platform, credentialHash: null },
          select: { id: true, botToken: true, config: true },
        });
        for (const bot of nullHashBots) {
          const existingHash = computeCredentialHash(
            input.platform,
            bot.botToken ? decrypt(bot.botToken) : undefined,
            bot.config ? (() => { try { return JSON.parse(decrypt(bot.config!)); } catch { return undefined; } })() : undefined,
          );
          await tx.bridgeBot.update({ where: { id: bot.id }, data: { credentialHash: existingHash } }).catch(() => {});
          if (existingHash === credentialHash) {
            existing = { id: bot.id };
            break;
          }
        }
      }

      if (existing) {
        throw Object.assign(new Error('相同凭证已存在'), {
          code: 'DUPLICATE_CREDENTIAL',
          existingBotId: existing.id,
        });
      }

      return tx.bridgeBot.create({
        data: {
          platform: input.platform,
          name: input.name.trim(),
          botToken: input.botToken ? encrypt(input.botToken) : null,
          config: input.config ? encrypt(JSON.stringify(input.config)) : null,
          credentialHash,
          defaultAgentId: input.defaultAgentId || null,
          ownerId: input.ownerId ?? null,
          updatedAt: new Date(),
        },
        include: {
          chatRoom: {
            select: { id: true, name: true, defaultAgentId: true },
          },
          defaultAgent: {
            select: { id: true, name: true, avatar: true, avatarColor: true },
          },
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.bridgeBot.findFirst({
        where: { platform: input.platform, credentialHash },
        select: { id: true },
      });
      throw Object.assign(new Error('相同凭证已存在'), {
        code: 'DUPLICATE_CREDENTIAL',
        existingBotId: existing?.id,
      });
    }
    throw err;
  }
}

export async function listBridgeBots(
  params?: Platform | { platform?: Platform; ownerId?: string },
) {
  const normalized = typeof params === 'string' ? { platform: params } : (params ?? {});
  const where: Prisma.BridgeBotWhereInput = {};
  if (normalized.platform) where.platform = normalized.platform;
  if (normalized.ownerId) where.ownerId = normalized.ownerId;

  return prisma.bridgeBot.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });
}

export async function getBridgeBotById(id: string) {
  return prisma.bridgeBot.findUnique({
    where: { id },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function getBridgeBotByChatRoom(chatRoomId: string) {
  return prisma.bridgeBot.findFirst({
    where: { chatRoomId },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function updateBridgeBot(id: string, input: UpdateBridgeBotInput) {
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) {
    data.name = input.name.trim();
  }
  if (input.botToken !== undefined) {
    data.botToken = input.botToken ? encrypt(input.botToken) : null;
  }
  if (input.config !== undefined) {
    data.config = input.config ? encrypt(JSON.stringify(input.config)) : null;
  }
  if ('defaultAgentId' in input) {
    data.defaultAgentId = input.defaultAgentId || null;
  }
  if (input.enabled !== undefined) {
    data.enabled = input.enabled;
  }

  // 凭证变更时同步更新 credentialHash
  if (input.botToken !== undefined || input.config !== undefined) {
    const existing = await prisma.bridgeBot.findUnique({
      where: { id },
      select: { platform: true, botToken: true, config: true },
    });
    if (existing) {
      const newToken = input.botToken !== undefined ? input.botToken : (existing.botToken ? decrypt(existing.botToken) : undefined);
      const newConfig = input.config !== undefined
        ? input.config
        : (existing.config ? (() => { try { return JSON.parse(decrypt(existing.config!)); } catch { return undefined; } })() : undefined);
      data.credentialHash = computeCredentialHash(existing.platform as Platform, newToken, newConfig);
    }
  }

  return prisma.bridgeBot.update({
    where: { id },
    data,
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function bindBridgeBotToChatRoom(
  botId: string,
  chatRoomId: string,
  options?: { forceRebind?: boolean },
) {
  const bot = await prisma.bridgeBot.findUnique({
    where: { id: botId },
    select: { id: true, chatRoomId: true },
  });
  if (!bot) {
    throw new Error('机器人实例不存在');
  }

  if (bot.chatRoomId && bot.chatRoomId !== chatRoomId && !options?.forceRebind) {
    throw new Error('该机器人已绑定到其他群聊');
  }

  return prisma.bridgeBot.update({
    where: { id: botId },
    data: {
      chatRoomId,
      enabled: true,
    },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function unbindBridgeBot(botId: string) {
  return prisma.bridgeBot.update({
    where: { id: botId },
    data: { chatRoomId: null },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function deleteBridgeBot(botId: string) {
  return prisma.bridgeBot.delete({
    where: { id: botId },
  });
}

export async function hasBridgeBotCredentials(botId: string) {
  const bot = await prisma.bridgeBot.findUnique({
    where: { id: botId },
    select: { botToken: true, config: true },
  });
  if (!bot) return false;
  return !!(bot.botToken || bot.config);
}
