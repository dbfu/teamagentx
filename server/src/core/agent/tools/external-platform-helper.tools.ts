import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import prisma from '../../../lib/prisma.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { bridgeService } from '../../../modules/bridge/bridge.service.js';
import type { Platform } from '../../../modules/bridge/bridge.service.js';
import {
  buildBridgePlatformConfigPayload,
  getBridgePlatformPlaybook,
} from '../../../modules/bridge/bridge-platform-playbooks.js';
import { parseStoredBridgeConfig, resolveStoredBridgeBotToken } from '../../../modules/bridge/bridge-platform-config.js';
import { listBridgePlatformDefinitions } from '../../../modules/bridge/bridge-platform-registry.js';
import { getBridgeBotById, listBridgeBots } from '../../../modules/bridge/bridge-bot-store.js';
import { syncBridgeBotRuntime } from '../../../modules/bridge/bridge-runtime-sync.js';
import { listAgentsTool, listChatRoomsTool } from './chatroom-helper.tools.js';

export const EXTERNAL_PLATFORM_HELPER_AGENT_ID = '8f7d1f9a-4e08-4c2d-a489-67b02c9d4101';

const PLATFORM_VALUES = ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq'] as const;

interface DuplicateCredentialError extends Error {
  code: string;
  existingBotId?: string;
  existingBotName?: string;
}

function isDuplicateCredentialError(err: unknown): err is DuplicateCredentialError {
  return err instanceof Error && (err as { code?: string }).code === 'DUPLICATE_CREDENTIAL';
}

const PLATFORM_CONFIG_FIELDS: Record<string, string[]> = {
  telegram: ['botToken'],
  feishu: ['appId', 'appSecret'],
  dingtalk: ['appKey', 'appSecret'],
  wecom: ['corpId', 'agentSecret', 'token', 'encodingAESKey'],
  qq: ['appId', 'clientSecret'],
};

function validatePlatformConfig(platform: string, config: Record<string, string>): void {
  const allowed = PLATFORM_CONFIG_FIELDS[platform];
  if (!allowed) return;
  const unknown = Object.keys(config).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new Error(`Unknown config fields for ${platform}: ${unknown.join(', ')}`);
  }
}

function formatCredentialList(platform: Platform): string {
  const playbook = getBridgePlatformPlaybook(platform);
  return playbook.requiredCredentials
    .map((field) => `- ${field.label}（${field.key}）：${field.howToGet}`)
    .join('\n');
}

