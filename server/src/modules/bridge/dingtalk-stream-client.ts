/**
 * 钉钉 Stream 长连接客户端
 * 使用 dingtalk-stream SDK，无需公网地址
 */
import { DWClient, type DWClientDownStream, EventAck, TOPIC_ROBOT } from 'dingtalk-stream';
import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';
import { parseStoredBridgeConfig } from './bridge-platform-config.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';

let dwClient: DWClient | null = null;
let currentClientId: string | null = null;
let isStarting = false;

// 绑定码处理（从 bridge.gateway.ts 注入）
type BindCodeHandler = (
  platform: string,
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

export async function startDingtalkStreamClient(
  clientId: string,
  clientSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  if (isStarting) {
    log.warn('[Bridge/Dingtalk-Stream] 正在启动中，忽略重复请求');
    return;
  }

  if (dwClient && currentClientId === clientId) {
    log.info('[Bridge/Dingtalk-Stream] 已连接，跳过重复启动');
    return;
  }

  isStarting = true;
  try {
    if (dwClient) {
      try { dwClient.disconnect(); } catch {}
      dwClient = null;
      currentClientId = null;
    }

    const adapter = getBridgeInboundTextAdapter('dingtalk');

    const client = new DWClient({ clientId, clientSecret, debug: false });

    client.registerAllEventListener((downstream: DWClientDownStream) => {
      if (downstream.headers.topic !== TOPIC_ROBOT) {
        return { status: EventAck.SUCCESS };
      }

      // 异步处理，立即 ACK 避免服务端重试
      handleRobotMessage(downstream, clientId, clientSecret, adapter, log).catch(err => {
        log.error({ err }, '[Bridge/Dingtalk-Stream] 消息处理失败');
      });

      return { status: EventAck.SUCCESS };
    });

    dwClient = client;
    currentClientId = clientId;

    setTimeout(async () => {
      try {
        log.info('[Bridge/Dingtalk-Stream] 启动 Stream 长连接...');
        await client.connect();
      } catch (err) {
        log.error({ err }, '[Bridge/Dingtalk-Stream] Stream 连接失败');
        dwClient = null;
        currentClientId = null;
      }
    }, 0);
  } finally {
    isStarting = false;
  }
}

async function handleRobotMessage(
  downstream: DWClientDownStream,
  _clientId: string,
  _clientSecret: string,
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

  // 只处理群消息（conversationType === '2'）
  if (!body.conversationId || body.conversationType !== '2') return;

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
    await bindCodeHandler('dingtalk', externalId, groupName, bindCode, sendReply, log);
    return;
  }

  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'dingtalk', externalId, enabled: true },
  });
  if (!channel) return;

  await bridgeService.receiveBridgeMessage({
    platform: 'dingtalk',
    externalId,
    senderName: body.senderNick ?? '未知用户',
    content: text,
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

export function stopDingtalkStreamClient(): void {
  if (dwClient) {
    try { dwClient.disconnect(); } catch {}
    dwClient = null;
    currentClientId = null;
  }
}

/**
 * 从数据库读取钉钉凭证并启动 Stream 客户端
 */
export async function initDingtalkStreamFromDB(
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  try {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'dingtalk' } });
    if (!platformCfg?.config) {
      log.info('[Bridge/Dingtalk-Stream] 未配置钉钉凭证，跳过');
      return;
    }
    const cfg = parseStoredBridgeConfig(platformCfg) as { appKey?: string; appSecret?: string } | null;
    if (!cfg?.appKey || !cfg.appSecret) {
      log.info('[Bridge/Dingtalk-Stream] 钉钉凭证不完整，跳过');
      return;
    }
    await startDingtalkStreamClient(cfg.appKey, cfg.appSecret, log);
  } catch (err) {
    log.error({ err }, '[Bridge/Dingtalk-Stream] 初始化失败');
  }
}
