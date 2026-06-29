import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { llmProviderGateway } from '../../gateway/llm-provider.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';

const originalGetUserFromToken = authService.getUserFromToken;
const originalFindAll = llmProviderService.findAll;
const originalFindById = llmProviderService.findById;

const createdAt = new Date('2026-06-01T00:00:00.000Z');
const updatedAt = new Date('2026-06-02T00:00:00.000Z');

const provider = {
  id: 'provider-1',
  name: 'Provider One',
  type: 'custom',
  modelType: 'audio',
  apiProtocol: 'openai',
  codexWireApi: 'chat',
  apiUrl: 'https://api.example.com/v1',
  apiKey: 'sk-full-secret-key',
  model: 'tts-model',
  contextLength: 64000,
  sttModel: 'stt-model',
  audioUsage: 'both',
  imageProvider: null,
  imageApiType: null,
  supportsThinking: null,
  isActive: true,
  isDefault: false,
  createdAt,
  updatedAt,
};

beforeEach(() => {
  authService.getUserFromToken = async () => ({
    id: 'test-user-id',
    username: 'tester',
    avatar: null,
    preferredLanguage: 'zh-CN',
    createdAt,
  });
});

afterEach(() => {
  authService.getUserFromToken = originalGetUserFromToken;
  llmProviderService.findAll = originalFindAll;
  llmProviderService.findById = originalFindById;
});

describe('LLM Provider Gateway API key responses', () => {
  test('GET /llm-providers 应继续返回脱敏 API Key', async () => {
    const app = Fastify();
    llmProviderService.findAll = async () => ([
      {
        ...provider,
        _count: { agents: 0 },
      },
    ] as unknown) as Awaited<ReturnType<typeof llmProviderService.findAll>>;

    await app.register(llmProviderGateway);

    const response = await app.inject({
      method: 'GET',
      url: '/llm-providers',
      headers: { authorization: 'Bearer test-token' },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data[0].apiKey, 'sk-***-key');

    await app.close();
  });

  test('GET /llm-providers/:id 应返回完整 API Key 供编辑和复制使用', async () => {
    const app = Fastify();
    llmProviderService.findById = async () => ({
      ...provider,
      agents: [
        {
          id: 'agent-1',
          name: 'Agent One',
          avatar: null,
          avatarColor: null,
          description: null,
          agentLevel: 'personal',
          isActive: true,
        },
      ],
    }) as Awaited<ReturnType<typeof llmProviderService.findById>>;

    await app.register(llmProviderGateway);

    const response = await app.inject({
      method: 'GET',
      url: '/llm-providers/provider-1',
      headers: { authorization: 'Bearer test-token' },
    });

    assert.strictEqual(response.statusCode, 200);
    const body = response.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.apiKey, 'sk-full-secret-key');
    assert.strictEqual(body.data.codexWireApi, 'chat');
    assert.strictEqual(body.data.contextLength, 64000);
    assert.strictEqual(body.data.sttModel, 'stt-model');
    assert.strictEqual(body.data.audioUsage, 'both');
    assert.strictEqual(body.data.agents[0].agentLevel, 'personal');

    await app.close();
  });
});
