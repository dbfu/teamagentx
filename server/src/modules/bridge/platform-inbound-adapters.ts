import type { Platform } from './bridge.service.js';

export interface BridgeInboundTextAdapter {
  platform: Platform;
  normalizeText(rawText: string): string;
  extractBindCode(text: string): string | null;
}

const BIND_COMMAND_PATTERN = /^\/bind\s+([A-Z0-9]{6,12})$/i;

export function extractBindCode(text: string): string | null {
  const match = text.trim().match(BIND_COMMAND_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * 只删 Telegram bot 用户名格式的 @mention（纯 ASCII 字母/数字/下划线）。
 * 助手名含中文（如 @工程师助手）不会被删除，保留供 parseMentions 识别。
 */
function stripTelegramBotMention(text: string): string {
  return text.replace(/^@[a-zA-Z0-9_]+\s*/, '').trim();
}

/**
 * 飞书：只删平台系统用户 mention（@_user_123 格式），保留助手名 mention。
 */
function stripFeishuMentions(text: string): string {
  return text.replace(/@_user_\d+\s*/g, '').trim();
}

/**
 * 钉钉群消息固定以 "@机器人名 " 开头，只删行首第一个 @word，其余保留。
 * 用户在后面显式写的 @助手名 不受影响。
 */
function stripDingtalkBotMention(text: string): string {
  return text.replace(/^@\S+\s*/, '').trim();
}

function stripLeadingBotMention(text: string): string {
  return text.replace(/^@\S+\s*/, '').trim();
}

/**
 * QQ：删除平台 <@mention> 格式，保留普通 @文字 供 parseMentions 使用。
 */
function stripQQMentions(text: string): string {
  return stripLeadingBotMention(text.replace(/<@[^>]+>\s*/g, '').trim());
}

export const BRIDGE_INBOUND_TEXT_ADAPTERS: BridgeInboundTextAdapter[] = [
  {
    platform: 'telegram',
    normalizeText(rawText) {
      return stripTelegramBotMention(rawText);
    },
    extractBindCode,
  },
  {
    platform: 'feishu',
    normalizeText(rawText) {
      return stripFeishuMentions(rawText);
    },
    extractBindCode,
  },
  {
    platform: 'dingtalk',
    normalizeText(rawText) {
      return stripDingtalkBotMention(rawText);
    },
    extractBindCode,
  },
  {
    platform: 'wecom',
    normalizeText(rawText) {
      return stripLeadingBotMention(rawText.trim());
    },
    extractBindCode,
  },
  {
    platform: 'qq',
    normalizeText(rawText) {
      return stripQQMentions(rawText);
    },
    extractBindCode,
  },
];

const adapterMap = new Map<Platform, BridgeInboundTextAdapter>(
  BRIDGE_INBOUND_TEXT_ADAPTERS.map((adapter) => [adapter.platform, adapter]),
);

export function getBridgeInboundTextAdapter(platform: Platform): BridgeInboundTextAdapter {
  const adapter = adapterMap.get(platform);
  if (!adapter) {
    throw new Error(`Unsupported inbound bridge platform: ${platform}`);
  }
  return adapter;
}
