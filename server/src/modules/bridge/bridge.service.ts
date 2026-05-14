import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma.js';
import { messageEventEmitter } from '../../core/agent/agent-handler/index.js';
import { registerTypingLoopSender } from './typing-loop.js';
import type { Message } from '../../types/message.js';
import { messageService } from '../message/message.service.js';
import { getBridgePlatformDefinition } from './bridge-platform-registry.js';
import { decrypt } from './crypto.js';
import {
  bindBridgeBotToChatRoom,
  createBridgeBot,
  deleteBridgeBot,
  getBridgeBotById,
  listBridgeBots,
  unbindBridgeBot,
  updateBridgeBot,
} from './bridge-bot-store.js';

export type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';

// Dedupe key: TTL based with map-backed eviction. Keys are namespaced by botId.
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const dedupeKeys = new Map<string, number>();

function addDedupeKey(key: string): void {
  if (dedupeKeys.size > 10000) {
    const now = Date.now();
    for (const [k, exp] of dedupeKeys) {
      if (exp < now) dedupeKeys.delete(k);
      if (dedupeKeys.size <= 5000) break;
    }
  }
  dedupeKeys.set(key, Date.now() + DEDUPE_TTL_MS);
}

function hasDedupeKey(key: string): boolean {
  const exp = dedupeKeys.get(key);
  if (exp === undefined) return false;
  if (exp < Date.now()) {
    dedupeKeys.delete(key);
    return false;
  }
  return true;
}

const platformSenders = new Map<string, (botId: string, externalId: string, text: string, agentName: string) => Promise<void>>();
const platformTypingSenders = new Map<string, (botId: string, externalId: string) => Promise<void>>();

const SOURCE_CHANNEL_TTL_MS = 30 * 60 * 1000;
const BRIDGE_EVENT_RETENTION_DAYS = parseInt(process.env.BRIDGE_EVENT_RETENTION_DAYS ?? '20', 10) || 20;

type SourceConversation = { chatRoomId: string; botId: string; platform: Platform; externalId: string; replyTarget: string; expiresAt: number };
const lastSourceConversation = new Map<string, SourceConversation>();

function sourceKey(botId: string, externalId: string): string {
  return `${botId}:${externalId}`;
}

function setSourceConversation(chatRoomId: string, botId: string, platform: Platform, externalId: string, replyTarget: string) {
  lastSourceConversation.set(sourceKey(botId, externalId), {
    chatRoomId,
    botId,
    platform,
    externalId,
    replyTarget,
    expiresAt: Date.now() + SOURCE_CHANNEL_TTL_MS,
  });
}

