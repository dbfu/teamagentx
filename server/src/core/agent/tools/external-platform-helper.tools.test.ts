import test from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../../lib/prisma.js';
import { createExternalPlatformHelperTools } from './external-platform-helper.tools.js';

const originalFetch = globalThis.fetch;

function getTool(name: string) {
  const tool = createExternalPlatformHelperTools('helper-room').find((item) => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool;
}

test.beforeEach(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('bots.qq.com/app/getAppAccessToken')) {
      return new Response(JSON.stringify({ access_token: 'qq-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('qyapi.weixin.qq.com/cgi-bin/gettoken')) {
      return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await prisma.bridgeBot.deleteMany({
    where: {
      name: {
        startsWith: 'Helper Tool Test',
      },
    },
  });
  await prisma.platformConfig.deleteMany({
    where: { platform: 'system' },
  });
  await prisma.chatRoom.deleteMany({
    where: { id: 'helper-room' },
  });
  await prisma.user.deleteMany({
    where: { id: 'helper-owner' },
  });

  await prisma.user.create({
    data: {
      id: 'helper-owner',
      username: 'helper-owner',
      password: 'password',
      updatedAt: new Date(),
    },
  });
  await prisma.chatRoom.create({
    data: {
      id: 'helper-room',
      name: 'Helper Room',
      ownerId: 'helper-owner',
      updatedAt: new Date(),
    },
  });
});

test.afterEach(async () => {
  globalThis.fetch = originalFetch;
});

test('save_bridge_platform_config creates bots owned by the room owner', async () => {
  const result = await getTool('save_bridge_platform_config').invoke({
    platform: 'qq',
    name: 'Helper Tool Test QQ Bot',
    values: {
      appId: 'qq-app-id',
      clientSecret: 'qq-client-secret',
    },
  });

  const parsed = JSON.parse(String(result)) as { success: boolean; bot: { id: string } };
  assert.equal(parsed.success, true);

  const savedBot = await prisma.bridgeBot.findUnique({
    where: { id: parsed.bot.id },
    select: { ownerId: true },
  });
  assert.equal(savedBot?.ownerId, 'helper-owner');
});

test('update_bot_credentials supports partial updates by merging stored credentials', async () => {
  const createResult = await getTool('save_bridge_platform_config').invoke({
    platform: 'wecom',
    name: 'Helper Tool Test WeCom Bot',
    values: {
      corpId: 'corp-id',
      agentSecret: 'agent-secret',
      token: 'callback-token',
      encodingAESKey: 'encoding-key',
    },
  });
  const created = JSON.parse(String(createResult)) as { bot: { id: string } };

  const updateResult = await getTool('update_bot_credentials').invoke({
    botId: created.bot.id,
    values: {
      agentSecret: 'updated-secret',
    },
  });
  const parsedUpdate = JSON.parse(String(updateResult)) as { success: boolean; error?: string };

  assert.equal(parsedUpdate.success, true, parsedUpdate.error);
});

test('get_public_base_url returns bot-scoped webhook URL patterns', async () => {
  await prisma.platformConfig.create({
    data: {
      platform: 'system',
      config: JSON.stringify({ baseUrl: 'https://example.com' }),
    },
  });

  const result = await getTool('get_public_base_url').invoke({});
  const parsed = JSON.parse(String(result)) as {
    success: boolean;
    webhookUrls: Record<string, string>;
  };

  assert.equal(parsed.success, true);
  assert.equal(parsed.webhookUrls.wecom, 'https://example.com/api/bridge/webhook/wecom/:botId');
  assert.equal(parsed.webhookUrls.qq, 'https://example.com/api/bridge/webhook/qq/:botId');
  assert.equal(parsed.webhookUrls.telegram, 'https://example.com/api/bridge/webhook/telegram/:botId');
});
