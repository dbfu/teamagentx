import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { bridgeService, Platform } from '../modules/bridge/bridge.service.js';
import { config } from '../config/index.js';
import { resolveStoredBridgeBotToken, parseStoredBridgeConfig } from '../modules/bridge/bridge-platform-config.js';
import { consumeBridgeBindCode, createBridgeBindCode } from '../modules/bridge/bridge-bind-code-store.js';
import { getBridgePlatformConfig, hasBridgePlatformCredentials, saveBridgePlatformConfig } from '../modules/bridge/bridge-platform-config-store.js';
import { syncBridgePlatformRuntime } from '../modules/bridge/bridge-runtime-sync.js';
import { getBridgeInboundTextAdapter } from '../modules/bridge/platform-inbound-adapters.js';
import {
  BRIDGE_WEBHOOK_ADAPTERS,
  type BridgeWebhookAdapter,
  type BridgeWebhookRequest,
} from '../modules/bridge/bridge-webhook-adapters.js';
import { listBridgePlatformDefinitions, getBridgePlatformDefinition } from '../modules/bridge/bridge-platform-registry.js';
import { BRIDGE_PLATFORM_PLAYBOOKS } from '../modules/bridge/bridge-platform-playbooks.js';
import prisma from '../lib/prisma.js';
import { authService } from '../modules/auth/auth.service.js';
import { decryptWecomMessage } from '../modules/bridge/wecom-crypto.js';

// 入站消息去重 Set，防止 webhook 重投导致重复处理
const processedMessages = new Set<string>();

// ──────────────── 通用绑定码处理 ────────────────

export async function handleBindCode(
  platform: string,
  externalId: string,
  _groupName: string,
  code: string,
  sendReply: (text: string) => Promise<void>,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): Promise<boolean> {
  const pending = consumeBridgeBindCode(platform as Platform, code);
  if (!pending) return false;
  const platformCfg = await prisma.platformConfig.findUnique({ where: { platform } });
  const botToken = platformCfg ? resolveStoredBridgeBotToken(platformCfg) : undefined;
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
  const telegramAdapter = getBridgeInboundTextAdapter('telegram');

  // 入站消息去重
  const telegramMsgKey = `telegram:${String(msg.message_id ?? '')}`;
  if (msg.message_id != null) {
    if (processedMessages.has(telegramMsgKey)) return;
    if (processedMessages.size >= 10000) {
      const keys = processedMessages.values();
      for (let i = 0; i < 1000; i++) {
        const { value, done } = keys.next();
        if (done) break;
        processedMessages.delete(value);
      }
    }
    processedMessages.add(telegramMsgKey);
  }

  const externalId = String(msg.chat.id);

  if (!msg.text) return;

  // 处理 /bind CODE 命令——私聊和群聊都可能收到
  const telegramBindCode = telegramAdapter.extractBindCode(msg.text);
  if (telegramBindCode) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'telegram' } });
    const botToken = platformCfg ? resolveStoredBridgeBotToken(platformCfg) : undefined;
    const sendReply = async (text: string) => {
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: externalId, text }),
      });
    };
    await handleBindCode('telegram', externalId, msg.chat.title ?? `Telegram 群 ${externalId}`, telegramBindCode, sendReply, log);
    return;
  }

  // 只处理群组消息
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;

  const channel = await prisma.externalChannel.findFirst({ where: { platform: 'telegram', externalId } });
  if (!channel) return; // 未绑定，静默忽略

  const senderName = msg.from?.username
    ? `${msg.from.first_name ?? ''}(@${msg.from.username})`
    : (msg.from?.first_name ?? '未知用户');

  const content = telegramAdapter.normalizeText(msg.text);
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

function rememberProcessedMessage(dedupeKey?: string): boolean {
  if (!dedupeKey) return false;
  if (processedMessages.has(dedupeKey)) return true;
  if (processedMessages.size >= 10000) {
    const keys = processedMessages.values();
    for (let i = 0; i < 1000; i++) {
      const { value, done } = keys.next();
      if (done) break;
      processedMessages.delete(value);
    }
  }
  processedMessages.add(dedupeKey);
  return false;
}