function getSourceConversation(botId: string, externalId?: string, chatRoomId?: string) {
  // 没有 externalId 时，返回该 botId 任一最新有效会话（向后兼容）
  if (!externalId) {
    let latest: SourceConversation | null = null;
    for (const [k, entry] of lastSourceConversation) {
      if (!k.startsWith(`${botId}:`)) continue;
      if (Date.now() > entry.expiresAt) {
        lastSourceConversation.delete(k);
        continue;
      }
      if (chatRoomId && entry.chatRoomId !== chatRoomId) {
        continue;
      }
      if (!latest || entry.expiresAt > latest.expiresAt) latest = entry;
    }
    return latest;
  }
  const entry = lastSourceConversation.get(sourceKey(botId, externalId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    lastSourceConversation.delete(sourceKey(botId, externalId));
    return null;
  }
  return entry;
}

// Periodic cleanup of old bridge events (replaces per-write delete).
const bridgeEventCleanupInterval = setInterval(async () => {
  const cutoff = new Date(Date.now() - BRIDGE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.bridgeEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
}, 60 * 60 * 1000);
bridgeEventCleanupInterval.unref?.();

async function validateBridgeCredentials(platform: Platform, body: { botToken?: string; config?: Record<string, unknown> | null }) {
  if (platform === 'telegram') {
    const token = body.botToken?.trim();
    if (!token) return;

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`).catch(() => null);
    if (!response?.ok) {
      throw new Error('Telegram 机器人不存在或 Token 无效');
    }

    const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
    if (!payload?.ok) {
      throw new Error('Telegram 机器人不存在或 Token 无效');
    }
  }

  if (platform === 'feishu') {
    const appId = typeof body.config?.appId === 'string' ? body.config.appId.trim() : '';
    const appSecret = typeof body.config?.appSecret === 'string' ? body.config.appSecret.trim() : '';
    if (!appId || !appSecret) return;

    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    }).catch(() => null);

    if (!response?.ok) {
      throw new Error('飞书机器人不存在或凭证无效');
    }

    const payload = await response.json().catch(() => null) as { code?: number; tenant_access_token?: string } | null;
    if (payload?.code !== 0 || !payload.tenant_access_token) {
      throw new Error('飞书机器人不存在或凭证无效');
    }
  }
}

async function getActiveBridgeTargets(chatRoomId: string) {
  const bots = await prisma.bridgeBot.findMany({
    where: { chatRoomId, enabled: true },
    include: {
      chatRoom: { select: { id: true, name: true, defaultAgentId: true } },
      defaultAgent: { select: { id: true, name: true, avatar: true, avatarColor: true } },
    },
  });
  return bots
    .map((bot) => {
      const source = getSourceConversation(bot.id, undefined, chatRoomId);
      if (!source) return null;
      return { bot, source };
    })
    .filter((item): item is { bot: (typeof bots)[number]; source: NonNullable<ReturnType<typeof getSourceConversation>> } => !!item);
}

async function createBridgeEvent(data: {
  platform: string;
  externalId: string;
  direction: string;
  status: string;
  messageId?: string | null;
  contentPreview?: string | null;
  agentName?: string | null;
  errorMsg?: string | null;
}) {
  const cutoff = new Date(Date.now() - BRIDGE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.bridgeEvent.deleteMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  return prisma.bridgeEvent.create({
    data: {
      ...data,
      contentPreview: data.contentPreview ?? null,
      messageId: data.messageId ?? null,
      agentName: data.agentName ?? null,
      errorMsg: data.errorMsg ?? null,
    },
  });
}

export const bridgeService = {
  async createBot(data: {
    platform: Platform;
    name: string;
    botToken?: string;
    defaultAgentId?: string | null;
    config?: Record<string, unknown>;
    chatRoomId?: string;
    ownerId?: string;
  }) {
    const definition = getBridgePlatformDefinition(data.platform);
    const missingFields = definition.configFields
      .filter((field) => {
        if (field.key === 'botToken') {
          return !data.botToken?.trim();
        }
        const value = data.config?.[field.key];
        return typeof value !== 'string' || !value.trim();
      })
      .map((field) => field.label);

    if (missingFields.length > 0) {
      throw new Error(`缺少必填凭证：${missingFields.join('、')}`);
    }

    await validateBridgeCredentials(data.platform, {
      botToken: data.botToken,
      config: data.config ?? null,
    });

    const bot = await createBridgeBot(data);
    if (data.chatRoomId) {
      return bindBridgeBotToChatRoom(bot.id, data.chatRoomId);
    }
    return bot;
  },

  async listBots(platform?: Platform) {
    return listBridgeBots(platform);
  },

  async updateBot(id: string, data: {
    name?: string;
    botToken?: string;
    defaultAgentId?: string | null;
    config?: Record<string, unknown> | null;
    enabled?: boolean;
  }) {
    const existing = await getBridgeBotById(id);
    if (!existing) {
      throw new Error('机器人实例不存在');
    }

    const needsValidation = data.botToken !== undefined || data.config !== undefined;
    if (needsValidation) {
      const existingDecrypted = existing.botToken ? decrypt(existing.botToken) : undefined;
      const existingConfig = existing.config ? (() => { try { return JSON.parse(decrypt(existing.config!)); } catch { return undefined; } })() : undefined;
      const mergedToken = data.botToken ?? existingDecrypted;
      const mergedConfig = data.config !== undefined ? { ...existingConfig, ...data.config } : existingConfig;
      await validateBridgeCredentials(existing.platform as Platform, {
        botToken: mergedToken,
        config: mergedConfig ?? null,
      });
    }

    return updateBridgeBot(id, data);
  },

  async deleteBot(id: string) {
    return deleteBridgeBot(id);
  },

  async bindBot(botId: string, chatRoomId: string, options?: { forceRebind?: boolean }) {
    return bindBridgeBotToChatRoom(botId, chatRoomId, options);
  },

  async unbindBot(botId: string) {
    return unbindBridgeBot(botId);
  },

  async listChannels(platform?: Platform) {
    const bots = await listBridgeBots(platform);
    return bots.filter((bot) => bot.chatRoomId);
  },

  async updateChannel(id: string, data: {
    enabled?: boolean;
  }) {
    return updateBridgeBot(id, { enabled: data.enabled });
  },

  async deleteChannel(id: string) {
    return unbindBridgeBot(id);
  },

  async receiveBridgeMessage(params: {
    botId?: string;
    platform: Platform;
    externalId: string;
    replyTarget?: string;
    senderName: string;
    content: string;
    dedupeKey?: string;
  }) {
    if (params.dedupeKey) {
      if (hasDedupeKey(params.dedupeKey)) {
        console.info(`[Bridge] 重复消息已过滤: ${params.dedupeKey}`);
        return null;
      }
      addDedupeKey(params.dedupeKey);
    }

    const binding = params.botId
      ? await getBridgeBotById(params.botId)
      : (await listBridgeBots(params.platform)).find((bot) => bot.chatRoomId && bot.enabled) ?? null;
    if (!binding?.chatRoomId || !binding.enabled || !binding.chatRoom) {
      return null;
    }

    const { chatRoomId } = binding;
    setSourceConversation(chatRoomId, binding.id, params.platform, params.externalId, params.replyTarget ?? params.externalId);

    const platformLabel: Record<Platform, string> = {
      telegram: 'TG',
      feishu: '飞书',
      dingtalk: '钉钉',
      wecom: '企微',
      qq: 'QQ',
    };
    const prefixedContent = `[${platformLabel[params.platform]}·${params.senderName}] ${params.content}`;

    // Sanitize external content for routing: strip @ mentions to prevent injection
    const hasAgentMention = /@\S+/.test(params.content);
    const roomAgents = !binding.chatRoom.defaultAgentId
      ? await prisma.chatRoomAgent.findMany({
          where: {
            chatRoomId,
            agentId: { not: null },
            agent: { is: { isActive: true } },
          },
          include: {
            agent: {
              select: { id: true, name: true },
            },
          },
          orderBy: { joinedAt: 'asc' },
          take: 2,
        })
      : [];

    const fallbackDefaultAgentId = binding.chatRoom.defaultAgentId
      || (roomAgents.length === 1 ? roomAgents[0]?.agentId ?? null : null);
    const defaultAgent = fallbackDefaultAgentId
      ? await prisma.agent.findUnique({ where: { id: fallbackDefaultAgentId } })
      : null;

    const finalContent = !hasAgentMention && defaultAgent
      ? `${prefixedContent} @${defaultAgent.name}`
      : prefixedContent;

    const msgId = randomUUID();
    const now = new Date();
    const savedMsg = await messageService.create({
      id: msgId,
      type: 'MESSAGE',
      content: finalContent,
      time: now,
      userId: null,
      chatRoomId,
      isHuman: true,
    });

    const msgWithUser: Message = {
      id: savedMsg.id,
      type: 'message',
      content: savedMsg.content,
      time: now,
      user: params.senderName,
      userId: savedMsg.userId,
      chatRoomId,
      isHuman: true,
    };
    messageEventEmitter.emit('receivedMessage', { message: msgWithUser, chatRoomId });

    await createBridgeEvent({
      platform: params.platform,
      externalId: params.externalId,
      direction: 'inbound',
      status: 'success',
      messageId: msgId,
      contentPreview: finalContent.slice(0, 280),
    }).catch((error) => console.error('[Bridge] 写入 inbound success 事件失败:', error));

    return { messageId: msgId, chatRoomId, channelId: binding.id };
  },

  registerSender(platform: Platform, sender: (botId: string, externalId: string, text: string, agentName: string) => Promise<void>) {
    platformSenders.set(platform, sender);
  },

  registerTypingSender(platform: Platform, sender: (botId: string, externalId: string) => Promise<void>) {
    platformTypingSenders.set(platform, sender);
  },

  async syncRoomMessage(chatRoomId: string, senderName: string, content: string, messageId?: string) {
    const targets = await getActiveBridgeTargets(chatRoomId);
    if (targets.length === 0) return;

    const text = `[群聊·${senderName}] ${content}`;
    await Promise.all(targets.map(async ({ bot, source }) => {
      const sender = platformSenders.get(bot.platform);
      if (!sender) return;
      await sender(bot.id, source.replyTarget, text, senderName);
      await createBridgeEvent({
        platform: bot.platform,
        externalId: source.externalId,
        direction: 'outbound',
        status: 'success',
        messageId: messageId ?? null,
        contentPreview: text.slice(0, 280),
        agentName: senderName,
      });
    }));
  },

  async sendTypingIndicator(chatRoomId: string) {
    const targets = await getActiveBridgeTargets(chatRoomId);
    if (targets.length === 0) return;

    await Promise.all(targets.map(async ({ bot, source }) => {
      const sender = platformTypingSenders.get(bot.platform);
      if (!sender) return;
      await sender(bot.id, source.replyTarget);
    }));
  },


  async sendAgentResponse(chatRoomId: string, agentName: string, content: string, messageId?: string) {
    const targets = await getActiveBridgeTargets(chatRoomId);
    if (targets.length === 0) return;

    await Promise.all(targets.map(async ({ bot, source }) => {
      const sender = platformSenders.get(bot.platform);
      if (!sender) return;

      try {
        await sender(source.botId, source.replyTarget, content, agentName);
        await createBridgeEvent({
          platform: bot.platform,
          externalId: source.externalId,
          direction: 'outbound',
          status: 'success',
          messageId: messageId ?? null,
          contentPreview: content.slice(0, 280),
          agentName,
        });
      } catch (error) {
        console.error(`[Bridge] 发送响应到 ${bot.platform} 会话 ${source.externalId} 失败:`, error);
        await createBridgeEvent({
          platform: bot.platform,
          externalId: source.externalId,
          direction: 'outbound',
          status: 'failed',
          messageId: messageId ?? null,
          contentPreview: content.slice(0, 280),
          agentName,
          errorMsg: error instanceof Error ? error.message : String(error),
        }).catch((eventError) => console.error('[Bridge] 写入 outbound failed 事件失败:', eventError));
      }
    }));
  },
};

// 把 sendTypingIndicator 注册给 typing-loop 模块（避免循环依赖）
registerTypingLoopSender((chatRoomId) => bridgeService.sendTypingIndicator(chatRoomId));
