import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';

const originalFetch = globalThis.fetch;

test.beforeEach(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/getMe')) {
      return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: 'teamagentx_bot' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('tenant_access_token')) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tenant-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await prisma.message.deleteMany({
    where: {
      chatRoomId: {
        in: ['bridge-service-room', 'bridge-service-room-2'],
      },
    },
  });
  await prisma.bridgeEvent.deleteMany({});
  await prisma.chatRoomAgent.deleteMany({
    where: {
      chatRoomId: {
        in: ['bridge-service-room', 'bridge-service-room-2'],
      },
    },
  });
  await prisma.bridgeBot.deleteMany({
    where: {
      chatRoomId: {
        in: ['bridge-service-room', 'bridge-service-room-2'],
      },
    },
  });
  await prisma.chatRoom.deleteMany({
    where: {
      id: {
        in: ['bridge-service-room', 'bridge-service-room-2'],
      },
    },
  });
  await prisma.agent.deleteMany({
    where: {
      id: {
        in: [
          'bridge-service-agent',
          'bridge-service-agent-single-room',
          'bridge-service-agent-explicit',
        ],
      },
    },
  });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('receiveBridgeMessage injects default agent mention for bridge messages without userId', async () => {
  const agent = await prisma.agent.create({
    data: {
      id: 'bridge-service-agent',
      name: 'BridgeServiceDefaultAgent',
      prompt: 'test prompt',
      updatedAt: new Date(),
    },
  });

  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      defaultAgentId: agent.id,
      updatedAt: new Date(),
    },
  });

  await prisma.chatRoomAgent.create({
    data: {
      id: 'bridge-service-room-agent',
      chatRoomId: 'bridge-service-room',
      agentId: agent.id,
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-1',
    senderName: 'tester',
    content: '你好',
  });

  const savedMessage = await prisma.message.findFirst({
    where: {
      chatRoomId: 'bridge-service-room',
    },
    orderBy: { time: 'desc' },
  });

  assert.ok(savedMessage);
  assert.match(savedMessage.content, /@BridgeServiceDefaultAgent/);
});

test('receiveBridgeMessage does not append agent mention when chat room has no default agent and no single room agent fallback', async () => {
  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-2',
    senderName: 'tester',
    content: '你好',
  });

  const savedMessage = await prisma.message.findFirst({
    where: {
      chatRoomId: 'bridge-service-room',
    },
    orderBy: { time: 'desc' },
  });

  assert.ok(savedMessage);
  assert.doesNotMatch(savedMessage.content, /@BridgeServiceDefaultAgent/);
});

test('syncRoomMessage sends group messages to all bound bots with active source conversations', async () => {
  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  const telegramBot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Telegram Bridge Bot',
    botToken: 'telegram-token',
  });
  const qqBot = await bridgeService.createBot({
    platform: 'qq',
    name: 'QQ Bridge Bot',
    config: { appId: 'qq-app-id', clientSecret: 'qq-secret' },
  });

  await bridgeService.bindBot(telegramBot.id, 'bridge-service-room');
  await bridgeService.bindBot(qqBot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: telegramBot.id,
    platform: 'telegram',
    externalId: 'tg-chat-1',
    senderName: 'telegram-user',
    content: 'hello from tg',
  });
  await bridgeService.receiveBridgeMessage({
    botId: qqBot.id,
    platform: 'qq',
    externalId: 'qq-chat-1',
    senderName: 'qq-user',
    content: 'hello from qq',
  });

  const sent: Array<{ platform: string; externalId: string; text: string; agentName: string }> = [];
  bridgeService.registerSender('telegram', async (_botId, externalId, text, agentName) => {
    sent.push({ platform: 'telegram', externalId, text, agentName });
  });
  bridgeService.registerSender('qq', async (_botId, externalId, text, agentName) => {
    sent.push({ platform: 'qq', externalId, text, agentName });
  });

  await bridgeService.syncRoomMessage('bridge-service-room', '群成员A', '同步这条群消息');

  assert.deepEqual(
    sent.map((item) => item.platform).sort(),
    ['qq', 'telegram'],
  );
  assert.ok(sent.every((item) => item.text.includes('同步这条群消息')));
});

test('sendTypingIndicator notifies all bound bots with active source conversations', async () => {
  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  const telegramBot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Telegram Bridge Bot',
    botToken: 'telegram-token',
  });
  const qqBot = await bridgeService.createBot({
    platform: 'qq',
    name: 'QQ Bridge Bot',
    config: { appId: 'qq-app-id', clientSecret: 'qq-secret' },
  });

  await bridgeService.bindBot(telegramBot.id, 'bridge-service-room');
  await bridgeService.bindBot(qqBot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: telegramBot.id,
    platform: 'telegram',
    externalId: 'tg-chat-typing',
    senderName: 'telegram-user',
    content: 'typing source',
  });
  await bridgeService.receiveBridgeMessage({
    botId: qqBot.id,
    platform: 'qq',
    externalId: 'qq-chat-typing',
    senderName: 'qq-user',
    content: 'typing source',
  });

  const typingCalls: Array<{ platform: string; externalId: string }> = [];
  bridgeService.registerTypingSender('telegram', async (_botId, externalId) => {
    typingCalls.push({ platform: 'telegram', externalId });
  });
  bridgeService.registerTypingSender('qq', async (_botId, externalId) => {
    typingCalls.push({ platform: 'qq', externalId });
  });

  await bridgeService.sendTypingIndicator('bridge-service-room');

  assert.deepEqual(
    typingCalls.map((item) => item.platform).sort(),
    ['qq', 'telegram'],
  );
});

