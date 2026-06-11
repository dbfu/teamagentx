import { describe, test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { createSpeechGateway } from '../../gateway/speech.gateway.js';
import { authService } from '../../modules/auth/auth.service.js';
import prisma from '../../lib/prisma.js';
import { clearBrowserLocalVoiceSnapshots } from '../../modules/speech/voice-catalog.js';

describe('Speech Gateway API', () => {
  test('POST /speech/tts 应返回音频二进制和 provider 元数据头', async () => {
    const app = Fastify();
    const originalGetUserFromToken = authService.getUserFromToken;

    authService.getUserFromToken = async () => ({
      id: 'test-user-id',
      username: 'tester',
      avatar: null,
      preferredLanguage: 'zh-CN',
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

  test('POST /speech/catalog/browser-local and GET /speech/catalog 应返回当前用户的本地音色和远程目录', async () => {
    const app = Fastify();
    const originalGetUserFromToken = authService.getUserFromToken;
    clearBrowserLocalVoiceSnapshots();

    const createdProvider = await prisma.llmProvider.create({
      data: {
        name: 'Speech Gateway Test Audio',
        type: 'custom',
        modelType: 'audio',
        apiProtocol: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        model: 'gpt-4o-mini-tts',
        audioUsage: 'tts',
        isActive: true,
      },
    });

    authService.getUserFromToken = async () => ({
      id: 'speech-gateway-test-user',
      username: 'tester',
      avatar: null,
      preferredLanguage: 'zh-CN',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await app.register(createSpeechGateway({
      execute: async () => ({
        kind: 'audio',
        provider: 'openai-compatible-tts',
        mimeType: 'audio/mpeg',
        audioBuffer: Buffer.from([1]),
      }),
    }));

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/speech/catalog/browser-local',
      headers: {
        authorization: 'Bearer test-token',
        'x-browser-client-id': 'client-a',
      },
      payload: {
        voices: [
          {
            id: 'voice-1',
            name: 'Local Voice',
            lang: 'zh-CN',
            voiceURI: 'voice-1',
            default: true,
          },
        ],
      },
    });

    assert.strictEqual(syncResponse.statusCode, 200);

    const catalogResponse = await app.inject({
      method: 'GET',
      url: '/speech/catalog',
      headers: {
        authorization: 'Bearer test-token',
        'x-browser-client-id': 'client-a',
      },
    });

    assert.strictEqual(catalogResponse.statusCode, 200);
    const body = catalogResponse.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.browserLocal.provider, 'browser-local');
    assert.strictEqual(body.data.browserLocal.voices.length, 1);
    assert.strictEqual(body.data.browserLocal.voices[0].name, 'Local Voice');
    assert.ok(Array.isArray(body.data.remoteProviders));
    assert.ok(body.data.remoteProviders.some((item: { llmProviderId: string }) => item.llmProviderId === createdProvider.id));

    await prisma.llmProvider.delete({ where: { id: createdProvider.id } });
    authService.getUserFromToken = originalGetUserFromToken;
    clearBrowserLocalVoiceSnapshots();
    await app.close();
  });

  test('GET /speech/catalog 不应返回其他客户端的本地音色快照', async () => {
    const app = Fastify();
    const originalGetUserFromToken = authService.getUserFromToken;
    clearBrowserLocalVoiceSnapshots();

    authService.getUserFromToken = async () => ({
      id: 'speech-gateway-test-user',
      username: 'tester',
      avatar: null,
      preferredLanguage: 'zh-CN',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await app.register(createSpeechGateway({
      execute: async () => ({
        kind: 'audio',
        provider: 'openai-compatible-tts',
        mimeType: 'audio/mpeg',
        audioBuffer: Buffer.from([1]),
      }),
    }));

    const syncResponse = await app.inject({
      method: 'POST',
      url: '/speech/catalog/browser-local',
      headers: {
        authorization: 'Bearer test-token',
        'x-browser-client-id': 'client-a',
      },
      payload: {
        voices: [
          {
            id: 'voice-1',
            name: 'Local Voice',
            lang: 'zh-CN',
            voiceURI: 'voice-1',
            default: true,
          },
        ],
      },
    });

    assert.strictEqual(syncResponse.statusCode, 200);

    const otherClientResponse = await app.inject({
      method: 'GET',
      url: '/speech/catalog',
      headers: {
        authorization: 'Bearer test-token',
        'x-browser-client-id': 'client-b',
      },
    });

    assert.strictEqual(otherClientResponse.statusCode, 200);
    const body = otherClientResponse.json();
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(body.data.browserLocal.voices, []);

    authService.getUserFromToken = originalGetUserFromToken;
    clearBrowserLocalVoiceSnapshots();
    await app.close();
  });
});
