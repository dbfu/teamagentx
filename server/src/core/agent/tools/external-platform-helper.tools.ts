import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import prisma from '../../../lib/prisma.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { bridgeService } from '../../../modules/bridge/bridge.service.js';
import type { Platform } from '../../../modules/bridge/bridge.service.js';
import { createBridgeBindCode } from '../../../modules/bridge/bridge-bind-code-store.js';
import {
  buildBridgePlatformConfigPayload,
  getBridgePlatformPlaybook,
} from '../../../modules/bridge/bridge-platform-playbooks.js';
import {
  getBridgePlatformConfig,
  hasBridgePlatformCredentials,
  maskBridgePlatformConfig,
  saveBridgePlatformConfig,
} from '../../../modules/bridge/bridge-platform-config-store.js';
import { listBridgePlatformDefinitions } from '../../../modules/bridge/bridge-platform-registry.js';
import { syncBridgePlatformRuntime } from '../../../modules/bridge/bridge-runtime-sync.js';
import { listAgentsTool, listChatRoomsTool } from './chatroom-helper.tools.js';

export const EXTERNAL_PLATFORM_HELPER_AGENT_ID = '8f7d1f9a-4e08-4c2d-a489-67b02c9d4101';

const PLATFORM_VALUES = ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq'] as const;

function formatCredentialList(platform: Platform): string {
  const playbook = getBridgePlatformPlaybook(platform);
  return playbook.requiredCredentials
    .map((field) => `- ${field.label}（${field.key}）：${field.howToGet}`)
    .join('\n');
}

function parseCredentialInput(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, value!.trim()]),
  );
}

