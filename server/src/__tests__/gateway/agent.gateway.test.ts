import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { agentGateway } from '../../gateway/agent.gateway.js';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';
import { _testInjectDebugInfo, clearExecutorCache } from '../../core/agent/agent-handler/index.js';

// Helper to build test app
function buildTestApp(): FastifyInstance {
  const app = Fastify();
  return app;
}

describe('Agent Gateway API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildTestApp();
    await app.register(agentGateway);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /agents', () => {
    test('应该返回所有 Agent 列表', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents',
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });
  });

  describe('GET /agents/active', () => {
    test('应该返回活跃的 Agent 列表', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/active',
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });
  });

  describe('GET /agents/:id', () => {
    test('应该返回 404 当 Agent 不存在时', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Agent not found');
    });
  });

  describe('POST /agents', () => {
    test('应该创建新的 Agent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Test Agent ' + Date.now(),
          prompt: 'You are a helpful assistant',
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.name.startsWith('Test Agent'), true);
      assert.strictEqual(body.data.prompt, 'You are a helpful assistant');
    });

    test('应该允许空提示词创建 Agent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Empty Prompt Agent ' + Date.now(),
          prompt: '',
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.prompt, '');
    });

    test('应该创建包含所有字段的 Agent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Full Agent ' + Date.now(),
          avatar: '🤖',
          avatarColor: '#FF5733',
          description: 'A test agent',
          prompt: 'Be helpful',
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.avatar, '🤖');
      assert.strictEqual(body.data.avatarColor, '#FF5733');
      assert.strictEqual(body.data.description, 'A test agent');
    });

    test('应该返回 409 当名称重复时', async () => {
      const name = 'Duplicate Agent ' + Date.now();

      // Create first agent
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name,
          prompt: 'First',
        },
      });

      // Try to create second with same name
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name,
          prompt: 'Second',
        },
      });

      assert.strictEqual(response.statusCode, 409);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, 'Agent name already exists');
    });
  });

  describe('PUT /agents/:id', () => {
    test('应该更新 Agent', async () => {
      // First create an agent
      const createResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Update Test ' + Date.now(),
          prompt: 'Original prompt',
        },
      });
      const created = createResponse.json();

      // Update the agent
      const response = await app.inject({
        method: 'PUT',
        url: `/agents/${created.data.id}`,
        payload: {
          prompt: 'Updated prompt',
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.prompt, 'Updated prompt');
    });

    test('应该返回 404 当 Agent 不存在时', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/agents/non-existent-id',
        payload: {
          prompt: 'Updated',
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe('DELETE /agents/:id', () => {
    test('应该删除 Agent', async () => {
      // First create an agent
      const createResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Delete Test ' + Date.now(),
          prompt: 'To be deleted',
        },
      });
      const created = createResponse.json();

      // Delete the agent
      const response = await app.inject({
        method: 'DELETE',
        url: `/agents/${created.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
    });

    test('应该返回 404 当 Agent 不存在时', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/agents/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe('PATCH /agents/:id/status', () => {
    test('应该激活/停用 Agent', async () => {
      // First create an agent
      const createResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Status Test ' + Date.now(),
          prompt: 'Test',
        },
      });
      const created = createResponse.json();

      // Deactivate the agent
      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/${created.data.id}/status`,
        payload: {
          isActive: false,
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.isActive, false);
    });
  });

  describe('GET /chatrooms/:chatRoomId/agents/:agentName/debug', () => {
    test('应该返回 404 当调试信息不存在时', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/chatrooms/test-chatroom/agents/NonExistentAgent/debug',
      });

      assert.strictEqual(response.statusCode, 404);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.ok(body.error.includes('not found'));
    });

    test('应该返回 Agent 调试信息', async () => {
      // Setup test data
      const chatRoomId = 'test-chatroom-' + Date.now();
      const agentName = 'TestDebugAgent';

      _testInjectDebugInfo(chatRoomId, agentName, {
        name: agentName,
        systemPrompt: 'You are a test assistant',
        lastContext: 'Test context message',
        lastInvokeResult: '{"messages": []}',
        lastHistory: [
          { content: 'Hello', senderName: 'User1', isHuman: true },
        ],
        injectGroupHistory: true,
        chatRoomAgents: [{ name: agentName, agentId: 'test-agent-id' }, { name: 'OtherAgent', agentId: 'other-agent-id' }],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${chatRoomId}/agents/${agentName}/debug`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.name, agentName);
      assert.strictEqual(body.data.systemPrompt, 'You are a test assistant');
      assert.strictEqual(body.data.lastContext, 'Test context message');
      assert.strictEqual(body.data.injectGroupHistory, true);
      assert.deepStrictEqual(body.data.chatRoomAgents, [{ name: agentName, agentId: 'test-agent-id' }, { name: 'OtherAgent', agentId: 'other-agent-id' }]);
      assert.ok(Array.isArray(body.data.lastHistory));
      assert.strictEqual(body.data.lastHistory.length, 1);

      // Cleanup
      clearExecutorCache(agentName);
    });

    test('应该处理带特殊字符的 Agent 名称', async () => {
      const chatRoomId = 'test-chatroom-special';
      const agentName = '测试助手';

      _testInjectDebugInfo(chatRoomId, agentName, {
        name: agentName,
        systemPrompt: '测试提示词',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${chatRoomId}/agents/${encodeURIComponent(agentName)}/debug`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.name, agentName);

      // Cleanup
      clearExecutorCache(agentName);
    });
  });
});
