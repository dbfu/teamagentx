import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Fastify, { FastifyInstance } from 'fastify';
import { agentGateway } from '../../gateway/agent.gateway.js';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';
import { _testInjectDebugInfo, clearExecutorCache } from '../../core/agent/agent-handler/index.js';
import prisma from '../../lib/prisma.js';
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '../../core/agent/system-assistant.constants.js';
import { getGroupAssistantDefinition, getGroupCoordinatorDefinition } from '../../scripts/system-agent-definitions.js';
import { syncSystemAgents } from '../../scripts/system-agent-sync.js';

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
      assert.strictEqual(body.error, '助手不存在');
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

    test('新建 Agent 应排在未分类列表最前面', async () => {
      const suffix = Date.now();
      const firstResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Sort First Agent ${suffix}`,
          prompt: 'first',
        },
      });
      const secondResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Sort Second Agent ${suffix}`,
          prompt: 'second',
        },
      });

      assert.strictEqual(firstResponse.statusCode, 201);
      assert.strictEqual(secondResponse.statusCode, 201);

      const first = firstResponse.json().data;
      const second = secondResponse.json().data;
      assert.ok(second.sortOrder > first.sortOrder);

      const groupedResponse = await app.inject({
        method: 'GET',
        url: '/agents/grouped',
      });
      assert.strictEqual(groupedResponse.statusCode, 200);

      const grouped = groupedResponse.json();
      assert.strictEqual(grouped.success, true);
      assert.strictEqual(grouped.data.uncategorized[0].id, second.id);
    });

    test('应该在分组列表返回群助手和群调度助手', async () => {
      await syncSystemAgents([
        getGroupAssistantDefinition(),
        getGroupCoordinatorDefinition(),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/agents/grouped',
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);

      const systemAgents = body.data.categories
        .flatMap((group: any) => group.agents)
        .filter((agent: any) => agent.agentLevel === 'system');
      assert.ok(systemAgents.some((agent: any) => agent.id === GROUP_ASSISTANT_ID));
      assert.ok(systemAgents.some((agent: any) => agent.id === GROUP_COORDINATOR_ID));
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
      assert.strictEqual(body.error, '助手名称已存在');
    });

    test('应该创建并返回助手级 speechConfig', async () => {
      const speechConfig = {
        behavior: {
          enabled: true,
          outputMode: 'manual',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          voice: 'voice-zh-female-001',
          speed: 1,
          volume: 1,
          pitch: 1,
          emotion: 'calm',
          style: 'conversational',
          prompt: '自然一点',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Voice Agent ' + Date.now(),
          prompt: 'Speak clearly',
          speechConfig,
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.deepStrictEqual(body.data.speechConfig, {
        behavior: {
          enabled: true,
          outputMode: 'manual',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          model: null,
          voice: 'voice-zh-female-001',
          fallbackProvider: null,
          speed: 1,
          volume: 1,
          pitch: 1,
          emotion: 'calm',
          style: 'conversational',
          format: null,
          sampleRate: null,
          temperature: null,
          prompt: '自然一点',
          vendorOptions: null,
        },
      });
    });

    test('应该允许创建时显式传入空 speechConfig', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'No Voice Agent ' + Date.now(),
          prompt: 'No voice configured',
          speechConfig: null,
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.speechConfig, null);
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

    test('应该允许更新时显式清空 speechConfig', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Clear Voice Agent ' + Date.now(),
          prompt: 'Original prompt',
          speechConfig: {
            behavior: {
              enabled: true,
              outputMode: 'manual',
              autoPlay: false,
            },
            profile: {
              provider: 'browser-local',
              voice: 'voice-zh-female-001',
            },
          },
        },
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/agents/${created.data.id}`,
        payload: {
          llmProviderId: null,
          speechConfig: null,
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.llmProviderId, null);
      assert.strictEqual(body.data.speechConfig, null);
    });

    test('应该允许更新时显式清空已绑定的 LLM 供应商', async () => {
      const provider = await prisma.llmProvider.create({
        data: {
          name: 'Clear Bound Provider ' + Date.now(),
          type: 'custom',
          modelType: 'text',
          apiProtocol: 'openai',
          apiUrl: 'https://api.openai.com/v1',
          apiKey: 'test-key',
          model: 'gpt-5-mini',
          isActive: true,
        },
      });

      const createResponse = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Clear Bound Provider Agent ' + Date.now(),
          prompt: 'Original prompt',
          type: 'acp',
          acpTool: 'codex',
          llmProviderId: provider.id,
        },
      });
      const created = createResponse.json();
      assert.strictEqual(created.data.llmProviderId, provider.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/agents/${created.data.id}`,
        payload: {
          llmProviderId: null,
        },
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.llmProviderId, null);
      assert.strictEqual(body.data.llmProvider, null);
    });

    test('应该允许群助手和群调度助手更新模型供应商', async () => {
      const provider = await prisma.llmProvider.create({
        data: {
          name: 'System Group Provider ' + Date.now(),
          apiProtocol: 'anthropic',
          apiKey: 'test-key',
          model: 'claude-test-model',
        },
      });
      await syncSystemAgents([
        getGroupAssistantDefinition(),
        getGroupCoordinatorDefinition(),
      ]);

      try {
        const groupResponse = await app.inject({
          method: 'PUT',
          url: `/agents/${GROUP_ASSISTANT_ID}`,
          payload: {
            llmProviderId: provider.id,
          },
        });
        const coordinatorResponse = await app.inject({
          method: 'PUT',
          url: `/agents/${GROUP_COORDINATOR_ID}`,
          payload: {
            llmProviderId: provider.id,
          },
        });

        assert.strictEqual(groupResponse.statusCode, 200);
        assert.strictEqual(coordinatorResponse.statusCode, 200);

        const groupBody = groupResponse.json();
        const coordinatorBody = coordinatorResponse.json();
        assert.strictEqual(groupBody.success, true);
        assert.strictEqual(coordinatorBody.success, true);
        assert.strictEqual(groupBody.data.llmProviderId, provider.id);
        assert.strictEqual(coordinatorBody.data.llmProviderId, provider.id);

        const runtimeResponse = await app.inject({
          method: 'PUT',
          url: `/agents/${GROUP_ASSISTANT_ID}`,
          payload: {
            acpTool: 'codex',
            llmProviderId: null,
            codexModel: 'gpt-5-codex',
            codexFastMode: true,
            thinkingMode: 'medium',
          },
        });

        assert.strictEqual(runtimeResponse.statusCode, 200);
        const runtimeBody = runtimeResponse.json();
        assert.strictEqual(runtimeBody.data.acpTool, 'codex');
        assert.strictEqual(runtimeBody.data.llmProviderId, null);
        assert.strictEqual(runtimeBody.data.codexModel, 'gpt-5-codex');
        assert.strictEqual(runtimeBody.data.codexFastMode, true);
        assert.strictEqual(runtimeBody.data.thinkingMode, 'medium');

        await syncSystemAgents([
          getGroupAssistantDefinition(),
          getGroupCoordinatorDefinition(),
        ]);
        const preserved = await prisma.agent.findUniqueOrThrow({
          where: { id: GROUP_ASSISTANT_ID },
          select: {
            acpTool: true,
            llmProviderId: true,
            codexModel: true,
            codexFastMode: true,
            thinkingMode: true,
          },
        });
        assert.strictEqual(preserved.acpTool, 'codex');
        assert.strictEqual(preserved.llmProviderId, null);
        assert.strictEqual(preserved.codexModel, 'gpt-5-codex');
        assert.strictEqual(preserved.codexFastMode, true);
        assert.strictEqual(preserved.thinkingMode, 'medium');

        const rejectedResponse = await app.inject({
          method: 'PUT',
          url: `/agents/${GROUP_ASSISTANT_ID}`,
          payload: {
            prompt: 'should still be protected',
          },
        });

        assert.strictEqual(rejectedResponse.statusCode, 403);
      } finally {
        await prisma.agent.update({
          where: { id: GROUP_ASSISTANT_ID },
          data: {
            acpTool: 'claude',
            llmProviderId: null,
            codexModel: null,
            codexFastMode: false,
            thinkingMode: 'high',
          },
        }).catch(() => null);
        await prisma.agent.update({
          where: { id: GROUP_COORDINATOR_ID },
          data: { llmProviderId: null },
        }).catch(() => null);
        await prisma.llmProvider.delete({
          where: { id: provider.id },
        }).catch(() => null);
      }
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
      assert.strictEqual(body.error, '未找到助手调试信息，助手可能尚未被调用');
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
