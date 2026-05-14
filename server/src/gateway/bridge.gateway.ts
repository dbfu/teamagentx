import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { bridgeService, Platform } from '../modules/bridge/bridge.service.js';
import { config } from '../config/index.js';
import { resolveStoredBridgeBotToken, parseStoredBridgeConfig } from '../modules/bridge/bridge-platform-config.js';
import { consumeBridgeBindCode, createBridgeBotBindCode } from '../modules/bridge/bridge-bind-code-store.js';
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
import { createHash } from 'crypto';
import { decrypt } from '../modules/bridge/crypto.js';
import {
  createBridgeBot,
  getBridgeBotById,
  hasBridgeBotCredentials,
  listBridgeBots,
  updateBridgeBot,
} from '../modules/bridge/bridge-bot-store.js';
import { syncBridgeBotRuntime } from '../modules/bridge/bridge-runtime-sync.js';
import { registerTelegramPolling } from '../modules/bridge/telegram-polling-registry.js';

// 入站消息去重 Set，防止 webhook 重投导致重复处理
const processedMessages = new Set<string>();

// ──────────────── 权限校验辅助 ────────────────

async function assertBotOwner(botId: string, userId: string) {
  const bot = await getBridgeBotById(botId);
  if (!bot) throw { statusCode: 404, message: '机器人实例不存在' };
  if (bot.ownerId && bot.ownerId !== userId) throw { statusCode: 403, message: '无权操作此机器人' };
  return bot;
}

async function assertChatRoomOwner(chatRoomId: string, userId: string) {
  const room = await prisma.chatRoom.findUnique({ where: { id: chatRoomId }, select: { ownerId: true } });
  if (!room) throw { statusCode: 404, message: '聊天室不存在' };
  if (room.ownerId !== userId) throw { statusCode: 403, message: '无权操作此聊天室' };
}

// ──────────────── 通用绑定码处理 ────────────────

export async function handleBindCode(
  platform: string,
  botId: string,
  externalId: string,
  _groupName: string,
  code: string,
  sendReply: (text: string) => Promise<void>,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
): Promise<boolean> {
  const pending = consumeBridgeBindCode(platform as Platform, code);
  if (!pending) return false;
  try {
    if (!pending.botId || pending.botId !== botId) {
      await sendReply('❌ 该绑定码不属于当前机器人，请在正确的机器人会话里发送。').catch(() => {});
      return true;
    }
    await bridgeService.bindBot(botId, pending.chatRoomId);
    log.info({ platform, botId, externalId, chatRoomId: pending.chatRoomId }, '[Bridge] 绑定码绑定成功');
    await sendReply('✅ 机器人已绑定到 TeamAgentX 群聊。\n后续在这个机器人里发消息，都会进入对应群聊。').catch(() => {});
  } catch (err) {
    log.error({ err, platform, botId, externalId }, '[Bridge] 绑定码绑定失败');
    const errorMessage = err instanceof Error ? err.message : '绑定失败，请重新获取绑定码重试。';
    await sendReply(`❌ ${errorMessage}`).catch(() => {});
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

async function handleTelegramMessage(
  botId: string,
  botToken: string,
  msg: TelegramMessage,
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
) {
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
    const sendReply = async (text: string) => {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: externalId, text }),
      });
    };
    await handleBindCode('telegram', botId, externalId, msg.chat.title ?? `Telegram 群 ${externalId}`, telegramBindCode, sendReply, log);
    return;
  }

  const senderName = msg.from?.username
    ? `${msg.from.first_name ?? ''}(@${msg.from.username})`
    : (msg.from?.first_name ?? '未知用户');

  const content = telegramAdapter.normalizeText(msg.text);
  if (!content) return;

  await bridgeService.receiveBridgeMessage({
    botId,
    platform: 'telegram',
    externalId,
    senderName,
    content,
  });
}

// ──────────────── Telegram Polling（本地开发 / 无公网时使用）────────────────

type TelegramPollingState = {
  offset: number;
  timer: ReturnType<typeof setTimeout> | null;
  token: string;
  failCount: number;
};

const telegramPollingStates = new Map<string, TelegramPollingState>();

