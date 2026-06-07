import type { Platform } from './bridge.service.js';

export interface BridgePlatformConfigFieldDefinition {
  key: string;
  label: string;
  description?: string;
  secret?: boolean;
  optional?: boolean;
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
  /** Whether this platform receives events via a public webhook URL */
  requiresPublicWebhook?: boolean;
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
    requiresPublicWebhook: true,
    configFields: [{ key: 'botToken', label: 'Bot Token', secret: true }],
  },
  {
    key: 'feishu',
    label: '飞书',
    emoji: '🪶',
    color: '#1664FF',
    groupIdHint: '飞书 chat_id（如 oc_xxxxx）',
    supportsBindCode: true,
    supportsManualChannelCreate: true,
    configFields: [
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', secret: true },
      {
        key: 'defaultExternalId',
        label: '默认飞书会话 ID（可选，chat_id）',
        description: '用于从 TeamAgentX 主动推送消息到飞书。未填写时，必须先让飞书群里发一条消息，系统记住最近会话后才能回推。可从最近的飞书入站事件 externalId 获取，通常形如 oc_xxx。',
        optional: true,
      },
    ],
  },
  {
    key: 'dingtalk',
    label: '钉钉',
    emoji: '📌',
    color: '#1675FF',
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
    requiresPublicWebhook: true,
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
    requiresPublicWebhook: true,
    configFields: [
      { key: 'appId', label: 'App ID' },
      { key: 'clientSecret', label: 'Client Secret', secret: true },
      { key: 'publicKey', label: 'Bot Public Key（可选，用于 Webhook 签名验证）', optional: true },
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
