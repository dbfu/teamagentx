import type { Platform } from './bridge.service.js';
import { parseStoredBridgeConfig } from './bridge-platform-config.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';
import { verifyTelegram, verifyWecom } from './webhook-verify.js';
import { decryptWecomMessage } from './wecom-crypto.js';
import prisma from '../../lib/prisma.js';
import { createHash, createVerify } from 'crypto';

export interface BridgeWebhookRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string>;
  /** 原始请求体字符串，用于需要原始字节的签名验证（如 QQ Ed25519） */
  rawBody?: string;
}

export type BridgeWebhookParseResult =
  | { kind: 'ignore' }
  | { kind: 'challenge'; responseBody: unknown }
  | {
      kind: 'message';
      externalId: string;
      groupName: string;
      senderName: string;
      text: string;
      bindCode: string | null;
      dedupeKey?: string;
    };

export interface BridgeWebhookAdapter {
  platform: Platform;
  path: string;
  okResponse: unknown;
  parse(request: BridgeWebhookRequest): Promise<BridgeWebhookParseResult>;
  verify(request: BridgeWebhookRequest, webhookSecret?: string | null): Promise<boolean>;
}

type TelegramWebhookBody = {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: { first_name?: string; username?: string; id?: number };
    chat?: { id?: number; title?: string; type?: string };
    text?: string;
  };
};

type WecomWebhookBody = {
  FromUserName?: string;
  ChatId?: string;
  Content?: string;
  MsgType?: string;
  MsgId?: string;
  Encrypt?: string;
};

type QQWebhookBody = {
  t?: string;
  id?: string;
  d?: {
    author?: { member_openid?: string };
    content?: string;
    group_openid?: string;
  };
};

async function parseWecomBody(
  rawBody: WecomWebhookBody,
  query: Record<string, string>,
  botId?: string,
): Promise<WecomWebhookBody> {
  if (!rawBody.Encrypt) return rawBody;

  const bridgeBot = botId
    ? await prisma.bridgeBot.findUnique({
        where: { id: botId },
        select: { config: true },
      })
    : null;
  try {
    const platformConfig = parseStoredBridgeConfig(bridgeBot ?? {}) as {
      encodingAESKey?: string;
      token?: string;
      corpId?: string;
    } | null;
    if (platformConfig?.encodingAESKey) {
      // Fix #6: verify signature BEFORE decrypting
      if (platformConfig.token) {
        const token = platformConfig.token;
        const { msg_signature, timestamp, nonce } = query;
        if (!msg_signature || !timestamp || !nonce) {
          throw new Error('WeCom signature params missing');
        }
        const str = [token, timestamp, nonce, rawBody.Encrypt].sort().join('');
        const expected = createHash('sha1').update(str).digest('hex');
        if (expected !== msg_signature) {
          throw new Error('WeCom signature verification failed');
        }
      }
      const decryptedXml = decryptWecomMessage(
        platformConfig.encodingAESKey,
        rawBody.Encrypt,
        platformConfig.corpId,
      );
      return buildWecomBodyFromXml(decryptedXml);
    }
  } catch (err) {
    // Re-throw signature verification failures; ignore other config errors
    if (err instanceof Error && err.message.includes('verification failed')) throw err;
    if (err instanceof Error && err.message.includes('params missing')) throw err;
    console.warn('[Bridge][WeCom] 消息解密失败，降级为原始 body:', err instanceof Error ? err.message : err);
  }

  return rawBody;
}

function buildWecomBodyFromXml(decryptedXml: string): WecomWebhookBody {
  const extractTag = (xml: string, tag: string) => {
    const match = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
    return match?.[1] ?? undefined;
  };

  return {
    FromUserName: extractTag(decryptedXml, 'FromUserName'),
    ChatId: extractTag(decryptedXml, 'ChatId'),
    Content: extractTag(decryptedXml, 'Content'),
    MsgType: extractTag(decryptedXml, 'MsgType'),
    MsgId: extractTag(decryptedXml, 'MsgId'),
  };
}

