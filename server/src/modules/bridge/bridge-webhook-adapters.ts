import prisma from '../../lib/prisma.js';
import type { Platform } from './bridge.service.js';
import { parseStoredBridgeConfig } from './bridge-platform-config.js';
import { getBridgeInboundTextAdapter } from './platform-inbound-adapters.js';
import { verifyTelegram, verifyWecom } from './webhook-verify.js';
import { decryptWecomMessage } from './wecom-crypto.js';

export interface BridgeWebhookRequest {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string>;
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

async function parseWecomBody(rawBody: WecomWebhookBody): Promise<WecomWebhookBody> {
  if (!rawBody.Encrypt) return rawBody;

  const platformCfg = await prisma.platformConfig.findUnique({
    where: { platform: 'wecom' },
    select: { config: true },
  });
  try {
    const platformConfig = parseStoredBridgeConfig(platformCfg ?? {}) as { encodingAESKey?: string } | null;
    if (platformConfig?.encodingAESKey) {
      const decryptedXml = decryptWecomMessage(platformConfig.encodingAESKey, rawBody.Encrypt);
      return buildWecomBodyFromXml(decryptedXml);
    }
  } catch {
    // fall through to channel-scoped config lookup
  }

  const wecomChannels = await prisma.externalChannel.findMany({
    where: { platform: 'wecom', enabled: true },
  });

  for (const ch of wecomChannels) {
    try {
      if (!ch.config) continue;
      const cfg = parseStoredBridgeConfig(ch) as { encodingAESKey?: string } | null;
      if (!cfg?.encodingAESKey) continue;
      const decryptedXml = decryptWecomMessage(cfg.encodingAESKey, rawBody.Encrypt);
      return buildWecomBodyFromXml(decryptedXml);
    } catch {
      // try next configured channel
    }
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
      if (!bindCode && msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        return { kind: 'ignore' };
      }

      return {
        kind: 'message',
        externalId: String(msg.chat.id),
        groupName: msg.chat.title ?? `Telegram 群 ${String(msg.chat.id)}`,
        senderName: msg.from?.username
          ? `${msg.from.first_name ?? ''}(@${msg.from.username})`
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
      const body = await parseWecomBody(request.body as WecomWebhookBody);
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
    async verify() {
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
