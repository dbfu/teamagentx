import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { messageGateway } from '../../gateway/message.gateway.js';
import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma.js';

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

    test('群聊消息超过 100 条时应该返回最新 100 条并保持正序', async () => {
      const chatRoomId = randomUUID();
      const baseTime = Date.parse('2026-05-21T00:00:00.000Z');
      const messageIds = Array.from({ length: 105 }, (_, index) => `${chatRoomId}-${index}`);

      await prisma.chatRoom.create({
        data: {
          id: chatRoomId,
          name: 'Long Room',
          updatedAt: new Date(),
        },
      });
      await prisma.message.createMany({
        data: messageIds.map((id, index) => ({
          id,
          type: 'MESSAGE',
          content: `message ${index}`,
          chatRoomId,
          isHuman: true,
          time: new Date(baseTime + index * 1000),
          updatedAt: new Date(),
        })),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/messages?chatRoomId=${chatRoomId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.length, 100);
      assert.strictEqual(body.data[0].id, messageIds[5]);
      assert.strictEqual(body.data[99].id, messageIds[104]);
      assert.strictEqual(body.pagination.hasMore, true);
      assert.strictEqual(body.pagination.beforeMessageId, messageIds[5]);
    });

    test('应该通过 beforeMessageId 分页加载更早的群聊消息', async () => {
      const chatRoomId = randomUUID();
      const baseTime = Date.parse('2026-05-21T01:00:00.000Z');
      const messageIds = Array.from({ length: 105 }, (_, index) => `${chatRoomId}-older-${index}`);

      await prisma.chatRoom.create({
        data: {
          id: chatRoomId,
          name: 'Paged Room',
          updatedAt: new Date(),
        },
      });
      await prisma.message.createMany({
        data: messageIds.map((id, index) => ({
          id,
          type: 'MESSAGE',
          content: `message ${index}`,
          chatRoomId,
          isHuman: true,
          time: new Date(baseTime + index * 1000),
          updatedAt: new Date(),
        })),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/messages?chatRoomId=${chatRoomId}&beforeMessageId=${messageIds[5]}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.length, 5);
      assert.deepStrictEqual(body.data.map((message: { id: string }) => message.id), messageIds.slice(0, 5));
      assert.strictEqual(body.pagination.hasMore, false);
      assert.strictEqual(body.pagination.beforeMessageId, messageIds[0]);
    });

    test('应该为刷新后的各平台桥接入站消息补充一致的平台用户名', async () => {
      const chatRoomId = randomUUID();
      const bridgeCases = [
        { platform: 'telegram', externalId: 'tg-chat-1', username: 'Telegram:tg-chat-1', content: 'Telegram 原文' },
        { platform: 'feishu', externalId: 'oc_feishu_chat', username: '飞书:oc_feishu_chat', content: '飞书原文' },
        { platform: 'dingtalk', externalId: 'dd-chat-1', username: '钉钉:dd-chat-1', content: '钉钉原文' },
        { platform: 'wecom', externalId: 'wx-chat-1', username: '企微:wx-chat-1', content: '企微原文' },
        { platform: 'qq', externalId: 'qq-chat-1', username: 'QQ:qq-chat-1', content: 'QQ 原文' },
      ].map((item) => ({ ...item, messageId: randomUUID() }));

      await prisma.chatRoom.create({
        data: {
          id: chatRoomId,
          name: 'Bridge Room',
          updatedAt: new Date(),
        },
      });
      await prisma.message.createMany({
        data: bridgeCases.map((item) => ({
          id: item.messageId,
          type: 'MESSAGE',
          content: item.content,
          chatRoomId,
          isHuman: true,
          updatedAt: new Date(),
        })),
      });
      await prisma.bridgeEvent.createMany({
        data: bridgeCases.map((item) => ({
          platform: item.platform,
          externalId: item.externalId,
          direction: 'inbound',
          status: 'success',
          messageId: item.messageId,
          contentPreview: item.content,
        })),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/messages?chatRoomId=${chatRoomId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      for (const item of bridgeCases) {
        const message = body.data.find((candidate: { id: string }) => candidate.id === item.messageId);
        assert.strictEqual(message.user.username, item.username);
        assert.strictEqual(message.content, item.content);
      }
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
      const otherChatRoomId = randomUUID();

      await prisma.chatRoom.createMany({
        data: [
          { id: chatRoomId, name: 'Clear Room', updatedAt: new Date() },
          { id: otherChatRoomId, name: 'Other Room', updatedAt: new Date() },
        ],
      });
      await prisma.message.createMany({
        data: [
          {
            id: `${chatRoomId}-message-1`,
            type: 'MESSAGE',
            content: 'target message 1',
            chatRoomId,
            isHuman: true,
            updatedAt: new Date(),
          },
          {
            id: `${chatRoomId}-message-2`,
            type: 'MESSAGE',
            content: 'target message 2',
            chatRoomId,
            isHuman: true,
            updatedAt: new Date(),
          },
          {
            id: `${otherChatRoomId}-message-1`,
            type: 'MESSAGE',
            content: 'other message',
            chatRoomId: otherChatRoomId,
            isHuman: true,
            updatedAt: new Date(),
          },
        ],
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/messages/chatroom/${chatRoomId}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.count, 2);
      assert.strictEqual(await prisma.message.count({ where: { chatRoomId } }), 0);
      assert.strictEqual(await prisma.message.count({ where: { chatRoomId: otherChatRoomId } }), 1);
    });
  });
});
