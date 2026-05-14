import { describe, test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { createSpeechGateway } from '../../gateway/speech.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';

describe('Speech Gateway API', () => {
  test('POST /speech/tts 应返回音频二进制和 provider 元数据头', async () => {
    const app = Fastify();
    const originalGetUserFromToken = authService.getUserFromToken;

    authService.getUserFromToken = async () => ({
      id: 'test-user-id',
      username: 'tester',
      avatar: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await app.register(createSpeechGateway({
      execute: async () => ({
        kind: 'audio',
        provider: 'openai-compatible-tts',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        mimeType: 'audio/mpeg',
        audioBuffer: Buffer.from([1, 2, 3]),
      }),
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/speech/tts',
      headers: {
        authorization: 'Bearer test-token',
      },
      payload: {
        type: 'tts',
        profile: {
          provider: 'openai-compatible-tts',
        },
        input: {
          text: '你好',
        },
      },
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['content-type'], 'audio/mpeg');
    assert.strictEqual(response.headers['x-speech-provider'], 'openai-compatible-tts');
    assert.strictEqual(response.headers['x-speech-model'], 'gpt-4o-mini-tts');
    assert.strictEqual(response.headers['x-speech-voice'], 'alloy');
    assert.deepStrictEqual(response.rawPayload, Buffer.from([1, 2, 3]));

    authService.getUserFromToken = originalGetUserFromToken;
    await app.close();
  });
});
