/**
 * 飞书 WebSocket 长连接客户端
 * 使用 @larksuiteoapi/node-sdk 的 WSClient，无需公网地址
 */
import lark from '@larksuiteoapi/node-sdk';
import { bridgeService } from './bridge.service.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';

const { WSClient, EventDispatcher } = lark;

const wsClients = new Map<string, InstanceType<typeof WSClient>>();
const stoppedBotIds = new Set<string>();

// Fix #55: cache for resolved sender names (open_id -> display name), TTL 1 hour
const nameCache = new Map<string, { name: string; expiresAt: number }>();

// 绑定码处理（从 bridge.gateway.ts 注入）
type BindCodeHandler = (
  platform: string,
  botId: string,
  externalId: string,
  groupName: string,
  code: string,
  sendReply: (t: string) => Promise<void>,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
) => Promise<boolean>;

let bindCodeHandler: BindCodeHandler | null = null;

export function setFeishuBindCodeHandler(handler: BindCodeHandler) {
  bindCodeHandler = handler;
}

const NAME_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FEISHU_STALE_MESSAGE_GRACE_MS = 60 * 1000;

export function parseFeishuMessageTimestamp(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

// Fix #55: resolve open_id to display name, with cache
async function resolveFeishuSenderName(
  openId: string,
  appId: string,
  appSecret: string,
  log: { error: (...a: unknown[]) => void },
): Promise<string> {
  const cached = nameCache.get(openId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = await tokenRes.json() as { tenant_access_token?: string };
    if (!tokenData.tenant_access_token) return openId;

    const userRes = await fetch(
      `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
      { headers: { 'Authorization': `Bearer ${tokenData.tenant_access_token}` } },
    );
    const userData = await userRes.json() as { data?: { user?: { name?: string } } };
    const name = userData.data?.user?.name;
    if (name) {
      nameCache.set(openId, { name, expiresAt: Date.now() + NAME_CACHE_TTL_MS });
      return name;
    }
  } catch (err) {
    log.error({ err, openId }, '[Bridge/Feishu-WS] 解析发送者名称失败，回退到 open_id');
  }

  return openId;
}

// The Lark SDK resolves start() once the client is ready; it keeps the
// websocket and reconnect loop alive internally after that.
async function supervisedStart(
  botId: string,
  appId: string,
  appSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  try {
    const adapter = getBridgeInboundTextAdapter('feishu');
    const clientStartedAt = Date.now();

    const dispatcher = new EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        try {
          const msg = data.message;
          if (!msg?.chat_id) return;

          const senderType = data.sender?.sender_type;
          if (senderType && senderType !== 'user') {
            log.info(
              { botId, senderType, messageId: msg.message_id },
              '[Bridge/Feishu-WS] 忽略非用户消息，避免机器人自发消息回环',
            );
            return;
          }

          if (msg.message_type === 'interactive') {
            log.info(
              { botId, messageId: msg.message_id },
              '[Bridge/Feishu-WS] 忽略飞书卡片消息，避免机器人自发消息回环',
            );
            return;
          }

          const messageCreatedAt = parseFeishuMessageTimestamp(msg.create_time);
          if (messageCreatedAt && messageCreatedAt < clientStartedAt - FEISHU_STALE_MESSAGE_GRACE_MS) {
            log.info(
              { botId, messageId: msg.message_id, createTime: msg.create_time },
              '[Bridge/Feishu-WS] 忽略启动前的历史消息，避免重连后重复触发',
            );
            return;
          }

          const externalId = msg.chat_id;

          // 提取文本
          let rawText = '';
          try {
            const parsed = JSON.parse(msg.content ?? '{}') as { text?: string };
            rawText = parsed.text ?? '';
          } catch {
            rawText = msg.content ?? '';
          }

          const text = adapter.normalizeText(rawText);
          if (!text) return;

          // 处理 /bind CODE
          const bindCode = adapter.extractBindCode(text);
          if (bindCode && bindCodeHandler) {
            const sendReply = async (replyText: string) => {
              await sendFeishuMessage(appId, appSecret, externalId, replyText, log);
            };
            await bindCodeHandler('feishu', botId, externalId, `飞书群 ${externalId}`, bindCode, sendReply, log);
            return;
          }

          const openId = data.sender?.sender_id?.open_id ?? '未知用户';
          // Fix #55: resolve display name from open_id
          const senderName = openId !== '未知用户'
            ? await resolveFeishuSenderName(openId, appId, appSecret, log)
            : openId;

          // Fix #43: add dedupeKey to prevent duplicate responses on reconnect
          await bridgeService.receiveBridgeMessage({
            botId,
            platform: 'feishu',
            externalId,
            senderName,
            content: text,
            dedupeKey: msg.message_id ? `feishu:${msg.message_id}` : undefined,
            sourceMessageId: msg.message_id,
          });
        } catch (err) {
          log.error({ err }, '[Bridge/Feishu-WS] 消息处理失败');
        }
      },
    });

    const wsClient = new WSClient({
      appId,
      appSecret,
      onReady: () => log.info({ botId }, '[Bridge/Feishu-WS] WebSocket 长连接已就绪'),
      onReconnecting: () => log.warn({ botId }, '[Bridge/Feishu-WS] WebSocket 断开，SDK 正在重连'),
      onReconnected: () => log.info({ botId }, '[Bridge/Feishu-WS] WebSocket 已重连'),
      onError: (err) => {
        log.error({ err, botId }, '[Bridge/Feishu-WS] WebSocket 连接失败，需要检查飞书应用长连接配置或连接数量');
        wsClients.delete(botId);
      },
    });
    wsClients.set(botId, wsClient);
    log.info({ botId }, '[Bridge/Feishu-WS] 启动 WebSocket 长连接...');

    // Fix #37: properly catch promise rejection from wsClient.start()
    await wsClient.start({ eventDispatcher: dispatcher });
  } catch (err) {
    log.error({ err, botId }, '[Bridge/Feishu-WS] WebSocket 启动异常');
    wsClients.delete(botId);
  }
}

export async function startFeishuWSClient(
  botId: string,
  appId: string,
  appSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  if (wsClients.has(botId)) {
    log.info({ botId }, '[Bridge/Feishu-WS] 已连接，跳过重复启动');
    return;
  }

  stoppedBotIds.delete(botId);

  // start supervisor in background; Fix #37: no discarded promise
  setTimeout(() => {
    supervisedStart(botId, appId, appSecret, log).catch((err) => {
      log.error({ err, botId }, '[Bridge/Feishu-WS] supervisor 异常退出');
    });
  }, 0);
}

export function stopFeishuWSClient(botId: string): void {
  stoppedBotIds.add(botId);

  const wsClient = wsClients.get(botId);
  if (wsClient) {
    try { wsClient.close(); } catch {}
    wsClients.delete(botId);
  }
}

async function sendFeishuMessage(
  appId: string,
  appSecret: string,
  chatId: string,
  text: string,
  log: { error: (...a: unknown[]) => void },
): Promise<void> {
  try {
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = await tokenRes.json() as { tenant_access_token?: string };
    if (!tokenData.tenant_access_token) return;

    await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokenData.tenant_access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });
  } catch (err) {
    log.error({ err }, '[Bridge/Feishu-WS] 发送消息失败');
  }
}
