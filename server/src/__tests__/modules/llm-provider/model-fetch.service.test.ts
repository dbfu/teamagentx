import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import {
  buildModelsUrlCandidates,
  fetchModels,
  parseFetchedModels,
} from '../../../modules/llm-provider/model-fetch.service.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('LLM provider model discovery', () => {
  test('builds compatible /models candidates from base URLs', () => {
    assert.deepStrictEqual(
      buildModelsUrlCandidates('https://api.example.com/v1'),
      ['https://api.example.com/v1/models', 'https://api.example.com/models'],
    );
    assert.deepStrictEqual(
      buildModelsUrlCandidates('https://api.example.com'),
      ['https://api.example.com/v1/models', 'https://api.example.com/models'],
    );
    assert.deepStrictEqual(
      buildModelsUrlCandidates('https://api.example.com/api/anthropic'),
      [
        'https://api.example.com/api/anthropic/v1/models',
        'https://api.example.com/api/anthropic/models',
        'https://api.example.com/v1/models',
        'https://api.example.com/models',
      ],
    );
    assert.deepStrictEqual(
      buildModelsUrlCandidates('https://api.example.com/v1/chat/completions'),
      ['https://api.example.com/v1/models', 'https://api.example.com/models'],
    );
    assert.deepStrictEqual(
      buildModelsUrlCandidates('https://api.example.com/v1/models'),
      ['https://api.example.com/v1/models'],
    );
  });

  test('normalizes, de-duplicates, and sorts model entries', () => {
    assert.deepStrictEqual(
      parseFetchedModels({
        data: [
          { id: 'z-model', owned_by: 'vendor-z' },
          { id: ' a-model ', ownedBy: 'vendor-a' },
          { id: 'z-model', owned_by: 'duplicate' },
          { id: '' },
          { name: 'invalid' },
        ],
      }),
      [
        { id: 'a-model', ownedBy: 'vendor-a' },
        { id: 'z-model', ownedBy: 'vendor-z' },
      ],
    );
  });

  test('parses Codex model metadata and reasoning levels', () => {
    assert.deepStrictEqual(
      parseFetchedModels({
        models: [
          {
            slug: 'gpt-5.3-codex',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'medium' },
              { effort: 'high' },
              { effort: 'xhigh' },
            ],
          },
        ],
      }),
      [{
        id: 'gpt-5.3-codex',
        ownedBy: null,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      }],
    );
  });

  test('preserves the gpt-5.6-sol reasoning metadata including ultra', () => {
    assert.deepStrictEqual(
      parseFetchedModels({
        models: [{
          slug: 'gpt-5.6-sol',
          default_reasoning_level: 'low',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
            { effort: 'xhigh' },
            { effort: 'max' },
            { effort: 'ultra' },
          ],
        }],
      }),
      [{
        id: 'gpt-5.6-sol',
        ownedBy: null,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      }],
    );
  });

  test('fetches an OpenAI-compatible catalog with Bearer auth', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({
        data: [{ id: 'model-a', owned_by: 'provider-a' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const models = await fetchModels({
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      apiProtocol: 'openai',
    });

    assert.deepStrictEqual(models, [{ id: 'model-a', ownedBy: 'provider-a' }]);
    assert.strictEqual(calls[0].url, 'https://api.example.com/v1/models');
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer secret-key');
  });

  test('continues from a plain /v1/models catalog to Codex reasoning metadata', async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5.3-codex' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        models: [{
          slug: 'gpt-5.3-codex',
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
        }],
      }), { status: 200 });
    };

    const models = await fetchModels({
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      apiProtocol: 'openai',
    });

    assert.deepStrictEqual(models[0]?.supportedReasoningEfforts, ['low', 'high']);
    assert.deepStrictEqual(calls, [
      'https://api.example.com/v1/models',
      'https://api.example.com/models',
    ]);
  });

  test('falls back from Anthropic auth to Bearer auth', async () => {
    const headers: Array<Record<string, string>> = [];
    globalThis.fetch = async (_input, init) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      if (headers.length === 1) return new Response('unauthorized', { status: 401 });
      return new Response(JSON.stringify({ data: [{ id: 'claude-model' }] }), { status: 200 });
    };

    const models = await fetchModels({
      apiUrl: 'https://api.anthropic.com',
      apiKey: 'secret-key',
      apiProtocol: 'anthropic',
    });

    assert.deepStrictEqual(models, [{ id: 'claude-model', ownedBy: null }]);
    assert.strictEqual(headers[0]['x-api-key'], 'secret-key');
    assert.strictEqual(headers[1].Authorization, 'Bearer secret-key');
  });

  test('reports missing API key before making a request', async () => {
    await assert.rejects(
      () => fetchModels({ apiUrl: 'https://api.example.com', apiKey: '' }),
      /API Key is required/,
    );
  });
});