export const BRIDGE_WEBHOOK_ADAPTERS: BridgeWebhookAdapter[] = [
  {
    platform: 'telegram',
    path: '/api/bridge/webhook/telegram',
    okResponse: 'ok',
    async parse(request) {
      const adapter = getBridgeInboundTextAdapter('telegram');
      const body = request.body as TelegramWebhookBody;
      const msg = body.message;
      if (!msg?.chat?.id || !msg.text) return { kind: 'ignore' };

      const bindCode = adapter.extractBindCode(msg.text);
      return {
        kind: 'message',
        externalId: String(msg.chat.id),
        groupName: msg.chat.title ?? `Telegram 群 ${String(msg.chat.id)}`,
        senderName: msg.from?.username
          ? `${msg.from.first_name ?? msg.from.username}(@${msg.from.username})`
          : (msg.from?.first_name ?? '未知用户'),
        text: adapter.normalizeText(msg.text),
        bindCode,
        dedupeKey: msg.message_id != null ? `telegram:${String(msg.message_id)}` : undefined,
      };
    },
    async verify(request, webhookSecret) {
      return verifyTelegram(request.headers, webhookSecret);
    },
  },
  {
    platform: 'wecom',
    path: '/api/bridge/webhook/wecom',
    okResponse: 'ok',
    async parse(request) {
      const adapter = getBridgeInboundTextAdapter('wecom');
      const body = await parseWecomBody(request.body as WecomWebhookBody, request.query, request.query.botId);
      if (!body.ChatId) return { kind: 'ignore' };
      if (body.MsgType && body.MsgType !== 'text') return { kind: 'ignore' };

      const text = adapter.normalizeText(body.Content ?? '');
      return {
        kind: 'message',
        externalId: body.ChatId,
        groupName: `企微群 ${body.ChatId}`,
        senderName: body.FromUserName ?? '未知用户',
        text,
        bindCode: adapter.extractBindCode(text),
        dedupeKey: body.MsgId ? `wecom:${body.MsgId}` : undefined,
      };
    },
    async verify(request, webhookSecret) {
      return verifyWecom(request.query, webhookSecret);
    },
  },
  {
    platform: 'qq',
    path: '/api/bridge/webhook/qq',
    okResponse: 'ok',
    async parse(request) {
      const adapter = getBridgeInboundTextAdapter('qq');
      const body = request.body as QQWebhookBody;
      if (body.t !== 'GROUP_AT_MESSAGE_CREATE' || !body.d?.group_openid) {
        return { kind: 'ignore' };
      }

      const text = adapter.normalizeText(body.d.content ?? '');
      return {
        kind: 'message',
        externalId: body.d.group_openid,
        groupName: `QQ群 ${body.d.group_openid}`,
        senderName: body.d.author?.member_openid ?? '未知用户',
        text,
        bindCode: adapter.extractBindCode(text),
        dedupeKey: body.id ? `qq:${body.id}` : undefined,
      };
    },
    async verify(request) {
      const sig = request.headers['x-signature-ed25519'];
      const ts = request.headers['x-signature-timestamp'];

      if (!sig || !ts) {
        console.warn('[Bridge][QQ] 缺少 Ed25519 签名头，已放行（未配置公钥）');
        return true;
      }

      // 从请求 query 中取 botId，查询 publicKey 配置
      const botId = request.query.botId;
      if (botId) {
        const bridgeBot = await prisma.bridgeBot.findUnique({
          where: { id: botId },
          select: { config: true },
        });
        const cfg = parseStoredBridgeConfig(bridgeBot ?? {}) as { publicKey?: string } | null;
        if (cfg?.publicKey) {
          try {
            const rawBody = request.rawBody ?? JSON.stringify(request.body);
            const msgBuf = Buffer.from((Array.isArray(ts) ? ts[0] : ts) + rawBody);
            const sigHex = Array.isArray(sig) ? sig[0] : sig;
            const sigBuf = Buffer.from(sigHex, 'hex');
            const pubKeyBuf = Buffer.from(cfg.publicKey, 'hex');
            const verified = createVerify('ed25519').update(msgBuf).verify(pubKeyBuf, sigBuf);
            if (!verified) {
              console.warn('[Bridge][QQ] Ed25519 签名验证失败');
            }
            return verified;
          } catch (err) {
            console.error('[Bridge][QQ] Ed25519 签名验证异常:', err instanceof Error ? err.message : err);
            return false;
          }
        }
      }

      console.warn('[Bridge][QQ] 签名头存在但未配置公钥，已放行');
      return true;
    },
  },
];

const adapterMap = new Map<Platform, BridgeWebhookAdapter>(
  BRIDGE_WEBHOOK_ADAPTERS.map((adapter) => [adapter.platform, adapter]),
);

export function getBridgeWebhookAdapter(platform: Platform): BridgeWebhookAdapter {
  const adapter = adapterMap.get(platform);
  if (!adapter) {
    throw new Error(`Unsupported bridge webhook platform: ${platform}`);
  }
  return adapter;
}