test('createBot rejects incomplete platform credentials', async () => {
  await assert.rejects(
    () => bridgeService.createBot({
      platform: 'feishu',
      name: 'Broken Feishu Bot',
      config: { appId: 'only-app-id' },
    }),
    /缺少必填凭证/,
  );
});

test('createBot rejects invalid telegram bot token', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(
    () => bridgeService.createBot({
      platform: 'telegram',
      name: 'Bad Telegram Bot',
      botToken: 'bad-token',
    }),
    /Telegram 机器人不存在或 Token 无效/,
  );
});

test('createBot rejects invalid feishu app credentials', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('tenant_access_token')) {
      return new Response(JSON.stringify({ code: 99991663, msg: 'app not found' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    () => bridgeService.createBot({
      platform: 'feishu',
      name: 'Bad Feishu Bot',
      config: { appId: 'bad-app-id', appSecret: 'bad-secret' },
    }),
    /飞书机器人不存在或凭证无效/,
  );
});

test('receiveBridgeMessage falls back to the only active room agent when no default agent is configured', async () => {
  const agent = await prisma.agent.create({
    data: {
      id: 'bridge-service-agent-single-room',
      name: 'BridgeServiceDefaultAgent',
      prompt: 'test prompt',
      updatedAt: new Date(),
    },
  });

  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  await prisma.chatRoomAgent.create({
    data: {
      id: 'bridge-service-room-agent-single-room',
      chatRoomId: 'bridge-service-room',
      agentId: agent.id,
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-single-agent',
    senderName: 'tester',
    content: '你好',
  });

  const savedMessage = await prisma.message.findFirst({
    where: {
      chatRoomId: 'bridge-service-room',
    },
    orderBy: { time: 'desc' },
  });

  assert.ok(savedMessage);
  assert.match(savedMessage.content, /@BridgeServiceDefaultAgent/);
});

test('receiveBridgeMessage preserves explicit agent mentions from external platforms without appending default agent', async () => {
  const agent = await prisma.agent.create({
    data: {
      id: 'bridge-service-agent-explicit',
      name: 'BridgeServiceDefaultAgent',
      prompt: 'test prompt',
      updatedAt: new Date(),
    },
  });

  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      defaultAgentId: agent.id,
      updatedAt: new Date(),
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');

  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-explicit-agent',
    senderName: 'tester',
    content: '@other-agent 你好',
  });

  const savedMessage = await prisma.message.findFirst({
    where: {
      chatRoomId: 'bridge-service-room',
    },
    orderBy: { time: 'desc' },
  });

  assert.ok(savedMessage);
  assert.equal(savedMessage.content.includes('@BridgeServiceDefaultAgent'), false);
  assert.match(savedMessage.content, /@other-agent/);
});

test('bridge events store content preview for new inbound and outbound syncs', async () => {
  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');
  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-preview',
    senderName: 'tester',
    content: '这是来自外部平台的一条很重要的同步消息',
  });

  bridgeService.registerSender('telegram', async () => {});
  await bridgeService.syncRoomMessage('bridge-service-room', '群成员A', '群聊里也同步一条给外部平台');

  const events = await prisma.bridgeEvent.findMany({
    orderBy: { createdAt: 'asc' },
  });

  assert.equal(events.length, 2);
  assert.match(events[0]?.contentPreview ?? '', /很重要的同步消息/);
  assert.match(events[1]?.contentPreview ?? '', /群聊里也同步一条/);
});

test('bridge events keep only the last 20 days when new events are written', async () => {
  await prisma.chatRoom.create({
    data: {
      id: 'bridge-service-room',
      name: 'Bridge Service Room',
      updatedAt: new Date(),
    },
  });

  const expiredAt = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
  await prisma.bridgeEvent.create({
    data: {
      id: 'expired-bridge-event',
      platform: 'telegram',
      externalId: 'tg-expired',
      direction: 'inbound',
      status: 'success',
      createdAt: expiredAt,
    },
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Bridge Service Bot',
    botToken: 'test-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');
  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-retention',
    senderName: 'tester',
    content: '触发一次新的同步',
  });

  const expired = await prisma.bridgeEvent.findUnique({
    where: { id: 'expired-bridge-event' },
  });
  const freshCount = await prisma.bridgeEvent.count();

  assert.equal(expired, null);
  assert.equal(freshCount, 1);
});

test('sendAgentResponse does not leak an old room response into the latest conversation after rebind', async () => {
  await prisma.chatRoom.createMany({
    data: [
      {
        id: 'bridge-service-room',
        name: 'Bridge Service Room',
        updatedAt: new Date(),
      },
      {
        id: 'bridge-service-room-2',
        name: 'Bridge Service Room 2',
        updatedAt: new Date(),
      },
    ],
  });

  const bot = await bridgeService.createBot({
    platform: 'telegram',
    name: 'Shared Telegram Bridge Bot',
    botToken: 'telegram-token',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room');
  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-room-1',
    senderName: 'user-1',
    content: 'room-1 source',
  });

  await bridgeService.bindBot(bot.id, 'bridge-service-room-2', { forceRebind: true });
  await bridgeService.receiveBridgeMessage({
    botId: bot.id,
    platform: 'telegram',
    externalId: 'tg-chat-room-2',
    senderName: 'user-2',
    content: 'room-2 source',
  });

  const sent: Array<{ externalId: string; text: string }> = [];
  bridgeService.registerSender('telegram', async (_botId, externalId, text) => {
    sent.push({ externalId, text });
  });

  await bridgeService.sendAgentResponse('bridge-service-room', '助手A', '旧房间的回复不应串到新会话');
  await bridgeService.sendAgentResponse('bridge-service-room-2', '助手B', '只应发回 room-2');

  assert.deepEqual(sent, [
    { externalId: 'tg-chat-room-2', text: '只应发回 room-2' },
  ]);
});
