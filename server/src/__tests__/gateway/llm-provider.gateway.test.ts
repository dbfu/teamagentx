import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { llmProviderGateway } from '../../gateway/llm-provider.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';

const originalGetUserFromToken = authService.getUserFromToken;
const originalFindAll = llmProviderService.findAll;
const originalFindById = llmProviderService.findById;
const originalFetch = globalThis.fetch;

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
  globalThis.fetch = originalFetch;
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

  test('POST /llm-providers/fetch-models 获取供应商模型目录', async () => {
    const requestedUrls: string[] = [];
    let requestedHeaders: Record<string, string> = {};
    globalThis.fetch = async (input, init) => {
      const requestedUrl = String(input);
      requestedUrls.push(requestedUrl);
      requestedHeaders = (init?.headers ?? {}) as Record<string, string>;
      if (requestedUrl.endsWith('/models') && !requestedUrl.endsWith('/v1/models')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify({
        data: [
          { id: 'model-b', owned_by: 'provider' },
          { id: 'model-a', owned_by: 'provider' },
        ],
      }), { status: 200 });
    };

    const app = Fastify();
    await app.register(llmProviderGateway);

    const response = await app.inject({
      method: 'POST',
      url: '/llm-providers/fetch-models',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'sk-test-key',
        apiProtocol: 'openai',
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.json().data, [
      { id: 'model-a', ownedBy: 'provider' },
      { id: 'model-b', ownedBy: 'provider' },
    ]);
    assert.deepStrictEqual(requestedUrls, [
      'https://api.example.com/v1/models',
      'https://api.example.com/models',
    ]);
    assert.strictEqual(requestedHeaders.Authorization, 'Bearer sk-test-key');

    await app.close();
  });

  test('POST /llm-providers/fetch-models 拒绝脱敏 API Key', async () => {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return new Response('{}', { status: 200 });
    };

    const app = Fastify();
    await app.register(llmProviderGateway);

    const response = await app.inject({
      method: 'POST',
      url: '/llm-providers/fetch-models',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'sk-***-key',
      },
    });

    assert.strictEqual(response.statusCode, 400);
    assert.strictEqual(requestCount, 0);

    await app.close();
  });

  test('POST /llm-providers/:id/fetch-models 使用已保存密钥返回 Codex 思考强度元数据', async () => {
    let requestedUrl = '';
    let requestedHeaders: Record<string, string> = {};
    llmProviderService.findById = async () => ({
      ...provider,
      agents: [],
    }) as Awaited<ReturnType<typeof llmProviderService.findById>>;
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(JSON.stringify({
        models: [{
          slug: 'gpt-5.3-codex',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }],
        }],
      }), { status: 200 });
    };

    const app = Fastify();
    await app.register(llmProviderGateway);

    const response = await app.inject({
      method: 'POST',
      url: '/llm-providers/provider-1/fetch-models',
      headers: { authorization: 'Bearer test-token' },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.json().data, [{
      id: 'gpt-5.3-codex',
      ownedBy: null,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    }]);
    assert.strictEqual(requestedUrl, 'https://api.example.com/v1/models');
    assert.strictEqual(requestedHeaders.Authorization, 'Bearer sk-full-secret-key');

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
