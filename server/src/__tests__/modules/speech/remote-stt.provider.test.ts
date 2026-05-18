import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import type { LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { createRemoteSttProvider } from '../../../modules/speech/providers/remote-stt.provider.js';

const originalFetch = globalThis.fetch;
const originalFindUnique = prisma.llmProvider.findUnique;
const originalFindFirst = prisma.llmProvider.findFirst;

function createOpenAiProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'provider-openai-stt',
    name: 'OpenAI Compatible STT',
    type: 'custom',
    apiProtocol: 'openai',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'whisper-1',
    sttModel: 'FunAudioLLM/SenseVoiceSmall',
    modelType: 'audio',
    imageProvider: null,
    imageApiType: null,
    supportsThinking: null,
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
  prisma.llmProvider.findUnique = originalFindUnique;
  prisma.llmProvider.findFirst = originalFindFirst;
});

describe('openai-compatible-stt provider', () => {
  test('应调用 multipart transcriptions 接口并返回 transcript', async () => {
    globalThis.fetch = async (input, init) => {
      assert.strictEqual(input, 'https://api.example.com/v1/audio/transcriptions');
      assert.ok(init);
      assert.strictEqual(init.method, 'POST');
      assert.strictEqual((init.headers as Record<string, string>).Authorization, 'Bearer test-key');
      assert.ok(init.body instanceof FormData);

      const body = init.body as FormData;
      assert.strictEqual(body.get('model'), 'FunAudioLLM/SenseVoiceSmall');
      assert.strictEqual(body.get('response_format'), 'json');

      const file = body.get('file');
      assert.ok(file instanceof Blob);

      return new Response(JSON.stringify({ text: '你好，世界' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      });
    };

    prisma.llmProvider.findUnique = ((async () => createOpenAiProvider()) as unknown) as typeof prisma.llmProvider.findUnique;

    const provider = createRemoteSttProvider();
    const result = await provider.transcribe?.({
      type: 'stt',
      input: {
        audioBuffer: Buffer.from([1, 2, 3, 4]),
        mimeType: 'audio/wav',
      },
      profile: {
        provider: 'openai-compatible-stt',
        model: 'FunAudioLLM/SenseVoiceSmall',
        vendorOptions: {
          llmProviderId: 'provider-openai-stt',
        },
      },
      context: {},
    });

    assert.ok(result);
    assert.strictEqual(result?.kind, 'transcript');
    assert.strictEqual(result?.provider, 'openai-compatible-stt');
    assert.strictEqual(result?.model, 'FunAudioLLM/SenseVoiceSmall');
    assert.strictEqual(result?.text, '你好，世界');
  });
});