async function handleWebhookByAdapter(
  app: FastifyInstance,
  adapter: BridgeWebhookAdapter,
  requestData: BridgeWebhookRequest,
) {
  const parsed = await adapter.parse(requestData);

  if (parsed.kind === 'challenge') {
    return { statusCode: 200, body: parsed.responseBody };
  }

  if (parsed.kind === 'ignore') {
    return { statusCode: 200, body: adapter.okResponse };
  }

  if (rememberProcessedMessage(parsed.dedupeKey)) {
    return { statusCode: 200, body: adapter.okResponse };
  }

  if (parsed.bindCode) {
    const noop = async (_text: string) => {};
    const sendReply = adapter.platform === 'telegram'
      ? async (text: string) => {
          const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'telegram' } });
          const botToken = platformCfg ? resolveStoredBridgeBotToken(platformCfg) : undefined;
          if (!botToken) return;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: parsed.externalId, text }),
          });
        }
      : noop;

    await handleBindCode(
      adapter.platform,
      parsed.externalId,
      parsed.groupName,
      parsed.bindCode,
      sendReply,
      app.log,
    );
    return { statusCode: 200, body: adapter.okResponse };
  }

  const channel = await prisma.externalChannel.findFirst({
    where: { platform: adapter.platform, externalId: parsed.externalId },
  });

  if (config.bridge?.requireSignature && !channel?.webhookSecret) {
    app.log.warn({ externalId: parsed.externalId, platform: adapter.platform }, '[Bridge] 拒绝未配置验签的请求');
    return { statusCode: 401, body: 'Signature required' };
  }

  let verificationSecret = channel?.webhookSecret ?? undefined;
  if (!verificationSecret && adapter.platform === 'wecom') {
    const platformCfg = await getBridgePlatformConfig('wecom');
    const parsedCfg = parseStoredBridgeConfig(platformCfg ?? {}) as { token?: string } | null;
    verificationSecret = parsedCfg?.token ?? undefined;
  }

  const verified = await adapter.verify(requestData, verificationSecret);
  if (!verified) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (!channel || !parsed.text) {
    return { statusCode: 200, body: adapter.okResponse };
  }

  await bridgeService.receiveBridgeMessage({
    platform: adapter.platform,
    externalId: parsed.externalId,
    senderName: parsed.senderName,
    content: parsed.text,
  });

  return { statusCode: 200, body: adapter.okResponse };
}

