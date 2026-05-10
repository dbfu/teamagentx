import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';

// Helper to build test app
function buildTestApp(): FastifyInstance {
  const app = Fastify();
  return app;
}

describe('ChatRoom Gateway API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildTestApp();
    await app.register(chatRoomGateway);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /chatrooms', () => {
    test('应该返回所有聊天室列表', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/chatrooms',
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });
  });

  describe('POST /chatrooms', () => {
    test('应该创建新的聊天室', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Test Room ' + Date.now(),
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.id);
      assert.ok(body.data.name.startsWith('Test Room'));
    });

    test('应该创建包含所有字段的聊天室', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Full Room ' + Date.now(),
          avatar: '🏠',
          avatarColor: '#1890ff',
          description: 'A test chatroom',
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.avatar, '🏠');
      assert.strictEqual(body.data.avatarColor, '#1890ff');
      assert.strictEqual(body.data.description, 'A test chatroom');
    });
  });

  describe('GET /chatrooms/:id', () => {
    test('应该返回 404 当聊天室不存在时', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/chatrooms/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'ChatRoom not found');
    });

    test('应该根据 ID 返回聊天室', async () => {
      // First create a chatroom
      const createResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Find Test ' + Date.now(),
        },
      });
      const created = createResponse.json();

      // Get the chatroom
      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${created.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, created.data.id);
    });
  });

  describe('DELETE /chatrooms/:id', () => {
    test('应该返回 404 当聊天室不存在时', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/chatrooms/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);
    });

    test('应该删除聊天室', async () => {
      // First create a chatroom
      const createResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Delete Test ' + Date.now(),
        },
      });
      const created = createResponse.json();

      // Delete the chatroom
      const response = await app.inject({
        method: 'DELETE',
        url: `/chatrooms/${created.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
    });
  });
});