export function createExternalPlatformHelperTools(chatRoomId: string) {
  const getCurrentChatRoomTool = tool(
    async () => {
      const chatRoom = await chatRoomService.findById(chatRoomId);
      if (!chatRoom) {
        return JSON.stringify({ success: false, error: `当前群聊不存在: ${chatRoomId}` });
      }

      const channels = (await bridgeService.listChannels()).filter((channel) => channel.chatRoomId === chatRoomId);

      return JSON.stringify({
        success: true,
        chatRoom: {
          id: chatRoom.id,
          name: chatRoom.name,
          description: chatRoom.description || '',
          defaultAgentId: chatRoom.defaultAgentId || null,
        },
        externalMappings: channels.map((channel) => ({
          id: channel.id,
          platform: channel.platform,
          externalId: channel.externalId,
          enabled: channel.enabled,
          defaultAgentId: channel.defaultAgentId || null,
        })),
      });
    },
    {
      name: 'get_current_chatroom',
      description: '获取当前对话所在的 TeamAgentX 群聊信息，以及该群聊现有的外部平台映射。',
      schema: z.object({}),
    },
  );

  const listBridgePlatformsTool = tool(
    async () => {
      const definitions = listBridgePlatformDefinitions();
      return `支持的平台如下：\n\n${definitions.map((definition) => {
        const playbook = getBridgePlatformPlaybook(definition.key);
        return [
          `${definition.label}（${definition.key}）`,
          `- 所需凭证：${playbook.requiredCredentials.map((field) => field.label).join('、')}`,
          `- 绑定方式：${definition.supportsBindCode ? '支持绑定码' : '仅手工映射'}`,
          `- 群标识：${definition.groupIdHint}`,
        ].join('\n');
      }).join('\n\n')}`;
    },
    {
      name: 'list_bridge_platforms',
      description: '列出 TeamAgentX 当前支持的外部平台、所需凭证和接入方式。',
      schema: z.object({}),
    },
  );

  const getBridgePlatformGuideTool = tool(
    async ({ platform }: { platform: Platform }) => {
      const definition = listBridgePlatformDefinitions().find((item) => item.key === platform);
      const playbook = getBridgePlatformPlaybook(platform);
      return [
        `${playbook.title} 接入说明`,
        '',
        '前置条件：',
        ...playbook.prerequisites.map((item) => `- ${item}`),
        '',
        '你需要从外部平台拿到这些数据：',
        ...playbook.requiredCredentials.map((field) => `- ${field.label}（${field.key}）：${field.howToGet}`),
        '',
        '外部平台上应该这样操作：',
        ...playbook.consoleSteps.map((item, index) => `${index + 1}. ${item}`),
        '',
        '拿到数据后交给我，我会在 TeamAgentX 内完成：',
        '- 保存平台凭证',
        '- 绑定当前房间或指定房间',
        '- 生成绑定码或直接创建映射',
        '',
        '完成映射后在群里这样做：',
        ...playbook.bindSteps.map((item, index) => `${index + 1}. ${item}`),
        '',
        `群标识说明：${definition?.groupIdHint ?? '按平台群 ID 提供'}`,
        '',
        '注意事项：',
        ...playbook.notes.map((item) => `- ${item}`),
      ].join('\n');
    },
    {
      name: 'get_bridge_platform_setup_guide',
      description: '返回指定平台的详细接入说明，包括外部平台操作步骤、需要拿到的凭证以及 TeamAgentX 内的落地流程。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
      }),
    },
  );

  const getBridgePlatformConfigStatusTool = tool(
    async ({ platform }: { platform: Platform }) => {
      const cfg = await getBridgePlatformConfig(platform);
      if (!cfg) {
        return JSON.stringify({
          success: true,
          configured: false,
          platform,
          message: `平台 ${platform} 还没有配置凭证。`,
        });
      }

      return JSON.stringify({
        success: true,
        configured: true,
        platform,
        config: maskBridgePlatformConfig(cfg),
      });
    },
    {
      name: 'get_bridge_platform_config_status',
      description: '查看某个平台是否已经配置凭证、是否已设置默认助手。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
      }),
    },
  );

  const saveBridgePlatformConfigTool = tool(
    async ({
      platform,
      defaultAgentId,
      botToken,
      values,
    }: {
      platform: Platform;
      defaultAgentId?: string;
      botToken?: string;
      values?: Record<string, string>;
    }) => {
      const normalizedValues = parseCredentialInput(values ?? {});
      if (botToken && !normalizedValues.botToken) {
        normalizedValues.botToken = botToken;
      }

      const payload = buildBridgePlatformConfigPayload(platform, normalizedValues);
      const saved = await saveBridgePlatformConfig(platform, {
        ...payload,
        defaultAgentId: defaultAgentId || null,
      });
      await syncBridgePlatformRuntime(platform, saved, {
        info: (...args: unknown[]) => console.log(...args),
        warn: (...args: unknown[]) => console.warn(...args),
        error: (...args: unknown[]) => console.error(...args),
      });

      return JSON.stringify({
        success: true,
        platform,
        config: maskBridgePlatformConfig(saved),
        savedFields: Object.keys(normalizedValues),
        message: `已保存 ${platform} 平台凭证。后续你只需要继续做群绑定，不需要再打开外部集成页手动配置。`,
      });
    },
    {
      name: 'save_bridge_platform_config',
      description: '保存某个平台的接入凭证和默认助手。用户把平台上拿到的值告诉你后，必须调用这个工具真正写入系统，而不是只给出说明。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
        defaultAgentId: z.string().optional().describe('设为该平台默认响应的助手 ID，可选'),
        botToken: z.string().optional().describe('Telegram Bot Token，可选；也可放进 values.botToken'),
        values: z.record(z.string(), z.string()).optional().describe(`平台凭证键值对。请只传该平台需要的字段。\n${PLATFORM_VALUES.map((platform) => `${platform}:\n${formatCredentialList(platform)}`).join('\n')}`),
      }),
    },
  );

  const listBridgeMappingsTool = tool(
    async ({
      platform,
      targetChatRoomId,
    }: {
      platform?: Platform;
      targetChatRoomId?: string;
    }) => {
      let channels = await bridgeService.listChannels(platform);
      if (targetChatRoomId) {
        channels = channels.filter((channel) => channel.chatRoomId === targetChatRoomId);
      }

      if (channels.length === 0) {
        return '当前没有匹配的外部平台映射。';
      }

      return channels.map((channel) => [
        `ID: ${channel.id}`,
        `平台: ${channel.platform}`,
        `外部群 ID: ${channel.externalId}`,
        `内部房间: ${channel.chatRoom.name} (${channel.chatRoomId})`,
        `状态: ${channel.enabled ? '启用' : '停用'}`,
        `默认助手: ${channel.defaultAgent?.name || '未指定'}`,
      ].join('\n')).join('\n\n');
    },
    {
      name: 'list_bridge_mappings',
      description: '查看现有的外部平台群聊映射，可按平台或房间过滤。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).optional().describe('按平台过滤，可选'),
        targetChatRoomId: z.string().optional().describe('按房间 ID 过滤，可选'),
      }),
    },
  );

  const createBridgeMappingTool = tool(
    async ({
      platform,
      externalId,
      targetChatRoomId,
      defaultAgentId,
      webhookSecret,
      configValues,
    }: {
      platform: Platform;
      externalId: string;
      targetChatRoomId?: string;
      defaultAgentId?: string;
      webhookSecret?: string;
      configValues?: Record<string, string>;
    }) => {
      const finalChatRoomId = targetChatRoomId || chatRoomId;
      const room = await chatRoomService.findById(finalChatRoomId);
      if (!room) {
        return JSON.stringify({ success: false, error: `目标房间不存在: ${finalChatRoomId}` });
      }

      const channel = await bridgeService.createChannel({
        platform,
        externalId: externalId.trim(),
        chatRoomId: finalChatRoomId,
        defaultAgentId: defaultAgentId || undefined,
        webhookSecret: webhookSecret || undefined,
        config: configValues ? parseCredentialInput(configValues) : undefined,
      });

      return JSON.stringify({
        success: true,
        channel: {
          id: channel.id,
          platform: channel.platform,
          externalId: channel.externalId,
          chatRoomId: channel.chatRoomId,
        },
        message: `已把 ${platform} 群 ${externalId} 映射到 TeamAgentX 房间「${room.name}」。`,
      });
    },
    {
      name: 'create_bridge_mapping',
      description: '【仅当用户已经明确提供外部群 ID 时调用】直接创建外部平台群聊到 TeamAgentX 房间的映射。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
        externalId: z.string().describe('外部群 ID / chat_id / conversationId 等平台群标识'),
        targetChatRoomId: z.string().optional().describe('目标 TeamAgentX 房间 ID；默认当前房间'),
        defaultAgentId: z.string().optional().describe('该映射的默认助手 ID，可选'),
        webhookSecret: z.string().optional().describe('群级回调 Secret / Token，可选；企业微信等平台可传'),
        configValues: z.record(z.string(), z.string()).optional().describe('群级额外配置，例如企业微信的 encodingAESKey。'),
      }),
    },
  );

  const generateBridgeBindCodeTool = tool(
    async ({
      platform,
      targetChatRoomId,
    }: {
      platform: Platform;
      targetChatRoomId?: string;
    }) => {
      const finalChatRoomId = targetChatRoomId || chatRoomId;
      const room = await chatRoomService.findById(finalChatRoomId);
      if (!room) {
        return JSON.stringify({ success: false, error: `目标房间不存在: ${finalChatRoomId}` });
      }

      const ready = await hasBridgePlatformCredentials(platform);
      if (!ready) {
        return JSON.stringify({
          success: false,
          error: `平台 ${platform} 还没有保存凭证，请先调用 save_bridge_platform_config。`,
        });
      }

      const bindCode = createBridgeBindCode(platform, finalChatRoomId);
      return JSON.stringify({
        success: true,
        platform,
        chatRoom: { id: room.id, name: room.name },
        bindCode,
        command: `/bind ${bindCode.code}`,
        message: `请把机器人加入目标群，然后在群里发送 /bind ${bindCode.code} 完成映射。`,
      });
    },
    {
      name: 'generate_bridge_bind_code',
      description: '为指定房间生成外部平台绑定码。适合用户还不知道外部群 ID，但可以在目标群里发命令的场景。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
        targetChatRoomId: z.string().optional().describe('目标 TeamAgentX 房间 ID；默认当前房间'),
      }),
    },
  );

  const toggleBridgeMappingTool = tool(
    async ({ channelId, enabled }: { channelId: string; enabled: boolean }) => {
      const existing = await prisma.externalChannel.findUnique({
        where: { id: channelId },
        select: { id: true, platform: true, externalId: true, enabled: true },
      });
      if (!existing) {
        return JSON.stringify({ success: false, error: `映射不存在: ${channelId}` });
      }
      await bridgeService.updateChannel(channelId, { enabled });
      return JSON.stringify({
        success: true,
        message: `已将 ${existing.platform} 群 ${existing.externalId} 的映射${enabled ? '启用' : '停用'}。`,
      });
    },
    {
      name: 'toggle_bridge_mapping',
      description: '启用或停用一个外部平台映射（不删除数据）。',
      schema: z.object({
        channelId: z.string().describe('ExternalChannel 记录 ID'),
        enabled: z.boolean().describe('true = 启用，false = 停用'),
      }),
    },
  );

  const deleteBridgeMappingTool = tool(
    async ({ channelId }: { channelId: string }) => {
      const existing = await prisma.externalChannel.findUnique({
        where: { id: channelId },
        select: { id: true, platform: true, externalId: true },
      });

      if (!existing) {
        return JSON.stringify({ success: false, error: `映射不存在: ${channelId}` });
      }

      await bridgeService.deleteChannel(channelId);
      return JSON.stringify({
        success: true,
        message: `已删除 ${existing.platform} 群 ${existing.externalId} 的映射。`,
      });
    },
    {
      name: 'delete_bridge_mapping',
      description: '【必须用户确认后才能调用】删除一个外部平台映射。',
      schema: z.object({
        channelId: z.string().describe('ExternalChannel 记录 ID'),
      }),
    },
  );

  const getPublicBaseUrlTool = tool(
    async () => {
      const systemCfg = await prisma.platformConfig.findUnique({ where: { platform: 'system' } });
      const baseUrl = (systemCfg?.config ? (JSON.parse(systemCfg.config) as { baseUrl?: string }).baseUrl : null) ?? '';
      return JSON.stringify({
        success: true,
        baseUrl: baseUrl || null,
        configured: Boolean(baseUrl),
        webhookUrls: baseUrl
          ? {
              wecom: `${baseUrl}/api/bridge/webhook/wecom`,
              qq: `${baseUrl}/api/bridge/webhook/qq`,
              telegram: `${baseUrl}/api/bridge/webhook/telegram`,
            }
          : null,
        message: baseUrl
          ? `已配置公网地址：${baseUrl}`
          : '尚未配置公网地址。企业微信和 QQ 需要公网地址才能接收消息。可在 TeamAgentX 集成页面顶部配置，或让用户自行运行 ngrok http 3001 后告诉你 URL。',
      });
    },
    {
      name: 'get_public_base_url',
      description: '获取当前配置的服务公网地址，并返回各平台的 webhook URL。接入企业微信或 QQ 前必须先调用此工具确认地址。',
      schema: z.object({}),
    },
  );

  return [
    getCurrentChatRoomTool,
    listBridgePlatformsTool,
    getBridgePlatformGuideTool,
    getBridgePlatformConfigStatusTool,
    saveBridgePlatformConfigTool,
    listBridgeMappingsTool,
    createBridgeMappingTool,
    generateBridgeBindCodeTool,
    toggleBridgeMappingTool,
    deleteBridgeMappingTool,
    getPublicBaseUrlTool,
    listChatRoomsTool,
    listAgentsTool,
  ];
}
