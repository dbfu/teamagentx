/**
 * 飞书 WebSocket 长连接客户端
 * 使用 @larksuiteoapi/node-sdk 的 WSClient，无需公网地址
 */
import lark from '@larksuiteoapi/node-sdk';
import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';
import { parseStoredBridgeConfig } from './bridge-platform-config.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';

const { WSClient, EventDispatcher } = lark;

let wsClient: InstanceType<typeof WSClient> | null = null;
let currentAppId: string | null = null;
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

export function setFeishuBindCodeHandler(handler: BindCodeHandler) {
  bindCodeHandler = handler;
}

export async function startFeishuWSClient(
  appId: string,
  appSecret: string,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  if (isStarting) {
    log.warn('[Bridge/Feishu-WS] 正在启动中，忽略重复请求');
    return;
  }

  // 已有相同 appId 的连接，跳过
  if (wsClient && currentAppId === appId) {
    log.info('[Bridge/Feishu-WS] 已连接，跳过重复启动');
    return;
  }

  isStarting = true;
  try {
    // 停止旧连接
    if (wsClient) {
      try { wsClient.close(); } catch {}
      wsClient = null;
      currentAppId = null;
    }

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
            await bindCodeHandler('feishu', externalId, `飞书群 ${externalId}`, bindCode, sendReply, log);
            return;
          }

          // 只处理群消息
          if (msg.chat_type !== 'group') return;

          const channel = await prisma.externalChannel.findFirst({
            where: { platform: 'feishu', externalId, enabled: true },
          });
          if (!channel) return;

          const openId = data.sender?.sender_id?.open_id ?? '未知用户';

          await bridgeService.receiveBridgeMessage({
            platform: 'feishu',
            externalId,
            senderName: openId,
            content: text,
          });
        } catch (err) {
          log.error({ err }, '[Bridge/Feishu-WS] 消息处理失败');
        }
      },
    });

    wsClient = new WSClient({ appId, appSecret });
    currentAppId = appId;

    // start() 会阻塞，用 setTimeout 异步启动
    setTimeout(async () => {
      try {
        log.info('[Bridge/Feishu-WS] 启动 WebSocket 长连接...');
        await wsClient!.start({ eventDispatcher: dispatcher });
      } catch (err) {
        log.error({ err }, '[Bridge/Feishu-WS] WebSocket 连接失败');
        wsClient = null;
        currentAppId = null;
      }
    }, 0);
  } finally {
    isStarting = false;
  }
}

export function stopFeishuWSClient(): void {
  if (wsClient) {
    try { wsClient.close(); } catch {}
    wsClient = null;
    currentAppId = null;
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

/**
 * 从数据库读取飞书凭证并启动 WS 客户端
 * 在 app.ts 启动时调用
 */
export async function initFeishuWSFromDB(
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void },
): Promise<void> {
  try {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'feishu' } });
    if (!platformCfg?.config) {
      log.info('[Bridge/Feishu-WS] 未配置飞书凭证，跳过');
      return;
    }
    const cfg = parseStoredBridgeConfig(platformCfg) as { appId?: string; appSecret?: string } | null;
    if (!cfg?.appId || !cfg.appSecret) {
      log.info('[Bridge/Feishu-WS] 飞书凭证不完整，跳过');
      return;
    }
    await startFeishuWSClient(cfg.appId, cfg.appSecret, log);
  } catch (err) {
    log.error({ err }, '[Bridge/Feishu-WS] 初始化失败');
  }
}
