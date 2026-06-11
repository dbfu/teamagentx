import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { bridgeGateway, handleBindCode } from '../../gateway/bridge.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';
import prisma from '../../lib/prisma.js';
import {
  clearBridgeBindCodesForTest,
  consumeBridgeBindCode,
  createBridgeBotBindCode,
} from '../../modules/bridge/bridge-bind-code-store.js';

function buildTestApp(): FastifyInstance {
  return Fastify();
}

async function ensureUser(id: string, username: string) {
  await prisma.user.upsert({
    where: { id },
    update: { username, password: 'password', updatedAt: new Date() },
    create: {
      id,
      username,
      password: 'password',
      updatedAt: new Date(),
    },
  });
}

describe('Bridge Gateway API', () => {
  let app: FastifyInstance;
  let originalGetUserFromToken: typeof authService.getUserFromToken;

  beforeEach(async () => {
    app = buildTestApp();
    originalGetUserFromToken = authService.getUserFromToken;
    await ensureUser('bridge-test-user', 'bridge-tester');
    await ensureUser('bridge-other-user', 'bridge-other');
    authService.getUserFromToken = async () => ({
      id: 'bridge-test-user',
      username: 'bridge-tester',
      avatar: null,
      preferredLanguage: 'zh-CN',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await app.register(bridgeGateway);
  });

  afterEach(async () => {
    authService.getUserFromToken = originalGetUserFromToken;
    clearBridgeBindCodesForTest();
    await prisma.bridgeBot.deleteMany({
      where: {
        name: {
          startsWith: 'Bridge Gateway Test',
        },
      },
    });
    await prisma.message.deleteMany({
      where: {
        chatRoomId: {
          in: ['bridge-owner-room', 'bridge-other-room'],
        },
      },
    });
    await prisma.chatRoom.deleteMany({
      where: {
        id: {
          in: ['bridge-create-bind-room', 'bridge-owner-room', 'bridge-other-room'],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: ['bridge-test-user', 'bridge-other-user'],
        },
      },
    });
    await app.close();
  });

  test('POST /api/bridge/bots 应该创建机器人实例', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bridge/bots',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        platform: 'qq',
        name: `Bridge Gateway Test ${Date.now()}`,
        config: {
          appId: 'qq_test_app_id',
          clientSecret: 'qq_test_app_secret',
        },
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.platform, 'qq');
    assert.equal(body.data.hasConfig, true);
    assert.equal(body.data.name.startsWith('Bridge Gateway Test'), true);
  });

  test('POST /api/bridge/bots 支持创建时直接绑定群聊', async () => {
    await prisma.chatRoom.create({
      data: {
        id: 'bridge-create-bind-room',
        name: '创建即绑定测试群',
        ownerId: 'bridge-test-user',
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/bridge/bots',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        platform: 'qq',
        name: `Bridge Gateway Test Bind ${Date.now()}`,
        config: {
          appId: 'qq-app-id',
          clientSecret: 'qq-client-secret',
        },
        chatRoomId: 'bridge-create-bind-room',
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.chatRoomId, 'bridge-create-bind-room');
  });

  test('POST /api/bridge/bots 拒绝绑定到不属于当前用户的群聊', async () => {
    await prisma.chatRoom.create({
      data: {
        id: 'bridge-other-room',
        name: '其他人的群聊',
        ownerId: 'bridge-other-user',
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/bridge/bots',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        platform: 'qq',
        name: `Bridge Gateway Test Unauthorized ${Date.now()}`,
        config: {
          appId: 'qq-app-id',
          clientSecret: 'qq-client-secret',
        },
        chatRoomId: 'bridge-other-room',
      },
    });

    assert.equal(response.statusCode, 403);
    const body = response.json();
    assert.equal(body.success, false);
    assert.match(body.error, /无权操作此聊天室/);
  });

  test('GET /api/bridge/events 只返回当前用户房间的事件', async () => {
    await prisma.chatRoom.createMany({
      data: [
        {
          id: 'bridge-owner-room',
          name: '我的群聊',
          ownerId: 'bridge-test-user',
          updatedAt: new Date(),
        },
        {
          id: 'bridge-other-room',
          name: '别人的群聊',
          ownerId: 'bridge-other-user',
          updatedAt: new Date(),
        },
      ],
    });

    await prisma.message.createMany({
      data: [
        {
          id: 'bridge-owner-msg',
          content: '我的事件内容',
          chatRoomId: 'bridge-owner-room',
          updatedAt: new Date(),
        },
        {
          id: 'bridge-other-msg',
          content: '别人的事件内容',
          chatRoomId: 'bridge-other-room',
          updatedAt: new Date(),
        },
      ],
    });

    await prisma.bridgeEvent.createMany({
      data: [
        {
          id: 'bridge-owner-event',
          platform: 'telegram',
          externalId: 'owner-chat',
          direction: 'inbound',
          status: 'success',
          messageId: 'bridge-owner-msg',
          createdAt: new Date(),
        },
        {
          id: 'bridge-other-event',
          platform: 'telegram',
          externalId: 'other-chat',
          direction: 'inbound',
          status: 'success',
          messageId: 'bridge-other-msg',
          createdAt: new Date(),
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/bridge/events?platform=telegram',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, 'bridge-owner-event');
    assert.equal(body.data[0].contentPreview, '我的事件内容');
  });

  test('handleBindCode does not consume a bot-scoped code when sent to the wrong bot', async () => {
    const { code } = createBridgeBotBindCode('telegram', 'expected-bot', 'target-room', 60);
    const replies: string[] = [];

    const handled = await handleBindCode(
      'telegram',
      'wrong-bot',
      'external-chat',
      'Telegram 群',
      code,
      async (text) => {
        replies.push(text);
      },
      {
        info: () => {},
        error: () => {},
      },
    );

    assert.equal(handled, true);
    assert.match(replies[0] ?? '', /不属于当前机器人/);
    const stillAvailable = consumeBridgeBindCode('telegram', code);
    assert.deepEqual(stillAvailable, {
      platform: 'telegram',
      botId: 'expected-bot',
      chatRoomId: 'target-room',
    });
  });
});
