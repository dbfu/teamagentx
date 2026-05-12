import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma.js';
import { messageService } from '../message/message.service.js';
import { messageEventEmitter } from '../../core/agent/agent-handler/index.js';
import { encrypt, decrypt } from './crypto.js';

function decryptChannel<T extends { botToken?: string | null; webhookSecret?: string | null; config?: string | null }>(ch: T): T {
  if (ch.botToken) ch.botToken = decrypt(ch.botToken);
  if (ch.webhookSecret) ch.webhookSecret = decrypt(ch.webhookSecret);
  if (ch.config) ch.config = decrypt(ch.config);
  return ch;
}

export type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';

// 去重 Set，防止重复消息被多次处理
const seenDedupeKeys = new Set<string>();

// 平台响应回调，由各平台适配器注册
const platformSenders = new Map<string, (externalId: string, text: string, agentName: string) => Promise<void>>();

// 记录"最近一次触发该房间的来源 channel"，用于防串音
// key = chatRoomId, value = { channelId, expiresAt }
const lastSourceChannel = new Map<string, { channelId: string; expiresAt: number }>();
const SOURCE_CHANNEL_TTL_MS = 30 * 60 * 1000; // 30 分钟

function setSourceChannel(chatRoomId: string, channelId: string) {
  lastSourceChannel.set(chatRoomId, { channelId, expiresAt: Date.now() + SOURCE_CHANNEL_TTL_MS });
}

function getSourceChannelId(chatRoomId: string): string | null {
  const entry = lastSourceChannel.get(chatRoomId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    lastSourceChannel.delete(chatRoomId);
    return null;
  }
  return entry.channelId;
}

