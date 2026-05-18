import type { Platform } from './bridge.service.js';

export interface BridgePlatformCredentialField {
  key: string;
  label: string;
  howToGet: string;
  secret?: boolean;
}

export interface BridgePlatformPlaybook {
  platform: Platform;
  title: string;
  consoleName: string;
  prerequisites: string[];
  requiredCredentials: BridgePlatformCredentialField[];
  consoleSteps: string[];
  bindSteps: string[];
  notes: string[];
}

export const BRIDGE_PLATFORM_PLAYBOOKS: BridgePlatformPlaybook[] = [
  {
    platform: 'telegram',
    title: 'Telegram',
    consoleName: '@BotFather',
    prerequisites: [
      '需要一个 Telegram 账号',
      '默认使用轮询模式，无需公网地址；如已有公网地址也可配置 Webhook 模式',
    ],
    requiredCredentials: [
      {
        key: 'botToken',
        label: 'Bot Token',
        howToGet: '在 @BotFather 中执行 /newbot 后获取',
        secret: true,
      },
    ],
    consoleSteps: [
      '打开 Telegram，搜索 @BotFather',
      '发送 /newbot，按提示填写机器人名称和用户名',
      '复制 BotFather 返回的 Bot Token',
    ],
    bindSteps: [
      '把 Bot Token 交给 TeamAgentX 接入助手保存并绑定',
      '直接私聊该 Telegram 机器人，发一条消息，消息就会进入绑定的 TeamAgentX 群聊',
    ],
    notes: [
      'Telegram 单条消息上限 4096 字符，系统会自动分段回发',
      '用户与机器人 1-on-1 私聊即可，无需把机器人拉入任何群',
      '默认使用 Polling 轮询模式，无需公网地址',
    ],
  },
  {
    platform: 'feishu',
    title: '飞书',
    consoleName: '飞书开放平台',
    prerequisites: [
      '需要企业或团队拥有飞书开放平台权限',
      '需要管理员允许自建应用进入群聊',
    ],
    requiredCredentials: [
      {
        key: 'appId',
        label: 'App ID',
        howToGet: '飞书开放平台自建应用基础信息页',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        howToGet: '飞书开放平台凭证与基础信息页',
        secret: true,
      },
    ],
    consoleSteps: [
      '优先使用一键创建入口：https://open.feishu.cn/page/openclaw?form=multiAgent，可快速创建机器人并预选常用能力',
      '如未使用快捷入口，也可以在飞书开放平台手动创建企业自建应用',
      '添加应用能力 → 机器人',
      '权限管理中勾选 im:message（消息收发）以及消息表情回复相关权限，尽量一次性全部开齐',
      '事件与回调 → 选择「使用长连接接收事件」→ 添加 im.message.receive_v1 事件',
      '发布应用版本（内测发布即可）',
    ],
    bindSteps: [
      '把 App ID 和 App Secret 交给 TeamAgentX 接入助手保存并绑定（无需配置公网地址）',
      '如果需要 TeamAgentX 在飞书侧首次发消息前主动推送，额外填写默认飞书会话 ID（chat_id/open_chat_id）',
      '在飞书直接私聊该机器人，发一条消息，消息会进入绑定的 TeamAgentX 群聊',
    ],
    notes: [
      '飞书使用 WebSocket 长连接接收消息，无需公网地址或 ngrok',
      '用户与机器人 1-on-1 私聊即可，无需把机器人加入任何飞书群',
      '未配置默认飞书会话 ID 时，系统需要先收到一次飞书消息，才能知道后续回推目标',
      '工作中标识通过给用户原消息添加 Typing 表情反应实现；如果应用没有 reaction 权限，只影响该标识，不影响正常回复',
      '快捷创建页会显著减少手工配权限步骤，优先推荐',
      '凭证保存后服务端自动建立连接，日志可见 [Bridge/Feishu-WS] 启动 WebSocket 长连接',
    ],
  },
  {
    platform: 'dingtalk',
    title: '钉钉',
    consoleName: '钉钉开放平台',
    prerequisites: [
      '需要企业管理员在钉钉开放平台创建企业内部应用',
      '需要应用具备群消息读写权限',
    ],
    requiredCredentials: [
      {
        key: 'appKey',
        label: 'App Key',
        howToGet: '钉钉开放平台应用凭证页',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        howToGet: '钉钉开放平台应用凭证页',
        secret: true,
      },
    ],
    consoleSteps: [
      '在钉钉开放平台创建企业内部应用',
      '添加应用能力 → 机器人，消息接收模式选「Stream 模式」',
      '权限管理中开启消息读取和发送权限',
      '发布应用版本',
    ],
    bindSteps: [
      '把 App Key 和 App Secret 交给 TeamAgentX 接入助手保存并绑定（无需配置公网地址）',
      '在钉钉直接私聊该机器人，发一条消息，消息会进入绑定的 TeamAgentX 群聊',
    ],
    notes: [
      '钉钉使用 Stream 长连接模式，无需公网地址或 ngrok',
      '用户与机器人 1-on-1 私聊即可，无需把机器人加入任何钉钉群',
      'App Key 即为 Robot Code，系统会自动使用，无需额外填写',
    ],
  },
  {
    platform: 'wecom',
    title: '企业微信',
    consoleName: '企业微信管理后台',
    prerequisites: [
      '需要企业微信管理员权限',
      '需要企业微信应用具备群消息收发权限',
    ],
    requiredCredentials: [
      {
        key: 'corpId',
        label: 'Corp ID',
        howToGet: '企业微信管理后台 - 我的企业',
      },
      {
        key: 'agentSecret',
        label: 'Agent Secret',
        howToGet: '自建应用凭证页',
        secret: true,
      },
      {
        key: 'token',
        label: 'Token',
        howToGet: '消息接收配置页，自定义填写后同步到 TeamAgentX',
        secret: true,
      },
      {
        key: 'encodingAESKey',
        label: 'EncodingAESKey',
        howToGet: '消息接收配置页，自定义填写后同步到 TeamAgentX',
        secret: true,
      },
    ],
    consoleSteps: [
      '在企业微信管理后台创建自建应用，记录 Corp ID（我的企业页）和 Agent Secret（应用凭证页）',
      '在应用「接收消息」页，自定义填写 Token 和 EncodingAESKey（两项都可随机生成），记录下来',
      '将「接收消息 URL」填写为 TeamAgentX 的企业微信 webhook 地址（可在 TeamAgentX 集成页查看，格式：https://你的域名/api/bridge/webhook/wecom）',
      '开启应用消息收发权限',
    ],
    bindSteps: [
      '把 Corp ID、Agent Secret、Token、EncodingAESKey 交给 TeamAgentX 接入助手保存并绑定',
      '在企业微信直接私聊该应用，发一条消息，消息会进入绑定的 TeamAgentX 群聊',
    ],
    notes: [
      '企业微信需要公网可访问的 HTTPS 地址才能接收消息',
      '用户与应用 1-on-1 私聊即可，无需把应用加入任何企业微信群',
      '企业微信回调消息经过加密，系统会用 EncodingAESKey 自动解密；Token 用于签名校验，须与后台一致',
    ],
  },
  {
    platform: 'qq',
    title: 'QQ',
    consoleName: 'QQ 开放平台',
    prerequisites: [
      '需要 QQ 开放平台机器人应用资格（需单独申请）',
      '需要公网可访问的 HTTPS 地址用于接收 QQ 回调',
      '需要群主或管理员能审批 Bot 入群',
    ],
    requiredCredentials: [
      {
        key: 'appId',
        label: 'App ID',
        howToGet: 'QQ 开放平台应用详情页',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        howToGet: 'QQ 开放平台应用详情页',
        secret: true,
      },
    ],
    consoleSteps: [
      '在 QQ 开放平台创建机器人应用，记录 App ID 和 Client Secret',
      '在「事件订阅」中，将回调地址填写为 TeamAgentX 的 QQ webhook 地址（可在 TeamAgentX 集成页查看，格式：https://你的域名/api/bridge/webhook/qq）',
      '开启 C2C_MESSAGE_CREATE 事件订阅（单聊消息）',
      '开启消息发送权限',
    ],
    bindSteps: [
      '把 App ID 和 Client Secret 交给 TeamAgentX 接入助手保存并绑定',
      '在 QQ 直接私聊该机器人，发一条消息，消息会进入绑定的 TeamAgentX 群聊',
    ],
    notes: [
      '用户与机器人 1-on-1 私聊即可，无需把机器人加入任何 QQ 群',
      'QQ 机器人仍有平台审核与额度限制，需要关注开放平台状态',
    ],
  },
];

const playbookMap = new Map<Platform, BridgePlatformPlaybook>(
  BRIDGE_PLATFORM_PLAYBOOKS.map((playbook) => [playbook.platform, playbook]),
);

export function getBridgePlatformPlaybook(platform: Platform): BridgePlatformPlaybook {
  const playbook = playbookMap.get(platform);
  if (!playbook) {
    throw new Error(`Unsupported bridge platform playbook: ${platform}`);
  }
  return playbook;
}

export function buildBridgePlatformConfigPayload(
  platform: Platform,
  values: Record<string, string>,
): { botToken?: string; config?: Record<string, unknown> } {
  const cleanConfig = Object.fromEntries(
    Object.entries(values).filter(([, value]) => Boolean(value && value.trim())),
  );

  if (platform === 'telegram') {
    const botToken = typeof cleanConfig.botToken === 'string' ? cleanConfig.botToken : undefined;
    return {
      botToken,
      config: botToken ? { botToken } : undefined,
    };
  }

  return {
    config: Object.keys(cleanConfig).length > 0 ? cleanConfig : undefined,
  };
}