async function telegramPollOnce(botId: string, token: string, state: TelegramPollingState, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?offset=${state.offset}&timeout=25&allowed_updates=["message"]`,
    );
    if (res.status === 401 || res.status === 404) {
      log.error({ botId, status: res.status }, '[Bridge] Telegram token 无效，停止 polling');
      stopTelegramPolling(botId);
      return;
    }
    const data = await res.json() as { ok: boolean; result?: { update_id: number; message?: TelegramMessage }[] };
    if (!data.ok || !data.result?.length) return;
    state.failCount = 0;
    for (const update of data.result) {
      state.offset = update.update_id + 1;
      if (update.message) {
        await handleTelegramMessage(botId, token, update.message, log).catch(err => log.error({ err, botId }, '[Bridge] polling 消息处理失败'));
      }
    }
  } catch (err) {
    state.failCount++;
    log.error({ err, botId, failCount: state.failCount }, '[Bridge] Telegram polling 失败');
  }
}

export function startTelegramPolling(botId: string, token: string, log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }) {
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    log.error({ botId }, '[Bridge] Telegram bot token 格式无效，跳过 polling');
    return;
  }
  const existing = telegramPollingStates.get(botId);
  if (existing?.timer && existing.token === token) return;
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  const state: TelegramPollingState = { offset: existing?.offset ?? 0, timer: null, token, failCount: 0 };
  telegramPollingStates.set(botId, state);
  log.info({ botId }, '[Bridge] 启动 Telegram polling 模式');
  const loop = () => {
    telegramPollOnce(botId, token, state, log).finally(() => {
      const delay = state.failCount > 0 ? Math.min(2 ** state.failCount * 1000, 30000) : 1000;
      state.timer = setTimeout(loop, delay);
    });
  };
  loop();
}

export function stopTelegramPolling(botId?: string) {
  if (botId) {
    const state = telegramPollingStates.get(botId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    telegramPollingStates.delete(botId);
    return;
  }

  for (const state of telegramPollingStates.values()) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
  }
  telegramPollingStates.clear();
}

// 向注册表注册 Telegram polling 函数，解除与 bridge-runtime-sync 的循环依赖
registerTelegramPolling({ start: startTelegramPolling, stop: stopTelegramPolling });

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

function buildBotWebhookUrls(baseUrl: string, botId: string, platform: Platform) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  switch (platform) {
    case 'telegram':
      return `${cleanBase}/api/bridge/webhook/telegram/${botId}`;
    case 'wecom':
      return `${cleanBase}/api/bridge/webhook/wecom/${botId}`;
    case 'qq':
      return `${cleanBase}/api/bridge/webhook/qq/${botId}`;
    default:
      return '';
  }
}

function maskBridgeBot(bot: {
  id: string;
  platform: string;
  name: string;
  botToken?: string | null;
  config?: string | null;
  defaultAgentId?: string | null;
  defaultAgent?: unknown;
  chatRoomId?: string | null;
  chatRoom?: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  const configValues: Record<string, string> = {};
  if (bot.config) {
    const parsed = parseStoredBridgeConfig(bot);
    if (parsed) {
      let platformDef: ReturnType<typeof getBridgePlatformDefinition> | null = null;
      try { platformDef = getBridgePlatformDefinition(bot.platform as Platform); } catch {}
      for (const field of platformDef?.configFields ?? []) {
        if (!field.secret && typeof parsed[field.key] === 'string') {
          configValues[field.key] = parsed[field.key] as string;
        }
      }
    }
  }

  return {
    ...bot,
    botToken: bot.botToken ? '••••••••' : '',
    hasConfig: !!bot.config,
    config: null,
    configValues,
  };
}

async function handleWebhookByAdapter(
  app: FastifyInstance,
  adapter: BridgeWebhookAdapter,
  requestData: BridgeWebhookRequest,
  botId?: string,
) {
  const bridgeBot = botId ? await getBridgeBotById(botId) : null;
  const parsed = await adapter.parse(requestData);

  if (parsed.kind === 'challenge') {
    return { statusCode: 200, body: parsed.responseBody };
  }

  if (parsed.kind === 'ignore') {
    return { statusCode: 200, body: adapter.okResponse };
  }

  if (parsed.dedupeKey && processedMessages.has(parsed.dedupeKey)) {
    return { statusCode: 200, body: adapter.okResponse };
  }

  if (parsed.bindCode) {
    const noop = async (_text: string) => {};
    const sendReply = adapter.platform === 'telegram'
      ? async (text: string) => {
          const botToken = bridgeBot ? resolveStoredBridgeBotToken(bridgeBot) : undefined;
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
      botId ?? '',
      parsed.externalId,
      parsed.groupName,
      parsed.bindCode,
      sendReply,
      app.log,
    );
    return { statusCode: 200, body: adapter.okResponse };
  }

  if (config.bridge?.requireSignature && !bridgeBot?.config) {
    app.log.warn({ externalId: parsed.externalId, platform: adapter.platform }, '[Bridge] 拒绝未配置验签的请求');
    return { statusCode: 401, body: 'Signature required' };
  }

  let verificationSecret: string | undefined;
  if (!verificationSecret && adapter.platform === 'wecom') {
    const parsedCfg = parseStoredBridgeConfig(bridgeBot ?? {}) as { token?: string } | null;
    verificationSecret = parsedCfg?.token ?? undefined;
  }

  const verified = await adapter.verify(requestData, verificationSecret);
  if (!verified) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (!bridgeBot?.chatRoomId || !bridgeBot.enabled || !parsed.text) {
    return { statusCode: 200, body: adapter.okResponse };
  }

  await bridgeService.receiveBridgeMessage({
    botId: bridgeBot.id,
    platform: adapter.platform,
    externalId: parsed.externalId,
    senderName: parsed.senderName,
    content: parsed.text,
  });

  // Dedupe after successful processing so retries work on transient failures
  if (parsed.dedupeKey) {
    if (processedMessages.size >= 10000) {
      const keys = processedMessages.values();
      for (let i = 0; i < 1000; i++) {
        const { value, done } = keys.next();
        if (done) break;
        processedMessages.delete(value);
      }
    }
    processedMessages.add(parsed.dedupeKey);
  }

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

  // ──────────────── 机器人实例管理 ────────────────

  app.get('/api/bridge/bots', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { platform } = req.query as { platform?: Platform };
      const bots = await listBridgeBots({ platform, ownerId: user.id });
      return reply.send({ success: true, data: bots.map(maskBridgeBot) });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取机器人实例列表失败');
      return reply.status(500).send({ success: false, error: '获取机器人实例列表失败' });
    }
  });

  app.post('/api/bridge/bots', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const body = req.body as {
        platform: Platform;
        name: string;
        botToken?: string;
        defaultAgentId?: string | null;
        config?: Record<string, unknown>;
        chatRoomId?: string;
      };
      if (!body.platform || !body.name?.trim()) {
        return reply.status(400).send({ success: false, error: 'platform、name 为必填项' });
      }
      const bot = await bridgeService.createBot({ ...body, ownerId: user.id });
      await syncBridgeBotRuntime(bot.id, app.log);
      return reply.status(201).send({ success: true, data: maskBridgeBot(bot) });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 创建机器人实例失败');
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : '创建机器人实例失败' });
    }
  });

  app.patch('/api/bridge/bots/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { id } = req.params as { id: string };
      await assertBotOwner(id, user.id);
      const body = req.body as {
        name?: string;
        botToken?: string;
        defaultAgentId?: string | null;
        config?: Record<string, unknown> | null;
        enabled?: boolean;
      };
      const bot = await bridgeService.updateBot(id, body);
      await syncBridgeBotRuntime(bot.id, app.log);
      return reply.send({ success: true, data: maskBridgeBot(bot) });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 更新机器人实例失败');
      return reply.status(400).send({ success: false, error: err instanceof Error ? err.message : '更新机器人实例失败' });
    }
  });

  app.delete('/api/bridge/bots/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { id } = req.params as { id: string };
      await assertBotOwner(id, user.id);
      await bridgeService.deleteBot(id);
      await syncBridgeBotRuntime(id, app.log).catch(() => {});
      return reply.status(204).send();
    } catch (err) {
      app.log.error({ err }, '[Bridge] 删除机器人实例失败');
      return reply.status(500).send({ success: false, error: '删除机器人实例失败' });
    }
  });

  app.post('/api/bridge/bots/:id/bind', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { id } = req.params as { id: string };
      const body = req.body as { chatRoomId?: string; forceRebind?: boolean };
      if (!body.chatRoomId) {
        return reply.status(400).send({ success: false, error: 'chatRoomId 为必填项' });
      }
      await assertBotOwner(id, user.id);
      await assertChatRoomOwner(body.chatRoomId, user.id);
      const bot = await bridgeService.bindBot(id, body.chatRoomId, { forceRebind: body.forceRebind });
      return reply.send({ success: true, data: maskBridgeBot(bot) });
    } catch (err) {
      const message = err instanceof Error ? err.message : '绑定失败';
      return reply.status(409).send({ success: false, error: message });
    }
  });

  app.post('/api/bridge/bots/:id/unbind', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { id } = req.params as { id: string };
      await assertBotOwner(id, user.id);
      const bot = await bridgeService.unbindBot(id);
      return reply.send({ success: true, data: maskBridgeBot(bot) });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 解绑机器人实例失败');
      return reply.status(500).send({ success: false, error: '解绑机器人实例失败' });
    }
  });

  app.post('/api/bridge/bots/:id/bind-code', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    try {
      const { id } = req.params as { id: string };
      const { chatRoomId } = req.body as { chatRoomId?: string };
      const bot = await getBridgeBotById(id);
      if (!bot || !chatRoomId) {
        return reply.status(400).send({ success: false, error: 'botId 或 chatRoomId 无效' });
      }
      if (bot.ownerId && bot.ownerId !== user.id) {
        return reply.status(403).send({ success: false, error: '无权操作此机器人' });
      }
      await assertChatRoomOwner(chatRoomId, user.id);
      if (!(await hasBridgeBotCredentials(bot.id))) {
        return reply.status(400).send({ success: false, error: `请先配置 ${bot.platform} 机器人凭证` });
      }
      return reply.send({ success: true, data: createBridgeBotBindCode(bot.platform as Platform, bot.id, chatRoomId) });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 生成绑定码失败');
      return reply.status(500).send({ success: false, error: '生成绑定码失败' });
    }
  });

  app.get('/api/bridge/bots/:id/webhook-url', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const { id } = req.params as { id: string };
    const bot = await getBridgeBotById(id);
    if (!bot) {
      return reply.status(404).send({ success: false, error: '机器人实例不存在' });
    }
    if (bot.ownerId && bot.ownerId !== user.id) {
      return reply.status(403).send({ success: false, error: '无权操作此机器人' });
    }
    const base = await getBaseUrl();
    return reply.send({
      success: true,
      data: {
        webhookUrl: base ? buildBotWebhookUrls(base, id, bot.platform as Platform) : '',
      },
    });
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
        botId?: string;
        platform: Platform;
        externalId: string;
        senderName: string;
        content: string;
      };

      if (!body.platform || !body.externalId || !body.senderName || !body.content) {
        return reply.status(400).send({ success: false, error: 'platform、externalId、senderName、content 为必填项' });
      }

      const result = await bridgeService.receiveBridgeMessage({
        botId: body.botId,
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
    const supportsBotScopedPath = ['telegram', 'wecom', 'qq'].includes(adapter.platform);
    const routePath = supportsBotScopedPath ? `${adapter.path}/:botId` : adapter.path;
    app.post(routePath, async (req, reply) => {
      try {
        const { botId } = (req.params as { botId?: string }) ?? {};
        const result = await handleWebhookByAdapter(app, adapter, {
          body: req.body,
          headers: req.headers as Record<string, string | string[] | undefined>,
          query: { ...(req.query as Record<string, string>), ...(botId ? { botId } : {}) },
        }, botId);
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
  app.get('/api/bridge/webhook/wecom/:botId', async (req, reply) => {
    const { botId } = req.params as { botId?: string };
    const query = req.query as { msg_signature?: string; timestamp?: string; nonce?: string; echostr?: string };
    const { msg_signature, timestamp, nonce, echostr } = query;
    if (!echostr) return reply.status(400).send('Missing echostr');
    try {
      const bridgeBot = botId ? await getBridgeBotById(botId) : null;
      const parsedCfg = parseStoredBridgeConfig(bridgeBot ?? {}) as {
        encodingAESKey?: string;
        token?: string;
        corpId?: string;
      } | null;
      if (parsedCfg?.encodingAESKey) {
        // Fix #7: verify msg_signature BEFORE decrypting echostr
        if (parsedCfg.token) {
          if (!msg_signature || !timestamp || !nonce) {
            return reply.status(403).send('Forbidden');
          }
          const token = decrypt(parsedCfg.token);
          const str = [token, timestamp, nonce, echostr].sort().join('');
          const expected = createHash('sha1').update(str).digest('hex');
          if (expected !== msg_signature) {
            return reply.status(403).send('Forbidden');
          }
        }
        const decrypted = decryptWecomMessage(parsedCfg.encodingAESKey, echostr, parsedCfg.corpId);
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
      const messageIds = Array.from(new Set(events.map((event) => event.messageId).filter(Boolean))) as string[];
      const messages = messageIds.length > 0
        ? await prisma.message.findMany({
            where: { id: { in: messageIds } },
            select: { id: true, content: true },
          })
        : [];
      const messageMap = new Map(messages.map((message) => [message.id, message.content]));
      return reply.send({
        success: true,
        data: events.map((event) => ({
          ...event,
          contentPreview: event.contentPreview || (event.messageId ? messageMap.get(event.messageId) ?? '' : ''),
        })),
      });
    } catch (err) {
      app.log.error({ err }, '[Bridge] 获取事件列表失败');
      return reply.status(500).send({ success: false, error: '获取事件列表失败' });
    }
  });
}
