import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma.js';
import { messageService } from '../message/message.service.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import { messageEventEmitter } from '../../core/agent/agent-handler/index.js';
import { encrypt, decrypt } from './crypto.js';

function decryptChannel<T extends { botToken?: string | null; webhookSecret?: string | null; config?: string | null }>(ch: T): T {
  if (ch.botToken) ch.botToken = decrypt(ch.botToken);
  if (ch.webhookSecret) ch.webhookSecret = decrypt(ch.webhookSecret);
  if (ch.config) ch.config = decrypt(ch.config);
  return ch;
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

async function telegramSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'telegram', externalId, enabled: true },
  });
  if (!channel?.botToken) return;

  const botToken = decrypt(channel.botToken);
  const formattedText = `[${agentName}] ${text}`;
  const chunks = splitMessage(formattedText, 4096);

  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: externalId, text: chunk }),
    });
  }
}

export type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';

// 平台响应回调，由各平台适配器注册
const platformSenders = new Map<string, (externalId: string, text: string, agentName: string) => Promise<void>>();

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
      include: { chatRoom: { select: { id: true, name: true } }, defaultAgent: { select: { id: true, name: true } } },
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
  }) {
    const channel = await this.findChannelByExternal(params.platform, params.externalId);
    if (!channel || !channel.enabled) return null;

    const { chatRoomId } = channel;

    // 内容前缀标注来源，让 Agent 知道是谁发的
    const platformLabel: Record<Platform, string> = {
      telegram: 'TG', feishu: '飞书', dingtalk: '钉钉', wecom: '企微', qq: 'QQ',
    };
    const prefixedContent = `[${platformLabel[params.platform as Platform]}·${params.senderName}] ${params.content}`;

    // 若内容未 @ 任何 Agent，自动注入默认 Agent
    const hasAgentMention = /@\S+/.test(params.content);
    const defaultAgent = channel.defaultAgent ?? channel.chatRoom.defaultAgentId
      ? await prisma.agent.findUnique({ where: { id: channel.chatRoom.defaultAgentId! } })
      : null;

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

    return { messageId: msgId, chatRoomId };
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
   */
  async sendAgentResponse(chatRoomId: string, agentName: string, content: string) {
    const channels = await prisma.externalChannel.findMany({
      where: { chatRoomId, enabled: true },
    });

    for (const channel of channels) {
      const sender = platformSenders.get(channel.platform as Platform);
      if (!sender) continue;
      try {
        await sender(channel.externalId, content, agentName);
      } catch (err) {
        console.error(`[Bridge] 发送响应到 ${channel.platform} 群 ${channel.externalId} 失败:`, err);
      }
    }
  },

  // ──────────────── 房间自动创建 ────────────────

  /**
   * Bot 被拉入新群时，自动创建 TeamAgentX ChatRoom 并绑定频道
   */
  async autoCreateRoom(params: {
    platform: Platform;
    externalId: string;
    groupName: string;
    botToken?: string;
    webhookSecret?: string;
    defaultAgentId?: string;
    config?: Record<string, unknown>;
  }) {
    // 幂等：若已存在则直接返回
    const existing = await this.findChannelByExternal(params.platform, params.externalId);
    if (existing) return existing;

    const room = await chatRoomService.create({
      name: params.groupName,
      description: `来自 ${params.platform} 的外部群聊`,
    });

    if (!room) throw new Error(`创建 ChatRoom 失败：${params.groupName}`);

    // 若有默认 Agent，加入群聊
    if (params.defaultAgentId) {
      await chatRoomService.addAgent({ chatRoomId: room.id, agentId: params.defaultAgentId });
    }

    return this.createChannel({
      platform: params.platform,
      externalId: params.externalId,
      chatRoomId: room.id,
      botToken: params.botToken,
      webhookSecret: params.webhookSecret,
      defaultAgentId: params.defaultAgentId,
      config: params.config,
    });
  },
};

// 注册 Telegram 发送器
bridgeService.registerSender('telegram', telegramSend);
