import { FastifyInstance } from 'fastify';
import { bridgeService, Platform } from '../modules/bridge/bridge.service.js';
import { config } from '../config/index.js';
import { verifyTelegram, verifyFeishu, verifyDingtalk, verifyWecom } from '../modules/bridge/webhook-verify.js';
import { decryptWecomMessage } from '../modules/bridge/wecom-crypto.js';
import { decrypt } from '../modules/bridge/crypto.js';
import prisma from '../lib/prisma.js';

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
    const { platform } = req.query as { platform?: Platform };
    const channels = await bridgeService.listChannels(platform);
    return reply.send(channels);
  });

  // 创建外部频道（绑定外部群 ↔ TeamAgentX ChatRoom）
  app.post('/api/bridge/channels', async (req, reply) => {
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
      return reply.status(400).send({ error: 'platform、externalId、chatRoomId 为必填项' });
    }

    const channel = await bridgeService.createChannel(body);
    return reply.status(201).send(channel);
  });

  // 更新外部频道配置
  app.patch('/api/bridge/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      botToken?: string;
      webhookSecret?: string;
      defaultAgentId?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };
    const channel = await bridgeService.updateChannel(id, body);
    return reply.send(channel);
  });

  // 删除外部频道
  app.delete('/api/bridge/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await bridgeService.deleteChannel(id);
    return reply.status(204).send();
  });

  // ──────────────── 消息接入（内部调用 / Bridge Service 调用）────────────────

  /**
   * POST /api/bridge/message
   * Bridge Service 解析各平台 Webhook 后调用此接口，将外部消息注入 TeamAgentX
   */
  app.post('/api/bridge/message', async (req, reply) => {
    const body = req.body as {
      platform: Platform;
      externalId: string;   // 平台侧群 ID
      senderName: string;   // 发送者昵称
      content: string;      // 消息内容（可含 @agent-name）
    };

    if (!body.platform || !body.externalId || !body.senderName || !body.content) {
      return reply.status(400).send({ error: 'platform、externalId、senderName、content 为必填项' });
    }

    const result = await bridgeService.receiveBridgeMessage({
      platform: body.platform,
      externalId: body.externalId,
      senderName: body.senderName,
      content: body.content,
    });

    if (!result) {
      return reply.status(404).send({ error: '未找到对应的外部频道，或频道已禁用' });
    }

    return reply.status(202).send(result);
  });

  // ──────────────── Webhook 入口（各平台回调）────────────────

  /**
   * POST /api/bridge/webhook/telegram
   * Telegram setWebhook 指定的回调地址
   */
  app.post('/api/bridge/webhook/telegram', async (req, reply) => {
    const update = req.body as {
      message?: {
        from?: { first_name?: string; username?: string; id?: number };
        chat?: { id?: number; title?: string; type?: string };
        text?: string;
        entities?: { type: string; offset: number; length: number }[];
      };
    };

    const msg = update.message;
    if (!msg?.text || !msg.chat?.id) return reply.status(200).send('ok');

    // 过滤非群组消息
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      return reply.status(200).send('ok');
    }

    const externalId = String(msg.chat.id);

    // 签名验证
    const channel = await prisma.externalChannel.findFirst({ where: { platform: 'telegram', externalId } });
    const verified = await verifyTelegram(req.headers as Record<string, string>, channel?.webhookSecret ?? undefined);
    if (!verified) return reply.status(401).send('Unauthorized');

    const senderName = msg.from?.username
      ? `${msg.from.first_name ?? ''}(@${msg.from.username})`
      : (msg.from?.first_name ?? '未知用户');

    // 去掉 @botname 前缀（Telegram 群消息中 @bot 会附在文本里）
    const content = msg.text.replace(/^@\S+\s*/, '').trim();
    if (!content) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'telegram',
      externalId,
      senderName,
      content,
    });

    return reply.status(200).send('ok');
  });

  /**
   * POST /api/bridge/webhook/feishu
   * 飞书事件订阅回调地址
   */
  app.post('/api/bridge/webhook/feishu', async (req, reply) => {
    const body = req.body as {
      schema?: string;
      header?: { event_type?: string; token?: string };
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

    const event = body.event;
    if (!event?.message?.chat_id) return reply.status(200).send('ok');
    if (event.message.chat_type !== 'group') return reply.status(200).send('ok');

    const externalId = event.message.chat_id;

    // 签名验证
    const feishuChannel = await prisma.externalChannel.findFirst({ where: { platform: 'feishu', externalId } });
    const feishuVerified = await verifyFeishu(req.body, req.headers as Record<string, string>, feishuChannel?.webhookSecret ?? undefined);
    if (!feishuVerified) return reply.status(401).send('Unauthorized');
    const openId = event.sender?.sender_id?.open_id ?? '未知用户';

    let content = '';
    try {
      const parsed = JSON.parse(event.message.content ?? '{}');
      content = parsed.text ?? '';
    } catch {
      content = event.message.content ?? '';
    }

    // 去掉 @TeamAgentX 机器人自身的 mention（飞书格式 @_user_x）
    content = content.replace(/@_user_\d+\s*/g, '').trim();
    if (!content) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'feishu',
      externalId,
      senderName: openId,
      content,
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
      senderNick?: string;
      text?: { content?: string };
    };

    if (!body.conversationId || body.conversationType !== '2') {
      return reply.status(200).send('ok');
    }

    // 签名验证
    const dingtalkChannel = await prisma.externalChannel.findFirst({ where: { platform: 'dingtalk', externalId: body.conversationId } });
    const dingtalkVerified = verifyDingtalk(req.query as Record<string, string>, dingtalkChannel?.webhookSecret ?? undefined);
    if (!dingtalkVerified) return reply.status(401).send('Unauthorized');

    const content = body.text?.content?.replace(/@\S+\s*/g, '').trim() ?? '';
    if (!content) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'dingtalk',
      externalId: body.conversationId,
      senderName: body.senderNick ?? '未知用户',
      content,
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
      Encrypt?: string;
    };

    // 解析出 ChatId（可能在加密消息中）
    let body = rawBody;

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
        body = {
          FromUserName: extractTag(decryptedXml, 'FromUserName'),
          ChatId: extractTag(decryptedXml, 'ChatId'),
          Content: extractTag(decryptedXml, 'Content'),
          MsgType: extractTag(decryptedXml, 'MsgType'),
        };
      }
    }

    if (!body.ChatId) return reply.status(200).send('ok');

    // 签名验证
    const wecomChannel = await prisma.externalChannel.findFirst({ where: { platform: 'wecom', externalId: body.ChatId } });
    const wecomVerified = verifyWecom(query, wecomChannel?.webhookSecret ?? undefined);
    if (!wecomVerified) return reply.status(401).send('Unauthorized');

    if (body.MsgType !== 'text') return reply.status(200).send('ok');

    const content = body.Content?.replace(/@\S+\s*/g, '').trim() ?? '';
    if (!content) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'wecom',
      externalId: body.ChatId,
      senderName: body.FromUserName ?? '未知用户',
      content,
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
      d?: {
        author?: { member_openid?: string };
        content?: string;
        group_openid?: string;
      };
    };

    if (body.t !== 'GROUP_AT_MESSAGE_CREATE' || !body.d?.group_openid) {
      return reply.status(200).send('ok');
    }

    // 去掉 <@bot_id> mention
    const content = (body.d.content ?? '').replace(/<@[^>]+>\s*/g, '').replace(/@\S+\s*/g, '').trim();
    if (!content) return reply.status(200).send('ok');

    await bridgeService.receiveBridgeMessage({
      platform: 'qq',
      externalId: body.d.group_openid,
      senderName: body.d.author?.member_openid ?? '未知用户',
      content,
    });

    return reply.status(200).send('ok');
  });
}
