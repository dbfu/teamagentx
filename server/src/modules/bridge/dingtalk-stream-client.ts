/**
 * 钉钉 Stream 长连接客户端
 * 使用 dingtalk-stream SDK，无需公网地址
 */
import { DWClient, type DWClientDownStream, EventAck, TOPIC_ROBOT } from 'dingtalk-stream';
import { bridgeService } from './bridge.service.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';

const dwClients = new Map<string, DWClient>();
// Fix #54: 移除 startingBotIds，改用 dwClients.has 判断（supervisor 循环中不需要独立标记）
const stoppedBotIds = new Set<string>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

export function setDingtalkBindCodeHandler(handler: BindCodeHandler) {
  bindCodeHandler = handler;
}

const MAX_RETRIES = 20;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

// Fix #41: supervisor loop with exponential backoff
async function supervisedConnect(
  botId: string,
  clientId: string,
  clientSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  let attempt = 0;

  while (!stoppedBotIds.has(botId)) {
    if (attempt >= MAX_RETRIES) {
      log.error({ botId }, '[Bridge/Dingtalk-Stream] 达到最大重试次数，需要手动重启 bot');
      dwClients.delete(botId);
      return;
    }

    try {
      const adapter = getBridgeInboundTextAdapter('dingtalk');
      const client = new DWClient({ clientId, clientSecret, debug: false });

      client.registerAllEventListener((downstream: DWClientDownStream) => {
        if (downstream.headers.topic !== TOPIC_ROBOT) {
          return { status: EventAck.SUCCESS };
        }

        // 异步处理，立即 ACK 避免服务端重试
        handleRobotMessage(botId, downstream, adapter, log).catch(err => {
          log.error({ err }, '[Bridge/Dingtalk-Stream] 消息处理失败');
        });

        return { status: EventAck.SUCCESS };
      });

      dwClients.set(botId, client);
      log.info({ botId, attempt }, '[Bridge/Dingtalk-Stream] 启动 Stream 长连接...');

      await client.connect();

      // connect() resolved normally — reset retry counter
      attempt = 0;
    } catch (err) {
      log.error({ err, botId, attempt }, '[Bridge/Dingtalk-Stream] Stream 连接失败');
      dwClients.delete(botId);

      if (stoppedBotIds.has(botId)) return;

      attempt++;
      const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
      log.info({ botId, attempt, delayMs: delay }, '[Bridge/Dingtalk-Stream] 将在延迟后重连...');

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        reconnectTimers.set(botId, timer);
      });
      reconnectTimers.delete(botId);
    }
  }
}

export async function startDingtalkStreamClient(
  botId: string,
  clientId: string,
  clientSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  if (dwClients.has(botId)) {
    log.info({ botId }, '[Bridge/Dingtalk-Stream] 已连接，跳过重复启动');
    return;
  }

  stoppedBotIds.delete(botId);

  // start supervisor in background
  setTimeout(() => {
    supervisedConnect(botId, clientId, clientSecret, log).catch(err => {
      log.error({ err, botId }, '[Bridge/Dingtalk-Stream] supervisor 异常退出');
    });
  }, 0);
}

async function handleRobotMessage(
  botId: string,
  downstream: DWClientDownStream,
  adapter: ReturnType<typeof getBridgeInboundTextAdapter>,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
) {
  type DingtalkRobotBody = {
    msgId?: string;
    conversationId?: string;
    conversationType?: string;
    conversationTitle?: string;
    senderNick?: string;
    text?: { content?: string };
    senderStaffId?: string;
    chatbotUserId?: string;
    sessionWebhook?: string;
  };

  let body: DingtalkRobotBody;
  try {
    body = JSON.parse(downstream.data) as DingtalkRobotBody;
  } catch {
    return;
  }

  if (!body.conversationId) return;

  const externalId = body.conversationId;
  const rawText = body.text?.content ?? '';
  const text = adapter.normalizeText(rawText);
  if (!text) return;

  // 处理 /bind CODE
  const bindCode = adapter.extractBindCode(text);
  if (bindCode && bindCodeHandler) {
    const groupName = body.conversationTitle ?? `钉钉群 ${externalId}`;
    const sessionWebhook = body.sessionWebhook;
    const sendReply = async (replyText: string) => {
      if (sessionWebhook) {
        await sendViaSessionWebhook(sessionWebhook, replyText, log);
      }
    };
    await bindCodeHandler('dingtalk', botId, externalId, groupName, bindCode, sendReply, log);
    return;
  }

  // Fix #42: add dedupeKey to prevent duplicate responses on reconnect
  await bridgeService.receiveBridgeMessage({
    botId,
    platform: 'dingtalk',
    externalId,
    replyTarget: body.sessionWebhook ? `sessionWebhook:${body.sessionWebhook}` : externalId,
    senderName: body.senderNick ?? '未知用户',
    content: text,
    dedupeKey: body.msgId ? `dingtalk:${body.msgId}` : undefined,
  });
}

const ALLOWED_WEBHOOK_HOSTS = ['oapi.dingtalk.com', 'api.dingtalk.com'];

async function sendViaSessionWebhook(
  sessionWebhook: string,
  text: string,
  log: { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  try {
    const webhookUrl = new URL(sessionWebhook);
    if (!ALLOWED_WEBHOOK_HOSTS.includes(webhookUrl.hostname)) {
      log.warn({ sessionWebhook }, '[Bridge/DingTalk] sessionWebhook 来源域名不受信任，跳过回复');
      return;
    }
  } catch {
    log.warn('[Bridge/DingTalk] sessionWebhook URL 格式无效');
    return;
  }

  try {
    await fetch(sessionWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    });
  } catch (err) {
    log.error({ err }, '[Bridge/Dingtalk-Stream] 回复消息失败');
  }
}

export function stopDingtalkStreamClient(botId: string): void {
  stoppedBotIds.add(botId);

  // Cancel any pending reconnect timer
  const timer = reconnectTimers.get(botId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(botId);
  }

  const dwClient = dwClients.get(botId);
  if (dwClient) {
    try { dwClient.disconnect(); } catch {}
    dwClients.delete(botId);
  }
}
