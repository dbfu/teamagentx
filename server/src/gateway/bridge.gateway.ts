import { FastifyInstance } from 'fastify';
import { bridgeService, Platform } from '../modules/bridge/bridge.service.js';
import { config } from '../config/index.js';
import { verifyTelegram, verifyFeishu, verifyDingtalk, verifyWecom } from '../modules/bridge/webhook-verify.js';
import { decryptWecomMessage } from '../modules/bridge/wecom-crypto.js';
import { decrypt, encrypt } from '../modules/bridge/crypto.js';
import prisma from '../lib/prisma.js';

// 入站消息去重 Set，防止 webhook 重投导致重复处理
const processedMessages = new Set<string>();

// 绑定码 map：key = 8位码, value = { platform, chatRoomId, expiresAt }
const bindCodes = new Map<string, { platform: string; chatRoomId: string; expiresAt: number }>();

function cleanExpiredBindCodes() {
  const now = Date.now();
  for (const [code, v] of bindCodes) {
    if (now > v.expiresAt) bindCodes.delete(code);
  }
}

// ──────────────── 通用绑定码处理 ────────────────

async function handleBindCode(
  platform: string,
  externalId: string,
  _groupName: string,
  code: string,
  sendReply: (text: string) => Promise<void>,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): Promise<boolean> {
  const pending = bindCodes.get(code);
  if (!pending || Date.now() > pending.expiresAt) return false;
  if (pending.platform !== platform) return false;
  bindCodes.delete(code);
  const platformCfg = await prisma.platformConfig.findUnique({ where: { platform } });
  const botToken = platformCfg?.botToken ? decrypt(platformCfg.botToken) : undefined;
  try {
    await bridgeService.createChannel({
      platform: platform as Platform,
      externalId,
      chatRoomId: pending.chatRoomId,
      botToken,
      defaultAgentId: platformCfg?.defaultAgentId ?? undefined,
    });
    log.info({ platform, externalId, chatRoomId: pending.chatRoomId }, '[Bridge] 绑定码绑定成功');
    await sendReply('✅ 已与 TeamAgentX 群聊绑定！\n发消息即可触发 AI 助手。').catch(() => {});
  } catch (err) {
    log.error({ err, platform, externalId }, '[Bridge] 绑定码绑定失败');
    await sendReply('❌ 绑定失败，请重新获取绑定码重试。').catch(() => {});
  }
  return true;
}

// ──────────────── Telegram 消息处理（webhook / polling 共用）────────────────

type TelegramMessage = {
  message_id?: number;
  from?: { first_name?: string; username?: string; id?: number };
  chat?: { id?: number; title?: string; type?: string };
  text?: string;
  entities?: { type: string; offset: number; length: number }[];
  new_chat_members?: { id: number; is_bot?: boolean }[];
};

async function handleTelegramMessage(msg: TelegramMessage, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  if (!msg.chat?.id) return;

  // 入站消息去重
  const telegramMsgKey = `telegram:${String(msg.message_id ?? '')}`;
  if (msg.message_id != null) {
    if (processedMessages.has(telegramMsgKey)) return;
    if (processedMessages.size >= 10000) processedMessages.clear();
    processedMessages.add(telegramMsgKey);
  }

  const externalId = String(msg.chat.id);

  if (!msg.text) return;

  // 处理 /bind CODE 命令——私聊和群聊都可能收到
  const bindMatch = msg.text.match(/^\/bind\s+([A-Z0-9]{6,12})$/i);
  if (bindMatch) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'telegram' } });
    const botToken = platformCfg?.botToken ? decrypt(platformCfg.botToken) : undefined;
    const sendReply = async (text: string) => {
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: externalId, text }),
      });
    };
    await handleBindCode('telegram', externalId, msg.chat.title ?? `Telegram 群 ${externalId}`, bindMatch[1].toUpperCase(), sendReply, log);
    return;
  }

  // 只处理群组消息
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;

  const channel = await prisma.externalChannel.findFirst({ where: { platform: 'telegram', externalId } });
  if (!channel) return; // 未绑定，静默忽略

  const senderName = msg.from?.username
    ? `${msg.from.first_name ?? ''}(@${msg.from.username})`
    : (msg.from?.first_name ?? '未知用户');

  const content = msg.text.replace(/^@\S+\s*/, '').trim();
  if (!content) return;

  await bridgeService.receiveBridgeMessage({
    platform: 'telegram',
    externalId,
    senderName,
    content,
  });
}

