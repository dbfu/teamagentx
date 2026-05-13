import { describe, test } from 'node:test';
import assert from 'node:assert';
import { generateImageWithProvider } from '../../../core/agent/image-generation.service.js';

function imageProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'image-provider-1',
    name: 'Image Provider',
    type: 'custom',
    modelType: 'image',
    apiProtocol: 'openai',
    apiUrl: 'https://image.example.com/v1',
    apiKey: 'secret-image-key',
    model: 'image-model',
    imageProvider: 'openai',
    imageApiType: 'sync',
    supportsThinking: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    ...overrides,
  } as any;
}

describe('Image generation service', () => {
  test('服务端子进程使用图片模型密钥，但返回结果不泄露密钥', async () => {
    let capturedEnv: Record<string, string | undefined> = {};
    const result = await generateImageWithProvider(
      imageProvider(),
      { prompt: 'a blue product photo', size: '1024x1024', n: 1 },
      {
        execFile: async (_file, _args, options) => {
          capturedEnv = options.env || {};
          return {
            stdout: JSON.stringify({
              success: true,
              files: ['/tmp/teamagentx/image_001.png'],
              urls: ['/uploads/images/image_001.png'],
              provider: 'openai/image-model',
              mode: 'sync',
            }),
            stderr: '',
          };
        },
      },
    );

    assert.strictEqual(capturedEnv.IMAGE_GEN_API_KEY, 'secret-image-key');
    assert.strictEqual(capturedEnv.IMAGE_GEN_MODEL, 'image-model');
    assert.deepStrictEqual(result.urls, ['/uploads/images/image_001.png']);
    assert.doesNotMatch(JSON.stringify(result), /secret-image-key/);
  });

  test('图片模型未激活时拒绝调用', async () => {
    await assert.rejects(
      () => generateImageWithProvider(
        imageProvider({ isActive: false }),
        { prompt: 'a blue product photo' },
        {
          execFile: async () => ({ stdout: '{}', stderr: '' }),
        },
      ),
      /图片模型未启用/,
    );
  });
});
