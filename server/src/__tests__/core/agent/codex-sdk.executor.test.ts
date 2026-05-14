import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildCodexModelProviderConfig } from '../../../core/agent/codex-sdk.executor.js';

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    name: 'Codex Gateway',
    type: 'custom',
    apiProtocol: 'openai',
    apiUrl: 'https://dm-fox.rjj.cc/codex/v1/',
    apiKey: 'test-key',
    model: 'gpt-5.4',
    supportsThinking: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    ...overrides,
  } as any;
}

describe('Codex SDK Executor provider config', () => {
  test('自定义 OpenAI 网关禁用 Responses WebSocket', () => {
    const config = buildCodexModelProviderConfig(provider());

    assert.strictEqual(config.model, 'gpt-5.4');
    assert.strictEqual(config.model_provider, 'teamagentx_openai');

    const providers = config.model_providers as Record<string, any>;
    assert.strictEqual(providers.teamagentx_openai.base_url, 'https://dm-fox.rjj.cc/codex/v1');
    assert.strictEqual(providers.teamagentx_openai.wire_api, 'responses');
    assert.strictEqual(providers.teamagentx_openai.supports_websockets, false);
    assert.strictEqual(providers.teamagentx_openai.env_key, 'CODEX_API_KEY');
  });

  test('未配置 apiUrl 时继续使用内置 openai provider', () => {
    const config = buildCodexModelProviderConfig(provider({ apiUrl: '' }));

    assert.deepStrictEqual(config, {
      model: 'gpt-5.4',
      model_provider: 'openai',
    });
  });
});
