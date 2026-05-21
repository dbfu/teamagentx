import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import type { LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import { llmProviderService, parseAiConfigResponse } from '../../../modules/llm-provider/llm-provider.service.js';

const originalCount = prisma.llmProvider.count;
const originalUpdateMany = prisma.llmProvider.updateMany;
const originalCreate = prisma.llmProvider.create;
const originalFindUnique = prisma.llmProvider.findUnique;
const originalUpdate = prisma.llmProvider.update;

function createAudioProvider(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'audio-provider',
    name: 'Audio Provider',
    type: 'custom',
    modelType: 'audio',
    apiProtocol: 'openai',
    apiUrl: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4o-mini-tts',
    sttModel: 'whisper-1',
    audioUsage: 'both',
    imageProvider: null,
    imageApiType: null,
    supportsThinking: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    updatedAt: new Date('2026-05-18T00:00:00.000Z'),
    ...overrides,
  };
}

afterEach(() => {
  prisma.llmProvider.count = originalCount;
  prisma.llmProvider.updateMany = originalUpdateMany;
  prisma.llmProvider.create = originalCreate;
  prisma.llmProvider.findUnique = originalFindUnique;
  prisma.llmProvider.update = originalUpdate;
});

describe('llmProviderService audio defaults', () => {
  test('创建 tts-only 语音模型时应忽略 isDefault', async () => {
    let updateManyCalled = false;
    let createdPayload: Record<string, unknown> | null = null;

    prisma.llmProvider.count = (async () => 2) as typeof prisma.llmProvider.count;
    prisma.llmProvider.updateMany = (async () => {
      updateManyCalled = true;
      return { count: 0 };
    }) as typeof prisma.llmProvider.updateMany;
    prisma.llmProvider.create = (async ({ data }) => {
      createdPayload = data as Record<string, unknown>;
      return createAudioProvider(data as Partial<LlmProvider>);
    }) as typeof prisma.llmProvider.create;

    const provider = await llmProviderService.create({
      name: 'TTS Only',
      modelType: 'audio',
      apiProtocol: 'openai',
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini-tts',
      audioUsage: 'tts',
      isDefault: true,
    });

    assert.strictEqual(updateManyCalled, false);
    assert.ok(createdPayload);
    const payload = createdPayload as Record<string, unknown>;
    assert.strictEqual(payload.isDefault, false);
    assert.strictEqual(provider.isDefault, false);
  });

  test('设为默认时应拒绝 tts-only 语音模型', async () => {
    prisma.llmProvider.findUnique = ((async () => createAudioProvider({
      id: 'tts-only',
      audioUsage: 'tts',
    })) as unknown) as typeof prisma.llmProvider.findUnique;

    await assert.rejects(
      llmProviderService.setDefault('tts-only'),
      /仅支持将 STT 或 TTS \+ STT 语音模型设为默认 STT/,
    );
  });
});

describe('parseAiConfigResponse', () => {
  test('应从带说明文字的 JSON 中保留可解析字段', () => {
    const result = parseAiConfigResponse(`解析结果如下：
{
  "name": "byteplan-glm-token11",
  "apiUrl": "https://coding.dashscope.aliyuncs.com/apps/anthropic",
  "apiKey": "sk-test-key",
  "model": "glm-5",
  "apiProtocol": null
}
请确认`);

    assert.deepStrictEqual(result, {
      name: 'byteplan-glm-token11',
      apiUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      apiKey: 'sk-test-key',
      model: 'glm-5',
      apiProtocol: null,
    });
  });

  test('JSON 解析失败时应从 AI 的 key-value 输出中保留部分字段', () => {
    const result = parseAiConfigResponse(`name: byteplan-glm-token11
apiUrl: https://coding.dashscope.aliyuncs.com/apps/anthropic
apiKey: sk-test-key
model: glm-5
apiProtocol: anthropic`);

    assert.deepStrictEqual(result, {
      name: 'byteplan-glm-token11',
      apiUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      apiKey: 'sk-test-key',
      model: 'glm-5',
      apiProtocol: 'anthropic',
    });
  });
});
