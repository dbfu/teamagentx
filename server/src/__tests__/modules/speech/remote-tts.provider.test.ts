import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import type { LlmProvider } from '@prisma/client';
import { createRemoteTtsProvider } from '../../../modules/speech/providers/remote-tts.provider.js';

const originalFetch = globalThis.fetch;

function createOpenAiProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'provider-openai',
    name: 'OpenAI Compatible TTS',
    type: 'custom',
    apiProtocol: 'openai',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o-mini-tts',
    modelType: 'audio',
    imageProvider: null,
    imageApiType: null,
    supportsThinking: null,
    sttModel: null,
    audioUsage: 'both',
    isActive: true,
    isDefault: true,
    createdAt: new Date('2026-05-13T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('openai-compatible-tts provider', () => {
  test('应调用 openai-compatible audio speech 接口并返回 data url', async () => {
    globalThis.fetch = async (input, init) => {
      assert.strictEqual(input, 'https://api.example.com/v1/audio/speech');
      assert.ok(init);
      assert.strictEqual(init.method, 'POST');
      assert.strictEqual((init.headers as Record<string, string>).Authorization, 'Bearer test-key');

      const body = JSON.parse(String(init.body));
      assert.deepStrictEqual(body, {
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        input: '你好，世界',
        response_format: 'mp3',
        speed: 1.1,
      });

      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
        },
      });
    };

    const provider = createRemoteTtsProvider({
      resolveLlmProvider: async () => createOpenAiProvider(),
    });

    const result = await provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'openai-compatible-tts',
        voice: 'alloy',
        format: 'mp3',
        speed: 1.1,
      },
      input: {
        text: '你好，世界',
      },
    });

    assert.ok(result);
    assert.strictEqual(result?.kind, 'audio');
    assert.strictEqual(result?.provider, 'openai-compatible-tts');
    assert.strictEqual(result?.model, 'gpt-4o-mini-tts');
    assert.strictEqual(result?.voice, 'alloy');
    assert.strictEqual(result?.mimeType, 'audio/mpeg');
    assert.ok(result?.audioBuffer);
    assert.strictEqual(result?.audioBuffer?.toString('base64'), 'AQIDBA==');
  });

  test('应拒绝非 openai 协议的模型供应商', async () => {
    const provider = createRemoteTtsProvider({
      resolveLlmProvider: async () => createOpenAiProvider({ apiProtocol: 'anthropic' }),
    });

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: {
          provider: 'openai-compatible-tts',
        },
        input: {
          text: '你好',
        },
      }) ?? Promise.reject(new Error('provider missing')),
      /仅支持 openai 协议/,
    );
  });

  test('应为 SiliconFlow 裸音色值补全模型前缀', async () => {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.strictEqual(body.model, 'FunAudioLLM/CosyVoice2-0.5B');
      assert.strictEqual(body.voice, 'FunAudioLLM/CosyVoice2-0.5B:diana');

      return new Response(new Uint8Array([5, 6, 7]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
        },
      });
    };

    const provider = createRemoteTtsProvider({
      resolveLlmProvider: async () => createOpenAiProvider({
        apiUrl: 'https://api.siliconflow.cn/v1',
        model: 'FunAudioLLM/CosyVoice2-0.5B',
      }),
    });

    const result = await provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'openai-compatible-tts',
        voice: 'diana',
        format: 'mp3',
      },
      input: {
        text: 'Hello world',
      },
    });

    assert.ok(result);
    assert.strictEqual(result?.voice, 'FunAudioLLM/CosyVoice2-0.5B:diana');
  });
});
