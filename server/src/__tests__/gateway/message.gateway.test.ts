import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { messageGateway } from '../../gateway/message.gateway.js';
import { randomUUID } from 'crypto';

// Helper to build test app
function buildTestApp(): FastifyInstance {
  const app = Fastify();
  return app;
}

describe('Message Gateway API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildTestApp();
    await app.register(messageGateway);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /messages', () => {
    test('应该返回所有消息列表', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/messages',
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });

    test('应该根据 chatRoomId 过滤消息', async () => {
      const chatRoomId = randomUUID();

      const response = await app.inject({
        method: 'GET',
        url: `/messages?chatRoomId=${chatRoomId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });
  });

  describe('GET /messages/:id', () => {
    test('应该返回 404 当消息不存在时', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/messages/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, '消息不存在');
    });
  });

  describe('DELETE /messages/chatroom/:chatRoomId', () => {
    test('应该清空聊天室中的所有消息', async () => {
      const chatRoomId = randomUUID();

      const response = await app.inject({
        method: 'DELETE',
        url: `/messages/chatroom/${chatRoomId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
    });
  });
});
