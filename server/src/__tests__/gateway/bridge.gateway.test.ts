import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { bridgeGateway } from '../../gateway/bridge.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';
import prisma from '../../lib/prisma.js';

function buildTestApp(): FastifyInstance {
  return Fastify();
}

describe('Bridge Gateway API', () => {
  let app: FastifyInstance;
  let originalGetUserFromToken: typeof authService.getUserFromToken;

  beforeEach(async () => {
    app = buildTestApp();
    originalGetUserFromToken = authService.getUserFromToken;
    authService.getUserFromToken = async () => ({
      id: 'bridge-test-user',
      username: 'bridge-tester',
      avatar: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await app.register(bridgeGateway);
  });

  afterEach(async () => {
    authService.getUserFromToken = originalGetUserFromToken;
    await prisma.bridgeBot.deleteMany({
      where: {
        name: {
          startsWith: 'Bridge Gateway Test',
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
});