// ──────────────── Telegram Polling（本地开发 / 无公网时使用）────────────────

let telegramPollingOffset = 0;
let telegramPollingTimer: ReturnType<typeof setTimeout> | null = null;

async function telegramPollOnce(token: string, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${telegramPollingOffset}&timeout=0&allowed_updates=["message"]`,
    );
    const data = await res.json() as { ok: boolean; result?: { update_id: number; message?: TelegramMessage }[] };
    if (!data.ok || !data.result?.length) return;
    for (const update of data.result) {
      telegramPollingOffset = update.update_id + 1;
      if (update.message) {
        await handleTelegramMessage(update.message, log).catch(err => log.error({ err }, '[Bridge] polling 消息处理失败'));
      }
    }
  } catch (err) {
    log.error({ err }, '[Bridge] Telegram polling 失败');
  }
}

export function startTelegramPolling(token: string, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  if (telegramPollingTimer) return;
  log.info('[Bridge] 启动 Telegram polling 模式');
  const loop = () => {
    telegramPollOnce(token, log).finally(() => {
      telegramPollingTimer = setTimeout(loop, 1000);
    });
  };
  loop();
}

export function stopTelegramPolling() {
  if (telegramPollingTimer) {
    clearTimeout(telegramPollingTimer);
    telegramPollingTimer = null;
  }
}

export async function bridgeGateway(app: FastifyInstance) {
  // ──────────────── Webhook URL 查询 ────────────────

  app.get('/api/bridge/webhook-url', async (req, reply) => {
    const base = config.bridge?.baseUrl ?? '';
    return reply.send({
      telegram: `${base}/api/bridge/webhook/telegram`,
      feishu: `${base}/api/bridge/webhook/feishu`,
      dingtalk: `${base}/api/bridge/webhook/dingtalk`,
      wecom: `${base}/api/bridge/webhook/wecom`,
      qq: `${base}/api/bridge/webhook/qq`,
    });
  });

  // ──────────────── ExternalChannel 管理 ────────────────

  // 列出所有外部频道
  app.get('/api/bridge/channels', async (req, reply) => {
    try {
      const { platform } = req.query as { platform?: Platform };
      const channels = await bridgeService.listChannels(platform);
      return reply.send({ success: true, data: channels });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取频道列表失败');
      return reply.status(500).send({ success: false, error: '获取频道列表失败' });
    }
  });

  // 创建外部频道（绑定外部群 ↔ TeamAgentX ChatRoom）
  app.post('/api/bridge/channels', async (req, reply) => {
    try {
      const body = req.body as {
        platform: Platform;
        externalId: string;
        chatRoomId: string;
        botToken?: string;
        webhookSecret?: string;
        defaultAgentId?: string;
        config?: Record<string, unknown>;
      };

      if (!body.platform || !body.externalId || !body.chatRoomId) {
        return reply.status(400).send({ success: false, error: 'platform、externalId、chatRoomId 为必填项' });
      }

      const channel = await bridgeService.createChannel(body);
      return reply.status(201).send({ success: true, data: channel });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 创建频道失败');
      return reply.status(500).send({ success: false, error: '创建频道失败' });
    }
  });

  // 更新外部频道配置
  app.patch('/api/bridge/channels/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const body = req.body as {
        botToken?: string;
        webhookSecret?: string;
        defaultAgentId?: string;
        config?: Record<string, unknown>;
        enabled?: boolean;
      };
      const channel = await bridgeService.updateChannel(id, body);
      return reply.send({ success: true, data: channel });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 更新频道失败');
      return reply.status(500).send({ success: false, error: '更新频道失败' });
    }
  });

  // 删除外部频道
  app.delete('/api/bridge/channels/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      await bridgeService.deleteChannel(id);
      return reply.status(204).send();
    } catch (err) {
      app.log.error({ err }, '[Bridge] 删除频道失败');
      return reply.status(500).send({ success: false, error: '删除频道失败' });
    }
  });

  // ──────────────── 平台全局配置（Bot Token + 默认助手）────────────────

  app.get('/api/bridge/platform-config/:platform', async (req, reply) => {
    try {
      const { platform } = req.params as { platform: string };
      const cfg = await prisma.platformConfig.findUnique({
        where: { platform },
        include: { defaultAgent: { select: { id: true, name: true } } },
      });
      if (!cfg) return reply.send({ success: true, data: { platform, botToken: '', hasConfig: false, defaultAgentId: null, defaultAgent: null } });
      return reply.send({
        success: true,
        data: { ...cfg, botToken: cfg.botToken ? '••••••••' : '', config: null, hasConfig: !!cfg.config },
      });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取平台配置失败');
      return reply.status(500).send({ success: false, error: '获取平台配置失败' });
    }
  });

  app.put('/api/bridge/platform-config/:platform', async (req, reply) => {
    try {
      const { platform } = req.params as { platform: string };
      const body = req.body as { botToken?: string; defaultAgentId?: string | null; config?: Record<string, unknown> };
      const now = new Date();
      const data: Record<string, unknown> = { updatedAt: now };
      if (body.botToken !== undefined) {
        data.botToken = body.botToken ? encrypt(body.botToken) : null;
      }
      if (body.config !== undefined) {
        data.config = body.config ? encrypt(JSON.stringify(body.config)) : null;
      }
      if ('defaultAgentId' in body) {
        data.defaultAgentId = body.defaultAgentId || null;
      }
      const cfg = await prisma.platformConfig.upsert({
        where: { platform },
        create: { platform, ...data, createdAt: now },
        update: data,
        include: { defaultAgent: { select: { id: true, name: true } } },
      });
      return reply.send({ success: true, data: { ...cfg, botToken: cfg.botToken ? '••••••••' : '', config: null, hasConfig: !!cfg.config } });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 保存平台配置失败');
      return reply.status(500).send({ success: false, error: '保存平台配置失败' });
    }
  });

  // ──────────────── 绑定码生成（通用，所有平台）────────────────

  app.post('/api/bridge/bind-code', async (req, reply) => {
    try {
      const { platform, chatRoomId } = req.body as { platform: string; chatRoomId: string };
      if (!platform || !chatRoomId) {
        return reply.status(400).send({ success: false, error: 'platform 和 chatRoomId 为必填项' });
      }
      const platformCfg = await prisma.platformConfig.findUnique({ where: { platform } });
      if (!platformCfg?.botToken && !platformCfg?.config) {
        return reply.status(400).send({ success: false, error: `请先在外部平台集成页配置 ${platform} 凭证` });
      }
      cleanExpiredBindCodes();
      const code = Math.random().toString(36).slice(2, 10).toUpperCase();
      bindCodes.set(code, { platform, chatRoomId, expiresAt: Date.now() + 15 * 60 * 1000 });
      return reply.send({ success: true, data: { code, expiresIn: 900 } });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 生成绑定码失败');
      return reply.status(500).send({ success: false, error: '生成绑定码失败' });
    }
  });

  // ──────────────── 消息接入（内部调用 / Bridge Service 调用）────────────────

  /**
   * POST /api/bridge/message
   * Bridge Service 解析各平台 Webhook 后调用此接口，将外部消息注入 TeamAgentX
   */
  app.post('/api/bridge/message', async (req, reply) => {
    try {
      const body = req.body as {
        platform: Platform;
        externalId: string;
        senderName: string;
        content: string;
      };

      if (!body.platform || !body.externalId || !body.senderName || !body.content) {
        return reply.status(400).send({ success: false, error: 'platform、externalId、senderName、content 为必填项' });
      }

      const result = await bridgeService.receiveBridgeMessage({
        platform: body.platform,
        externalId: body.externalId,
        senderName: body.senderName,
        content: body.content,
      });

      if (!result) {
        return reply.status(404).send({ success: false, error: '未找到对应的外部频道，或频道已禁用' });
      }

      return reply.status(202).send({ success: true, data: result });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 消息接入失败');
      return reply.status(500).send({ success: false, error: '消息接入失败' });
    }
  });

  // ──────────────── Webhook 入口（各平台回调）────────────────

  /**
   * POST /api/bridge/webhook/telegram
   * Telegram setWebhook 指定的回调地址
   */
  app.post('/api/bridge/webhook/telegram', async (req, reply) => {
    const update = req.body as { update_id?: number; message?: TelegramMessage };
    if (update.message) {
      await handleTelegramMessage(update.message, app.log).catch(err =>
        app.log.error({ err }, '[Bridge] webhook 消息处理失败'),
      );
    }
    return reply.status(200).send('ok');
  });

  /**
   * POST /api/bridge/webhook/feishu
   * 飞书事件订阅回调地址
   */
  app.post('/api/bridge/webhook/feishu', async (req, reply) => {
    const body = req.body as {
      schema?: string;
      header?: { event_type?: string; token?: string; event_id?: string };
      event?: {
        sender?: { sender_id?: { open_id?: string } };
        message?: {
          chat_id?: string;
          chat_type?: string;
          content?: string;
          mentions?: { name?: string }[];
        };
      };
      challenge?: string; // 飞书验证请求
    };

    // 响应飞书验证请求
    if (body.challenge) {
      return reply.send({ challenge: body.challenge });
    }

    // 入站消息去重
    const feishuEventId = body.header?.event_id;
    if (feishuEventId) {
      const feishuKey = `feishu:${feishuEventId}`;
      if (processedMessages.has(feishuKey)) return reply.status(200).send('ok');
      if (processedMessages.size >= 10000) processedMessages.clear();
      processedMessages.add(feishuKey);
    }

    const event = body.event;
    if (!event?.message?.chat_id) return reply.status(200).send('ok');
    if (event.message.chat_type !== 'group') return reply.status(200).send('ok');

    const externalId = event.message.chat_id;

    // 提取消息文本
    let feishuRawContent = '';
    try {
      const parsed = JSON.parse(event.message.content ?? '{}');
      feishuRawContent = parsed.text ?? '';
    } catch {
      feishuRawContent = event.message.content ?? '';
    }
    const feishuText = feishuRawContent.replace(/@_user_\d+\s*/g, '').trim();

    // 处理 /bind CODE 命令
    const feishuBindMatch = feishuText.match(/^\/bind\s+([A-Z0-9]{6,12})$/i);
    if (feishuBindMatch) {
      const noop = async (_text: string) => {};
      await handleBindCode('feishu', externalId, `飞书群 ${externalId}`, feishuBindMatch[1].toUpperCase(), noop, app.log);
      return reply.status(200).send('ok');
    }

    const feishuChannel = await prisma.externalChannel.findFirst({ where: { platform: 'feishu', externalId } });

    // 强制验签检查
    if (config.bridge?.requireSignature && !feishuChannel?.webhookSecret) {
      app.log.warn({ externalId }, '[Bridge] 拒绝未配置验签的请求');
      return reply.status(401).send('Signature required');
    }

    // 签名验证
    const feishuVerified = await verifyFeishu(req.body, req.headers as Record<string, string>, feishuChannel?.webhookSecret ?? undefined);
    if (!feishuVerified) return reply.status(401).send('Unauthorized');

    if (!feishuChannel) return reply.status(200).send('ok');

    const openId = event.sender?.sender_id?.open_id ?? '未知用户';
    if (!feishuText) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'feishu',
      externalId,
      senderName: openId,
      content: feishuText,
    });

    return reply.status(200).send('ok');
  });

  /**
   * POST /api/bridge/webhook/dingtalk
   * 钉钉机器人消息回调
   */
  app.post('/api/bridge/webhook/dingtalk', async (req, reply) => {
    const body = req.body as {
      conversationId?: string;
      conversationType?: string;
      conversationTitle?: string;
      senderNick?: string;
      msgId?: string;
      text?: { content?: string };
    };

    if (!body.conversationId || body.conversationType !== '2') {
      return reply.status(200).send('ok');
    }

    // 入站消息去重
    if (body.msgId) {
      const dingtalkKey = `dingtalk:${body.msgId}`;
      if (processedMessages.has(dingtalkKey)) return reply.status(200).send('ok');
      if (processedMessages.size >= 10000) processedMessages.clear();
      processedMessages.add(dingtalkKey);
    }

    const dingtalkExternalId = body.conversationId;

    // 提取文本，处理 /bind CODE 命令
    const dingtalkRawText = body.text?.content?.replace(/@\S+\s*/g, '').trim() ?? '';
    const dingtalkBindMatch = dingtalkRawText.match(/^\/bind\s+([A-Z0-9]{6,12})$/i);
    if (dingtalkBindMatch) {
      const noop = async (_text: string) => {};
      await handleBindCode('dingtalk', dingtalkExternalId, body.conversationTitle ?? `钉钉群 ${dingtalkExternalId}`, dingtalkBindMatch[1].toUpperCase(), noop, app.log);
      return reply.status(200).send({ msgtype: 'empty' });
    }

    const dingtalkChannel = await prisma.externalChannel.findFirst({ where: { platform: 'dingtalk', externalId: dingtalkExternalId } });

    // 强制验签检查
    if (config.bridge?.requireSignature && !dingtalkChannel?.webhookSecret) {
      app.log.warn({ externalId: dingtalkExternalId }, '[Bridge] 拒绝未配置验签的请求');
      return reply.status(401).send('Signature required');
    }

    // 签名验证
    const dingtalkVerified = verifyDingtalk(req.query as Record<string, string>, dingtalkChannel?.webhookSecret ?? undefined);
    if (!dingtalkVerified) return reply.status(401).send('Unauthorized');

    if (!dingtalkChannel) return reply.status(200).send({ msgtype: 'empty' });
    if (!dingtalkRawText) return reply.status(200).send({ msgtype: 'empty' });

    await bridgeService.receiveBridgeMessage({
      platform: 'dingtalk',
      externalId: dingtalkExternalId,
      senderName: body.senderNick ?? '未知用户',
      content: dingtalkRawText,
    });

    return reply.status(200).send({ msgtype: 'empty' });
  });

  /**
   * GET /api/bridge/webhook/wecom
   * 企业微信 URL 验证（首次配置时发送 GET 请求）
   */
  app.get('/api/bridge/webhook/wecom', async (req, reply) => {
    const query = req.query as { msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string };
    return reply.send(query.echostr ?? 'ok');
  });

  /**
   * POST /api/bridge/webhook/wecom
   * 企业微信消息回调（支持加密消息体）
   */
  app.post('/api/bridge/webhook/wecom', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const rawBody = req.body as {
      FromUserName?: string;
      ChatId?: string;
      Content?: string;
      MsgType?: string;
      MsgId?: string;
      Encrypt?: string;
    };

    // 解析出 ChatId（可能在加密消息中）
    let body = rawBody;
    let decryptedMsgId: string | undefined;

    // 如果消息体有 Encrypt 字段，需先解密
    if (rawBody.Encrypt) {
      // 查找对应频道获取 encodingAESKey（存在 config 中）
      // 先用 ChatId（外层可能没有），用通配查找第一个 wecom 频道
      const wecomChannels = await prisma.externalChannel.findMany({ where: { platform: 'wecom', enabled: true } });
      let decryptedXml: string | null = null;
      for (const ch of wecomChannels) {
        try {
          if (!ch.config) continue;
          const cfg = JSON.parse(decrypt(ch.config)) as { encodingAESKey?: string };
          if (!cfg.encodingAESKey) continue;
          decryptedXml = decryptWecomMessage(cfg.encodingAESKey, rawBody.Encrypt);
          break;
        } catch {
          // try next channel
        }
      }
      if (decryptedXml) {
        // 简单 XML 解析取出关键字段
        const extractTag = (xml: string, tag: string) => {
          const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]+)\\]\\]><\\/${tag}>`));
          return m?.[1] ?? undefined;
        };
        decryptedMsgId = extractTag(decryptedXml, 'MsgId');
        body = {
          FromUserName: extractTag(decryptedXml, 'FromUserName'),
          ChatId: extractTag(decryptedXml, 'ChatId'),
          Content: extractTag(decryptedXml, 'Content'),
          MsgType: extractTag(decryptedXml, 'MsgType'),
          MsgId: decryptedMsgId,
        };
      }
    }

    if (!body.ChatId) return reply.status(200).send('ok');

    // 入站消息去重
    const wecomMsgId = body.MsgId ?? decryptedMsgId;
    if (wecomMsgId) {
      const wecomKey = `wecom:${wecomMsgId}`;
      if (processedMessages.has(wecomKey)) return reply.status(200).send('ok');
      if (processedMessages.size >= 10000) processedMessages.clear();
      processedMessages.add(wecomKey);
    }

    const wecomExternalId = body.ChatId;

    // 处理 /bind CODE 命令（仅文本消息）
    if (body.MsgType === 'text') {
      const wecomRawText = body.Content?.replace(/@\S+\s*/g, '').trim() ?? '';
      const wecomBindMatch = wecomRawText.match(/^\/bind\s+([A-Z0-9]{6,12})$/i);
      if (wecomBindMatch) {
        const noop = async (_text: string) => {};
        await handleBindCode('wecom', wecomExternalId, `企微群 ${wecomExternalId}`, wecomBindMatch[1].toUpperCase(), noop, app.log);
        return reply.status(200).send('ok');
      }
    }

    const wecomChannel = await prisma.externalChannel.findFirst({ where: { platform: 'wecom', externalId: wecomExternalId } });

    // 强制验签检查
    if (config.bridge?.requireSignature && !wecomChannel?.webhookSecret) {
      app.log.warn({ externalId: wecomExternalId }, '[Bridge] 拒绝未配置验签的请求');
      return reply.status(401).send('Signature required');
    }

    // 签名验证
    const wecomVerified = verifyWecom(query, wecomChannel?.webhookSecret ?? undefined);
    if (!wecomVerified) return reply.status(401).send('Unauthorized');

    if (!wecomChannel) return reply.status(200).send('ok');
    if (body.MsgType !== 'text') return reply.status(200).send('ok');

    const wecomContent = body.Content?.replace(/@\S+\s*/g, '').trim() ?? '';
    if (!wecomContent) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'wecom',
      externalId: wecomExternalId,
      senderName: body.FromUserName ?? '未知用户',
      content: wecomContent,
    });

    return reply.status(200).send('ok');
  });

  /**
   * POST /api/bridge/webhook/qq
   * QQ 开放平台群消息回调
   */
  app.post('/api/bridge/webhook/qq', async (req, reply) => {
    const body = req.body as {
      op?: number;
      t?: string;
      id?: string;
      d?: {
        author?: { member_openid?: string };
        content?: string;
        group_openid?: string;
      };
    };

    if (body.t !== 'GROUP_AT_MESSAGE_CREATE' || !body.d?.group_openid) {
      return reply.status(200).send('ok');
    }

    // 入站消息去重
    if (body.id) {
      const qqKey = `qq:${body.id}`;
      if (processedMessages.has(qqKey)) return reply.status(200).send('ok');
      if (processedMessages.size >= 10000) processedMessages.clear();
      processedMessages.add(qqKey);
    }

    const qqExternalId = body.d.group_openid;

    // 提取文本，处理 /bind CODE 命令
    const qqRawText = (body.d.content ?? '').replace(/<@[^>]+>\s*/g, '').replace(/@\S+\s*/g, '').trim();
    const qqBindMatch = qqRawText.match(/^\/bind\s+([A-Z0-9]{6,12})$/i);
    if (qqBindMatch) {
      const noop = async (_text: string) => {};
      await handleBindCode('qq', qqExternalId, `QQ群 ${qqExternalId}`, qqBindMatch[1].toUpperCase(), noop, app.log);
      return reply.status(200).send('ok');
    }

    const qqChannel = await prisma.externalChannel.findFirst({ where: { platform: 'qq', externalId: qqExternalId } });
    if (!qqChannel) return reply.status(200).send('ok');

    if (!qqRawText) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'qq',
      externalId: qqExternalId,
      senderName: body.d.author?.member_openid ?? '未知用户',
      content: qqRawText,
    });

    return reply.status(200).send('ok');
  });

  // ──────────────── 桥接事件日志查询 ────────────────

  app.get('/api/bridge/events', async (req, reply) => {
    try {
      const { platform, limit: limitStr } = req.query as { platform?: string; limit?: string };
      const limit = Math.min(parseInt(limitStr ?? '20', 10) || 20, 100);
      const events = await prisma.bridgeEvent.findMany({
        where: platform ? { platform } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return reply.send({ success: true, data: events });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取事件列表失败');
      return reply.status(500).send({ success: false, error: '获取事件列表失败' });
    }
  });
}