export const bridgeService = {
  // ──────────────── ExternalChannel CRUD ────────────────

  async createChannel(data: {
    platform: Platform;
    externalId: string;
    chatRoomId: string;
    botToken?: string;
    webhookSecret?: string;
    defaultAgentId?: string;
    config?: Record<string, unknown>;
  }) {
    return prisma.externalChannel.create({
      data: {
        platform: data.platform,
        externalId: data.externalId,
        chatRoomId: data.chatRoomId,
        botToken: data.botToken ? encrypt(data.botToken) : undefined,
        webhookSecret: data.webhookSecret ? encrypt(data.webhookSecret) : undefined,
        defaultAgentId: data.defaultAgentId,
        config: data.config ? encrypt(JSON.stringify(data.config)) : undefined,
      },
      include: { chatRoom: true, defaultAgent: true },
    });
  },

  async findChannelByExternal(platform: Platform, externalId: string) {
    const channel = await prisma.externalChannel.findUnique({
      where: { platform_externalId: { platform, externalId } },
      include: { chatRoom: true, defaultAgent: true },
    });
    return channel ? decryptChannel(channel) : null;
  },

  async listChannels(platform?: Platform) {
    const channels = await prisma.externalChannel.findMany({
      where: platform ? { platform } : undefined,
      include: { chatRoom: { select: { id: true, name: true } }, defaultAgent: { select: { id: true, name: true, avatar: true, avatarColor: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return channels.map(decryptChannel);
  },

  async updateChannel(id: string, data: {
    botToken?: string;
    webhookSecret?: string;
    defaultAgentId?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }) {
    return prisma.externalChannel.update({
      where: { id },
      data: {
        ...(data.defaultAgentId !== undefined ? { defaultAgentId: data.defaultAgentId } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        botToken: data.botToken ? encrypt(data.botToken) : data.botToken,
        webhookSecret: data.webhookSecret ? encrypt(data.webhookSecret) : data.webhookSecret,
        config: data.config ? encrypt(JSON.stringify(data.config)) : undefined,
      },
    });
  },

  async deleteChannel(id: string) {
    return prisma.externalChannel.delete({ where: { id } });
  },

  // ──────────────── 消息接入 ────────────────

  /**
   * 外部平台消息进入 TeamAgentX，触发对应 Agent
   * senderName: 发送者昵称（如 "Alice(@alice_tg)"），嵌入消息内容
   * content: 原始消息内容（可含 @agent-name）
   */
  async receiveBridgeMessage(params: {
    platform: Platform;
    externalId: string;   // 平台侧群 ID
    senderName: string;
    content: string;
    dedupeKey?: string;
  }) {
    if (params.dedupeKey) {
      if (seenDedupeKeys.has(params.dedupeKey)) {
        console.info(`[Bridge] 重复消息已过滤: ${params.dedupeKey}`);
        return null;
      }
      seenDedupeKeys.add(params.dedupeKey);
      if (seenDedupeKeys.size > 5000) {
        const oldest = seenDedupeKeys.values().next().value;
        if (oldest) seenDedupeKeys.delete(oldest);
      }
    }

    const channel = await this.findChannelByExternal(params.platform, params.externalId);
    if (!channel || !channel.enabled) return null;

    const { chatRoomId } = channel;

    // 记录本次触发的来源 channel，用于防串音
    setSourceChannel(chatRoomId, channel.id);

    // 内容前缀标注来源，让 Agent 知道是谁发的
    const platformLabel: Record<Platform, string> = {
      telegram: 'TG', feishu: '飞书', dingtalk: '钉钉', wecom: '企微', qq: 'QQ',
    };
    const prefixedContent = `[${platformLabel[params.platform as Platform]}·${params.senderName}] ${params.content}`;

    // 若内容未 @ 任何 Agent，自动注入默认 Agent
    const hasAgentMention = /@\S+/.test(params.content);
    const defaultAgent = channel.defaultAgent
      ?? (channel.chatRoom.defaultAgentId
        ? await prisma.agent.findUnique({ where: { id: channel.chatRoom.defaultAgentId } })
        : null);

    const finalContent = (!hasAgentMention && defaultAgent)
      ? `${prefixedContent} @${defaultAgent.name}`
      : prefixedContent;

    const msgId = randomUUID();
    const now = new Date();

    // 桥接消息无真实 userId，userId 留空
    const savedMsg = await messageService.create({
      id: msgId,
      type: 'MESSAGE',
      content: finalContent,
      time: now,
      userId: null,
      chatRoomId,
      isHuman: true,
    });

    // 触发 Agent 处理（与 Socket.io 路径相同）
    const msgWithUser: import('../../types/message.js').Message = {
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

    // 记录 inbound 事件
    prisma.bridgeEvent.create({
      data: {
        platform: params.platform,
        externalId: params.externalId,
        direction: 'inbound',
        status: 'success',
        messageId: msgId,
      },
    }).catch(e => console.error('[Bridge] 写入 inbound success 事件失败:', e));

    return { messageId: msgId, chatRoomId, channelId: channel.id };
  },

  // ──────────────── 响应回传 ────────────────

  /**
   * 注册某平台的消息发送函数（由各平台 webhook 模块调用）
   */
  registerSender(platform: Platform, sender: (externalId: string, text: string, agentName: string) => Promise<void>) {
    platformSenders.set(platform, sender);
  },

  /**
   * 将 Agent 响应发回对应的外部平台群聊
   * 优先只发回触发本次对话的来源 channel，防止多平台绑定同一房间时串音
   */
  async sendAgentResponse(chatRoomId: string, agentName: string, content: string) {
    const sourceChannelId = getSourceChannelId(chatRoomId);

    const channels = await prisma.externalChannel.findMany({
      where: { chatRoomId, enabled: true },
    });

    // 若能找到来源 channel，只发回那个 channel；否则广播（兼容旧行为）
    const targets = sourceChannelId
      ? channels.filter(c => c.id === sourceChannelId)
      : channels;

    for (const channel of targets) {
      const sender = platformSenders.get(channel.platform as Platform);
      if (!sender) continue;
      try {
        await sender(channel.externalId, content, agentName);
        await prisma.bridgeEvent.create({
          data: {
            platform: channel.platform,
            externalId: channel.externalId,
            direction: 'outbound',
            status: 'success',
            agentName,
          },
        }).catch(e => console.error('[Bridge] 写入 outbound success 事件失败:', e));
      } catch (err) {
        console.error(`[Bridge] 发送响应到 ${channel.platform} 群 ${channel.externalId} 失败:`, err);
        prisma.bridgeEvent.create({
          data: {
            platform: channel.platform,
            externalId: channel.externalId,
            direction: 'outbound',
            status: 'failed',
            agentName,
            errorMsg: err instanceof Error ? err.message : String(err),
          },
        }).catch(e => console.error('[Bridge] 写入 outbound failed 事件失败:', e));
      }
    }
  },
};