export async function bridgeGateway(app: FastifyInstance) {
  // ──────────────── 鉴权辅助 ────────────────

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<{ id: string; username: string } | null> {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) { reply.code(401).send({ success: false, error: 'Unauthorized' }); return null; }
    const user = await authService.getUserFromToken(token);
    if (!user) { reply.code(401).send({ success: false, error: 'Unauthorized' }); return null; }
    return user;
  }

  // ──────────────── Webhook URL 查询 ────────────────

  // 读取服务公网地址（DB 优先，fallback env var）
  async function getBaseUrl(): Promise<string> {
    const sys = await prisma.platformConfig.findUnique({ where: { platform: 'system' } }).catch(() => null);
    if (sys?.config) {
      let parsed: { baseUrl?: string };
      try {
        parsed = JSON.parse(sys.config) as { baseUrl?: string };
      } catch {
        return '';
      }
      if (parsed.baseUrl) return parsed.baseUrl.replace(/\/$/, '');
    }
    return '';
  }

  app.get('/api/bridge/webhook-url', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const base = await getBaseUrl();
    const urls = Object.fromEntries(
      BRIDGE_WEBHOOK_ADAPTERS.map((adapter) => [adapter.platform, `${base}${adapter.path}`]),
    );
    return reply.send(urls);
  });

  // ──────────────── 系统配置（公网地址等）────────────────

  app.get('/api/bridge/system-config', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const baseUrl = await getBaseUrl();
    return reply.send({ success: true, baseUrl });
  });

  app.put('/api/bridge/system-config', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { baseUrl } = req.body as { baseUrl?: string };
    const clean = (baseUrl ?? '').trim().replace(/\/$/, '');
    if (clean) {
      try {
        const parsed = new URL(clean);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return reply.status(400).send({ success: false, error: 'baseUrl 必须以 http:// 或 https:// 开头' });
        }
      } catch {
        return reply.status(400).send({ success: false, error: 'baseUrl 格式无效' });
      }
    }
    await prisma.platformConfig.upsert({
      where: { platform: 'system' },
      create: { platform: 'system', config: JSON.stringify({ baseUrl: clean }) },
      update: { config: JSON.stringify({ baseUrl: clean }) },
    });
    return reply.send({ success: true, baseUrl: clean });
  });

  app.get('/api/bridge/platforms', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    return reply.send({ success: true, data: listBridgePlatformDefinitions() });
  });

  app.get('/api/bridge/playbooks/:platform', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { platform } = req.params as { platform: string };
    const playbook = BRIDGE_PLATFORM_PLAYBOOKS.find(p => p.platform === platform);
    if (!playbook) return reply.status(404).send({ success: false, error: '未找到配置手册' });
    return reply.send({ success: true, data: playbook });
  });

  // ──────────────── ExternalChannel 管理 ────────────────

  // 列出所有外部频道
  app.get('/api/bridge/channels', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
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
    const user = await requireAuth(req, reply);
    if (!user) return;
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
      const prismaErr = err as { code?: string };
      if (prismaErr?.code === 'P2002') {
        return reply.code(409).send({ success: false, error: '该外部群已存在映射' });
      }
      app.log.error({ err }, '[Bridge] 创建频道失败');
      return reply.status(500).send({ success: false, error: '创建频道失败' });
    }
  });

  // 更新外部频道配置
  app.patch('/api/bridge/channels/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
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
    const user = await requireAuth(req, reply);
    if (!user) return;
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
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { platform } = req.params as { platform: string };
      const cfg = await getBridgePlatformConfig(platform as Platform);
      if (!cfg) return reply.send({ success: true, data: { platform, botToken: '', hasConfig: false, defaultAgentId: null, defaultAgent: null, configValues: {} } });

      // 解密 config，仅返回非密字段的明文值，供前端显示
      const configValues: Record<string, string> = {};
      if (cfg.config) {
        const parsed = parseStoredBridgeConfig(cfg);
        if (parsed) {
          let platformDef: ReturnType<typeof getBridgePlatformDefinition> | null = null;
          try { platformDef = getBridgePlatformDefinition(platform as Parameters<typeof getBridgePlatformDefinition>[0]); } catch {}
          for (const field of platformDef?.configFields ?? []) {
            if (!field.secret && typeof parsed[field.key] === 'string') {
              configValues[field.key] = parsed[field.key] as string;
            }
          }
        }
      }

      return reply.send({
        success: true,
        data: { ...cfg, botToken: cfg.botToken ? '••••••••' : '', config: null, hasConfig: !!cfg.config, configValues },
      });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取平台配置失败');
      return reply.status(500).send({ success: false, error: '获取平台配置失败' });
    }
  });

  app.put('/api/bridge/platform-config/:platform', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { platform } = req.params as { platform: string };
      const body = req.body as { botToken?: string; defaultAgentId?: string | null; config?: Record<string, unknown> };
      const cfg = await saveBridgePlatformConfig(platform as Platform, body);

      await syncBridgePlatformRuntime(platform as Platform, cfg, app.log);

      return reply.send({ success: true, data: { ...cfg, botToken: cfg.botToken ? '••••••••' : '', config: null, hasConfig: !!cfg.config } });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 保存平台配置失败');
      return reply.status(500).send({ success: false, error: '保存平台配置失败' });
    }
  });

  // ──────────────── 绑定码生成（通用，所有平台）────────────────

  app.post('/api/bridge/bind-code', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { platform, chatRoomId } = req.body as { platform: string; chatRoomId: string };
      if (!platform || !chatRoomId) {
        return reply.status(400).send({ success: false, error: 'platform 和 chatRoomId 为必填项' });
      }
      if (!(await hasBridgePlatformCredentials(platform as Platform))) {
        return reply.status(400).send({ success: false, error: `请先在外部平台集成页配置 ${platform} 凭证` });
      }
      return reply.send({ success: true, data: createBridgeBindCode(platform as Platform, chatRoomId) });
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
    const user = await requireAuth(req, reply);
    if (!user) return;
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

  for (const adapter of BRIDGE_WEBHOOK_ADAPTERS) {
    app.post(adapter.path, async (req, reply) => {
      try {
        const result = await handleWebhookByAdapter(app, adapter, {
          body: req.body,
          headers: req.headers as Record<string, string | string[] | undefined>,
          query: req.query as Record<string, string>,
        });
        return reply.status(result.statusCode).send(result.body);
      } catch (err) {
        app.log.error({ err, platform: adapter.platform }, '[Bridge] webhook 消息处理失败');
        return reply.status(500).send(adapter.okResponse);
      }
    });
  }

  /**
   * GET /api/bridge/webhook/wecom
   * 企业微信 URL 验证（首次配置时发送 GET 请求）
   */
  app.get('/api/bridge/webhook/wecom', async (req, reply) => {
    const query = req.query as { msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string };
    const echostr = query.echostr ?? 'ok';
    try {
      const platformCfg = await getBridgePlatformConfig('wecom');
      const parsedCfg = parseStoredBridgeConfig(platformCfg ?? {}) as { encodingAESKey?: string } | null;
      if (parsedCfg?.encodingAESKey) {
        const decrypted = decryptWecomMessage(parsedCfg.encodingAESKey, echostr);
        return reply.send(decrypted);
      }
    } catch {
      // 降级：直接回显原文
    }
    return reply.send(echostr);
  });

  // ──────────────── 桥接事件日志查询 ────────────────

  app.get('/api/bridge/events', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { platform, limit: limitStr } = req.query as { platform?: string; limit?: string };
      const limit = Math.max(1, Math.min(parseInt(limitStr ?? '20', 10) || 20, 100));
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