async function validateCredentials(
  platform: Platform,
  values: Record<string, string>,
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (platform === 'telegram') {
      const token = values.botToken;
      if (!token) return { valid: false, error: 'Bot Token 不能为空' };
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json() as { ok: boolean; description?: string };
      if (!data.ok) return { valid: false, error: `Token 无效：${data.description ?? '请检查 Token 是否正确'}` };
      return { valid: true };
    }

    if (platform === 'feishu') {
      const { appId, appSecret } = values;
      if (!appId || !appSecret) return { valid: false, error: 'App ID 和 App Secret 不能为空。请确保 values 对象包含 appId 和 appSecret 字段，例如：values: {"appId": "cli_xxx", "appSecret": "yyy"}' };
      const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const data = await res.json() as { code: number; msg?: string };
      if (data.code !== 0) return { valid: false, error: `凭证无效：${data.msg ?? '请检查 App ID / App Secret'}` };
      return { valid: true };
    }

    if (platform === 'dingtalk') {
      const { appKey, appSecret } = values;
      if (!appKey || !appSecret) return { valid: false, error: 'App Key 和 App Secret 不能为空。请确保 values 对象包含 appKey 和 appSecret 字段，例如：values: {"appKey": "xxx", "appSecret": "yyy"}' };
      const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey, appSecret }),
      });
      const data = await res.json() as { accessToken?: string; message?: string };
      if (!data.accessToken) return { valid: false, error: `凭证无效：${data.message ?? '请检查 App Key / App Secret'}` };
      return { valid: true };
    }

    if (platform === 'wecom') {
      const { corpId, agentSecret } = values;
      if (!corpId || !agentSecret) return { valid: false, error: 'Corp ID 和 Agent Secret 不能为空。请确保 values 对象包含 corpId 和 agentSecret 字段，例如：values: {"corpId": "xxx", "agentSecret": "yyy"}' };
      const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(agentSecret)}`);
      const data = await res.json() as { errcode: number; errmsg?: string };
      if (data.errcode !== 0) return { valid: false, error: `凭证无效：${data.errmsg ?? '请检查 Corp ID / Agent Secret'}` };
      return { valid: true };
    }

    if (platform === 'qq') {
      const { appId, clientSecret } = values;
      if (!appId || !clientSecret) return { valid: false, error: 'App ID 和 Client Secret 不能为空。请确保 values 对象包含 appId 和 clientSecret 字段，例如：values: {"appId": "xxx", "clientSecret": "yyy"}' };
      const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret }),
      });
      const data = await res.json() as { access_token?: string; message?: string };
      if (!data.access_token) return { valid: false, error: `凭证无效：${data.message ?? '请检查 App ID / Client Secret'}` };
      return { valid: true };
    }
  } catch {
    return { valid: false, error: `无法连接 ${platform} API，请检查网络后重试` };
  }
  return { valid: true };
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

      const bots = (await bridgeService.listBots()).filter((bot) => bot.chatRoomId === chatRoomId);

      return JSON.stringify({
        success: true,
        chatRoom: {
          id: chatRoom.id,
          name: chatRoom.name,
          description: chatRoom.description || '',
          defaultAgentId: chatRoom.defaultAgentId || null,
          ownerUsername: chatRoom.owner?.username ?? null,
        },
        externalBindings: bots.map((bot) => ({
          id: bot.id,
          platform: bot.platform,
          name: bot.name,
          enabled: bot.enabled,
          boundMode: 'any-conversation',
        })),
      });
    },
    {
      name: 'get_current_chatroom',
      description: '获取当前对话所在的 TeamAgentX 群聊信息，以及该群聊现有的外部平台机器人绑定。',
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
          '- 绑定方式：保存凭证后直接绑定 TeamAgentX 群聊',
          `- 触达方式：机器人收到消息后直接转入绑定群聊`,
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
        '- 保存一个新的机器人凭证实例',
        '- 直接把这个机器人绑定到当前房间或指定房间',
        '',
        '完成绑定后这样做：',
        ...playbook.bindSteps.map((item, index) => `${index + 1}. ${item}`),
        '',
        `说明：${definition?.label ?? platform} 机器人绑定后，任何打到该机器人的消息都会进入对应 TeamAgentX 群聊。`,
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

  const saveBridgePlatformConfigTool = tool(
    async ({
      platform,
      name,
      targetChatRoomId,
      botToken,
      values,
    }: {
      platform: Platform;
      name?: string;
      targetChatRoomId?: string;
      botToken?: string;
      values?: Record<string, string>;
    }) => {
      const normalizedValues = parseCredentialInput(values ?? {});
      if (botToken && !normalizedValues.botToken) {
        normalizedValues.botToken = botToken;
      }

      try {
        const finalChatRoomId = targetChatRoomId || chatRoomId;

        if (targetChatRoomId && targetChatRoomId !== chatRoomId) {
          const currentRoom = await chatRoomService.findById(chatRoomId);
          const targetRoom = await chatRoomService.findById(targetChatRoomId);
          if (!targetRoom) {
            return JSON.stringify({ success: false, error: '目标群聊不存在，请重新选择一个群聊。' });
          }
          if (targetRoom.ownerId !== currentRoom?.ownerId) {
            return JSON.stringify({ success: false, error: '无权操作目标群聊，只能绑定到你拥有的群聊。' });
          }
        }

        const room = await chatRoomService.findById(finalChatRoomId);
        if (!room) {
          return JSON.stringify({ success: false, error: '目标群聊不存在，请重新选择一个群聊。' });
        }

        validatePlatformConfig(platform, normalizedValues);

        const validation = await validateCredentials(platform, normalizedValues);
        if (!validation.valid) {
          return JSON.stringify({ success: false, invalidCredentials: true, error: validation.error });
        }

        const botName = name?.trim() || `${platform}-bot`;
        const ownerUsername = room.owner?.username;
        const log = {
          info: (...args: unknown[]) => console.log(...args),
          warn: (...args: unknown[]) => console.warn(...args),
          error: (...args: unknown[]) => console.error(...args),
        };

        const payload = buildBridgePlatformConfigPayload(platform, normalizedValues);

        let saved;
        try {
          saved = await bridgeService.createBot({
            platform,
            name: botName,
            ownerId: room.ownerId ?? undefined,
            ...payload,
          });
        } catch (err: unknown) {
          if (isDuplicateCredentialError(err)) {
            return JSON.stringify({
              success: false,
              duplicateCredential: true,
              platform,
              existingBot: { id: err.existingBotId, name: err.existingBotName },
              ownerUsername: ownerUsername ?? null,
              message: `该 ${platform} 凭证已被机器人「${err.existingBotName}」使用，不能重复保存。如需把它换绑到当前群聊，请使用 rebind_bridge_bot。`,
            });
          }
          const message = err instanceof Error ? err.message : '未知错误，请稍后重试';
          return JSON.stringify({ success: false, error: `保存凭证失败：${message}` });
        }

        try {
          await syncBridgeBotRuntime(saved.id, log);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : '请检查凭证是否正确';
          return JSON.stringify({ success: false, error: `凭证已保存，但启动连接失败：${message}` });
        }

        const bound = await bridgeService.bindBot(saved.id, finalChatRoomId);

        return JSON.stringify({
          success: true,
          platform,
          bot: { id: bound.id, name: bound.name, chatRoomId: bound.chatRoomId, chatRoomName: bound.chatRoom?.name ?? null },
          savedFields: Object.keys(normalizedValues),
          ownerUsername: ownerUsername ?? null,
          message: `已保存 ${platform} 机器人凭证，并绑定到群聊「${room.name}」。`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知错误，请稍后重试';
        return JSON.stringify({ success: false, error: `操作失败：${message}` });
      }
    },
    {
      name: 'save_bridge_platform_config',
      description: '用新凭证创建一个平台机器人实例并立即绑定到当前群聊或指定群聊。用户把凭证和名字给你后，必须调用此工具写入系统。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).describe('外部平台标识'),
        name: z.string().describe('机器人实例名称，用户提供，便于在集成页区分'),
        targetChatRoomId: z.string().optional().describe('要绑定的目标 TeamAgentX 群聊，默认当前群聊'),
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
      let bots = await bridgeService.listBots(platform);
      const filterRoomId = targetChatRoomId || chatRoomId;
      bots = bots.filter((bot) => bot.chatRoomId === filterRoomId);

      if (bots.length === 0) {
        return '当前没有匹配的外部平台机器人绑定。';
      }

      return bots.map((bot) => [
        `ID: ${bot.id}`,
        `平台: ${bot.platform}`,
        `名称: ${bot.name}`,
        `绑定房间: ${bot.chatRoom?.name ?? '未绑定'} (${bot.chatRoomId ?? '-'})`,
        '触达范围: 机器人收到的任意会话',
        `状态: ${bot.enabled ? '启用' : '停用'}`,
      ].join('\n')).join('\n\n');
    },
    {
      name: 'list_bridge_mappings',
      description: '查看现有的外部平台机器人绑定，可按平台或房间过滤。',
      schema: z.object({
        platform: z.enum(PLATFORM_VALUES).optional().describe('按平台过滤，可选'),
        targetChatRoomId: z.string().optional().describe('按房间 ID 过滤，可选'),
      }),
    },
  );

  const createBridgeMappingTool = tool(
    async ({
      botId,
      targetChatRoomId,
      confirmed,
    }: {
      botId: string;
      targetChatRoomId?: string;
      confirmed?: boolean;
    }) => {
      if (!confirmed) {
        return JSON.stringify({ success: false, message: '此操作需要确认，请传入 confirmed: true' });
      }

      try {
        const finalChatRoomId = targetChatRoomId || chatRoomId;

        if (targetChatRoomId && targetChatRoomId !== chatRoomId) {
          const currentRoom = await chatRoomService.findById(chatRoomId);
          const targetRoom = await chatRoomService.findById(targetChatRoomId);
          if (!targetRoom) {
            return JSON.stringify({ success: false, error: '目标群聊不存在，请重新选择一个群聊。' });
          }
          if (targetRoom.ownerId !== currentRoom?.ownerId) {
            return JSON.stringify({ success: false, error: '无权操作目标群聊，只能绑定到你拥有的群聊。' });
          }
        }

        const room = await chatRoomService.findById(finalChatRoomId);
        if (!room) {
          return JSON.stringify({ success: false, error: '目标群聊不存在，请重新选择一个群聊。' });
        }

        const bot = await getBridgeBotById(botId);
        if (!bot) {
          return JSON.stringify({ success: false, error: '找不到该机器人，请重新从列表中选择。' });
        }

        const channel = await bridgeService.bindBot(botId, finalChatRoomId, { forceRebind: true });
        const ownerUsername = room.owner?.username;

        return JSON.stringify({
          success: true,
          channel: { id: channel.id, platform: channel.platform, chatRoomId: channel.chatRoomId },
          ownerUsername: ownerUsername ?? null,
          message: `已把 ${bot.platform} 机器人「${bot.name}」换绑到群聊「${room.name}」。`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知错误，请稍后重试';
        return JSON.stringify({ success: false, error: `换绑失败：${message}` });
      }
    },
    {
      name: 'rebind_bridge_bot',
      description: '把已有机器人（含已绑定其他房间的）换绑到当前群聊或指定群聊。用户从列表中选好机器人后调用此工具。',
      schema: z.object({
        botId: z.string().describe('要换绑的机器人 ID，从 list_bridge_mappings 结果中获取'),
        targetChatRoomId: z.string().optional().describe('目标 TeamAgentX 房间 ID；默认当前房间'),
        confirmed: z.boolean().optional().describe('确认换绑操作，必须传入 true 才会执行'),
      }),
    },
  );

  const updateBotCredentialsTool = tool(
    async ({
      botId,
      values,
      botToken,
    }: {
      botId: string;
      values?: Record<string, string>;
      botToken?: string;
    }) => {
      try {
        const bot = await getBridgeBotById(botId);
        if (!bot) {
          return JSON.stringify({ success: false, error: '找不到该机器人，请重新从列表中选择。' });
        }

        const normalizedValues = parseCredentialInput(values ?? {});
        if (botToken && !normalizedValues.botToken) normalizedValues.botToken = botToken;
        validatePlatformConfig(bot.platform, normalizedValues);

        const mergedValues = {
          ...(parseStoredBridgeConfig(bot) ?? {}),
          ...normalizedValues,
        } as Record<string, string>;
        const existingBotToken = resolveStoredBridgeBotToken(bot);
        if (existingBotToken && !mergedValues.botToken) {
          mergedValues.botToken = existingBotToken;
        }

        const validation = await validateCredentials(bot.platform as Platform, mergedValues);
        if (!validation.valid) {
          return JSON.stringify({ success: false, invalidCredentials: true, error: validation.error });
        }

        const payload = buildBridgePlatformConfigPayload(bot.platform as Platform, mergedValues);
        const log = {
          info: (...args: unknown[]) => console.log(...args),
          warn: (...args: unknown[]) => console.warn(...args),
          error: (...args: unknown[]) => console.error(...args),
        };
        await bridgeService.updateBot(botId, payload);
        await syncBridgeBotRuntime(botId, log);

        return JSON.stringify({
          success: true,
          bot: { id: bot.id, name: bot.name, platform: bot.platform },
          message: `已更新机器人「${bot.name}」的凭证并重新连接。`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '请稍后重试';
        return JSON.stringify({ success: false, error: `更新凭证失败：${message}` });
      }
    },
    {
      name: 'update_bot_credentials',
      description: '更新已有机器人的凭证（不改变绑定关系）。用于更换 Token / Secret 等，适合"换凭证但保留绑定"的场景。',
      schema: z.object({
        botId: z.string().describe('机器人 ID，从 get_current_chatroom 或 list_bridge_mappings 获取'),
        botToken: z.string().optional().describe('新 Bot Token（Telegram）'),
        values: z.record(z.string(), z.string()).optional().describe('新凭证键值对，只传需要更新的字段'),
      }),
    },
  );

  const toggleBridgeMappingTool = tool(
    async ({ channelId, enabled }: { channelId: string; enabled: boolean }) => {
      try {
        const existing = (await bridgeService.listBots()).find((bot) => bot.id === channelId);
        if (!existing) {
          return JSON.stringify({ success: false, error: '找不到该机器人，请重新从列表中选择。' });
        }
        await bridgeService.updateBot(channelId, { enabled });
        return JSON.stringify({
          success: true,
          message: `已将 ${existing.platform} 机器人「${existing.name}」${enabled ? '启用' : '停用'}。`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知错误，请稍后重试';
        return JSON.stringify({ success: false, error: `操作失败：${message}` });
      }
    },
    {
      name: 'toggle_bridge_mapping',
      description: '启用或停用一个外部平台机器人绑定（不删除凭证）。',
      schema: z.object({
        channelId: z.string().describe('绑定记录 ID'),
        enabled: z.boolean().describe('true = 启用，false = 停用'),
      }),
    },
  );

  const deleteBridgeMappingTool = tool(
    async ({ channelId, confirmed }: { channelId: string; confirmed?: boolean }) => {
      if (!confirmed) {
        return JSON.stringify({ success: false, message: '此操作需要确认，请传入 confirmed: true' });
      }

      try {
        const existing = (await bridgeService.listBots()).find((bot) => bot.id === channelId);
        if (!existing) {
          return JSON.stringify({ success: false, error: '找不到该机器人，请重新从列表中选择。' });
        }
        await bridgeService.deleteBot(channelId);
        return JSON.stringify({
          success: true,
          message: `已删除 ${existing.platform} 机器人「${existing.name}」及其凭证。`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知错误，请稍后重试';
        return JSON.stringify({ success: false, error: `删除失败：${message}` });
      }
    },
    {
      name: 'delete_bridge_mapping',
      description: '【必须用户确认后才能调用】删除一个外部平台机器人绑定。',
      schema: z.object({
        channelId: z.string().describe('绑定记录 ID'),
        confirmed: z.boolean().optional().describe('确认删除操作，必须传入 true 才会执行'),
      }),
    },
  );

  const getPublicBaseUrlTool = tool(
    async () => {
      try {
        const systemCfg = await prisma.platformConfig.findUnique({ where: { platform: 'system' } });
        const baseUrl = (systemCfg?.config ? (JSON.parse(systemCfg.config) as { baseUrl?: string }).baseUrl : null) ?? '';
        return JSON.stringify({
          success: true,
          baseUrl: baseUrl || null,
          configured: Boolean(baseUrl),
          webhookUrls: baseUrl
            ? {
                wecom: `${baseUrl}/api/bridge/webhook/wecom/:botId`,
                qq: `${baseUrl}/api/bridge/webhook/qq/:botId`,
                telegram: `${baseUrl}/api/bridge/webhook/telegram/:botId`,
              }
            : null,
          message: baseUrl
            ? `已配置公网地址：${baseUrl}`
            : '尚未配置公网地址。企业微信和 QQ 需要公网地址才能接收消息。可在 TeamAgentX 集成页面顶部配置，或让用户自行运行 ngrok http 3001 后告诉你 URL。',
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '请稍后重试';
        return JSON.stringify({ success: false, error: `读取公网地址配置失败：${message}` });
      }
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
    saveBridgePlatformConfigTool,
    updateBotCredentialsTool,
    listBridgeMappingsTool,
    createBridgeMappingTool,
    toggleBridgeMappingTool,
    deleteBridgeMappingTool,
    getPublicBaseUrlTool,
    listChatRoomsTool,
    listAgentsTool,
  ];
}
