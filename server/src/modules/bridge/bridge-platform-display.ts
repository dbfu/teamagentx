import type { Platform } from './bridge.service.js';

export const BRIDGE_PLATFORM_DISPLAY_NAMES: Record<Platform, string> = {
  telegram: 'Telegram',
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企微',
  qq: 'QQ',
};

export function formatBridgeConversationSender(platform: string, externalId: string, senderName?: string): string {
  const platformName = BRIDGE_PLATFORM_DISPLAY_NAMES[platform as Platform] ?? platform;
  if (senderName && senderName.trim()) {
    return `${platformName}·${senderName.trim()}`;
  }
  return `${platformName}:${externalId}`;
}
