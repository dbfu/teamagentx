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
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

const MAX_RETRIES = 20;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;
const NAME_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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

// Fix #41: supervisor loop with exponential backoff
async function supervisedStart(
  botId: string,
  appId: string,
  appSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  let attempt = 0;

  while (!stoppedBotIds.has(botId)) {
    if (attempt >= MAX_RETRIES) {
      log.error({ botId }, '[Bridge/Feishu-WS] 达到最大重试次数，需要手动重启 bot');
      wsClients.delete(botId);
      return;
    }

    try {
      const adapter = getBridgeInboundTextAdapter('feishu');

      const dispatcher = new EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          try {
            const msg = data.message;
            if (!msg?.chat_id) return;

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
            });
          } catch (err) {
            log.error({ err }, '[Bridge/Feishu-WS] 消息处理失败');
          }
        },
      });

      const wsClient = new WSClient({ appId, appSecret });
      wsClients.set(botId, wsClient);
      log.info({ botId, attempt }, '[Bridge/Feishu-WS] 启动 WebSocket 长连接...');

      // Fix #37: properly catch promise rejection from wsClient.start()
      await wsClient.start({ eventDispatcher: dispatcher });

      // start() resolved normally — reset retry counter but wait before reconnecting
      attempt = 0;
      if (stoppedBotIds.has(botId)) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, BASE_DELAY_MS);
        reconnectTimers.set(botId, timer);
      });
      reconnectTimers.delete(botId);
    } catch (err) {
      log.error({ err, botId, attempt }, '[Bridge/Feishu-WS] WebSocket 连接失败');
      wsClients.delete(botId);

      if (stoppedBotIds.has(botId)) return;

      attempt++;
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
      log.info({ botId, attempt, delayMs: delay }, '[Bridge/Feishu-WS] 将在延迟后重连...');

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        reconnectTimers.set(botId, timer);
      });
      reconnectTimers.delete(botId);
    }
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

  // Cancel any pending reconnect timer
  const timer = reconnectTimers.get(botId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(botId);
  }

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
