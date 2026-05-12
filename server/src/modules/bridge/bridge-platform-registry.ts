import type { Platform } from './bridge.service.js';

export interface BridgePlatformConfigFieldDefinition {
  key: string;
  label: string;
  secret?: boolean;
}

export interface BridgePlatformDefinition {
  key: Platform;
  label: string;
  emoji: string;
  color: string;
  groupIdHint: string;
  supportsBindCode: boolean;
  supportsManualChannelCreate: boolean;
  configFields: BridgePlatformConfigFieldDefinition[];
}

export const BRIDGE_PLATFORM_REGISTRY: BridgePlatformDefinition[] = [
  {
    key: 'telegram',
    label: 'Telegram',
    emoji: '✈️',
    color: '#0088cc',
    groupIdHint: 'Telegram Chat ID（如 -100123456789）',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [{ key: 'botToken', label: 'Bot Token', secret: true }],
  },
  {
    key: 'feishu',
    label: '飞书',
    emoji: '🪶',
    color: '#1664FF',
    groupIdHint: '飞书 open_chat_id（如 oc_xxxxx）',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', secret: true },
    ],
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    emoji: '📌',
    color: '#FF6400',
    groupIdHint: '钉钉群 conversationId',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [
      { key: 'appKey', label: 'App Key' },
      { key: 'appSecret', label: 'App Secret', secret: true },
    ],
  },
  {
    key: 'wecom',
    label: '企业微信',
    emoji: '💬',
    color: '#07C160',
    groupIdHint: '企业微信群 chat_id',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [
      { key: 'corpId', label: 'Corp ID' },
      { key: 'agentSecret', label: 'Agent Secret', secret: true },
      { key: 'token', label: 'Token', secret: true },
      { key: 'encodingAESKey', label: 'EncodingAESKey', secret: true },
    ],
  },
  {
    key: 'qq',
    label: 'QQ',
    emoji: '🐧',
    color: '#12B7F5',
    groupIdHint: 'QQ 群号',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [
      { key: 'appId', label: 'App ID' },
      { key: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
];

const registryMap = new Map<Platform, BridgePlatformDefinition>(
  BRIDGE_PLATFORM_REGISTRY.map((definition) => [definition.key, definition]),
);

export function listBridgePlatformDefinitions(): BridgePlatformDefinition[] {
  return BRIDGE_PLATFORM_REGISTRY;
}

export function getBridgePlatformDefinition(platform: Platform): BridgePlatformDefinition {
  const definition = registryMap.get(platform);
  if (!definition) {
    throw new Error(`Unsupported bridge platform: ${platform}`);
  }
  return definition;
}
