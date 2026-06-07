import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { generateImageWithProvider } from '../../../core/agent/image-generation.service.js';

const tmpDir = path.join(tmpdir(), 'teamagentx-test-images');

// Minimal 1x1 PNG buffer
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
    '2e00000000c4944415478016360f8cfc00000000200016a35a7a0000000049454e44ae426082',
  'hex',
);

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

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = (url: string, init: RequestInit) => Promise.resolve(handler(url, init));
  return () => { globalThis.fetch = original; };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function imageUrlResponse(): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

before(async () => {
  await mkdir(tmpDir, { recursive: true });
});

describe('Image generation service', () => {
  test('sync 模式：成功调用 API 并返回结果', async () => {
    let capturedAuth = '';
    let capturedBody: any = null;

    const restore = mockFetch((url, init) => {
      if (url.includes('/images/generations')) {
        capturedAuth = (init.headers as any)?.authorization || '';
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse({ data: [{ url: 'https://cdn.example.com/img.png' }] });
      }
      // download image
      return imageUrlResponse();
    });

    try {
      const provider = imageProvider({ imageApiType: 'sync' });
      // override output dir to a writable tmp path
      const result = await generateImageWithProvider(provider, {
        prompt: 'a blue product photo',
        size: '1024x1024',
        n: 1,
        filename: 'test.png',
      });

      assert.strictEqual(capturedAuth, 'Bearer secret-image-key', 'API key must be sent in Authorization header');
      assert.strictEqual(capturedBody?.model, 'image-model');
      assert.strictEqual(capturedBody?.prompt, 'a blue product photo');
      assert.ok(Array.isArray(result.files) && result.files.length > 0);
      assert.ok(Array.isArray(result.urls) && result.urls.length > 0);
      assert.doesNotMatch(JSON.stringify(result), /secret-image-key/, 'API key must not leak into result');
    } finally {
      restore();
    }
  });

  test('openai gpt-image 模式：保留 size，但去掉不支持的 response_format，并处理 b64_json 响应', async () => {
    let capturedBody: any = null;

    const restore = mockFetch((url, init) => {
      if (url.includes('/images/generations')) {
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });

    try {
      const provider = imageProvider({
        imageProvider: 'openai',
        apiUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1',
      });
      const result = await generateImageWithProvider(provider, {
        prompt: 'a hero banner illustration',
        size: '16:9',
        n: 1,
        extraJson: {
          response_format: 'url',
          quality: 'high',
        },
      });

      assert.strictEqual(capturedBody.size, '1536x1024');
      assert.strictEqual(capturedBody.quality, 'high');
      assert.strictEqual('response_format' in capturedBody, false);
      assert.ok(result.files.length > 0, 'expected at least one materialized image file');
    } finally {
      restore();
    }
  });

  test('async 模式：提交任务后轮询直到完成', async () => {
    let pollCount = 0;

    const restore = mockFetch((url, init) => {
      if ((init.method || 'GET') === 'POST' && url.includes('/images/generations')) {
        return jsonResponse({ task_id: 'task-abc-123', status: 'pending' });
      }
      if (url.includes('/tasks/task-abc-123')) {
        pollCount++;
        if (pollCount < 2) {
          return jsonResponse({ task_id: 'task-abc-123', status: 'processing' });
        }
        return jsonResponse({ task_id: 'task-abc-123', status: 'completed', data: [{ url: 'https://cdn.example.com/img.png' }] });
      }
      return imageUrlResponse();
    });

    try {
      const provider = imageProvider({ imageApiType: 'async' });
      const result = await generateImageWithProvider(provider, {
        prompt: 'a red poster',
        n: 1,
      });

      assert.ok(pollCount >= 2, 'should have polled at least twice');
      assert.ok(result.files.length > 0);
      assert.strictEqual(result.mode, 'async');
    } finally {
      restore();
    }
  });

  test('openrouter 模式：通过 chat completions 接口生成图片，并从 message.images 提取 data URL', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    const pngBase64 = PNG_BYTES.toString('base64');

    const restore = mockFetch((url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'here is your image',
              images: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${pngBase64}` } },
              ],
            },
          },
        ],
      });
    });

    try {
      const provider = imageProvider({
        imageProvider: 'openrouter',
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'google/gemini-2.5-flash-image',
      });
      const result = await generateImageWithProvider(provider, {
        prompt: 'a cute corgi',
        size: '16:9',
        n: 1,
      });

      assert.strictEqual(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
      assert.strictEqual(capturedBody.model, 'google/gemini-2.5-flash-image');
      assert.deepStrictEqual(capturedBody.modalities, ['image', 'text']);
      assert.deepStrictEqual(capturedBody.image_config, {
        aspect_ratio: '16:9',
      });
      assert.strictEqual(capturedBody.messages?.[0]?.role, 'user');
      assert.strictEqual(capturedBody.messages?.[0]?.content, 'a cute corgi');
      assert.ok(result.files.length > 0, 'expected at least one materialized image file');
    } finally {
      restore();
    }
  });

  test('openrouter image-only 模型：仅请求 image modality', async () => {
    let capturedBody: any = null;
    const pngBase64 = PNG_BYTES.toString('base64');

    const restore = mockFetch((_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              images: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${pngBase64}` } },
              ],
            },
          },
        ],
      });
    });

    try {
      const provider = imageProvider({
        imageProvider: 'openrouter',
        apiUrl: 'https://openrouter.ai/api/v1',
        model: 'black-forest-labs/flux.2-pro',
      });
      const result = await generateImageWithProvider(provider, {
        prompt: 'a cinematic skyline',
        n: 1,
      });

      assert.deepStrictEqual(capturedBody.modalities, ['image']);
      assert.ok(result.files.length > 0, 'expected at least one materialized image file');
    } finally {
      restore();
    }
  });

  test('openrouter 模型不支持图片输出时，抛出可操作的错误提示', async () => {
    const restore = mockFetch(() =>
      new Response(JSON.stringify({
        error: {
          message: 'No endpoints found that support the requested output modalities: image, text',
          code: 404,
        },
      }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    try {
      await assert.rejects(
        () => generateImageWithProvider(imageProvider({
          imageProvider: 'openrouter',
          apiUrl: 'https://openrouter.ai/api/v1',
          model: 'google/gemini-3-flash-preview',
        }), { prompt: 'test' }),
        /不是图片生成模型/,
      );
    } finally {
      restore();
    }
  });

  test('bailian sync 模式：使用万相请求体并从 output.choices 提取图片', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const restore = mockFetch((url, init) => {
      if (url.includes('/multimodal-generation/generation')) {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse({
          output: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: [
                    { type: 'image', image: 'https://cdn.example.com/bailian.png' },
                  ],
                },
              },
            ],
          },
        });
      }
      return imageUrlResponse();
    });

    try {
      const provider = imageProvider({
        imageProvider: 'bailian',
        apiUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
        model: 'wan2.6-t2i',
      });
      const result = await generateImageWithProvider(provider, {
        prompt: '一个春日咖啡馆海报',
        size: '16:9',
        n: 1,
        extraJson: { watermark: false },
      });

      assert.strictEqual(capturedUrl, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
      assert.strictEqual(capturedBody.model, 'wan2.6-t2i');
      assert.strictEqual(capturedBody.input.messages[0].content[0].text, '一个春日咖啡馆海报');
      assert.deepStrictEqual(capturedBody.parameters, {
        n: 1,
        size: '1696*960',
        watermark: false,
      });
      assert.ok(result.files.length > 0, 'expected at least one materialized image file');
    } finally {
      restore();
    }
  });

  test('xai 模式：通过 extraJson 传 aspect_ratio 和 resolution', async () => {
    let capturedBody: any = null;

    const restore = mockFetch((url, init) => {
      if (url.includes('/images/generations')) {
        capturedBody = JSON.parse(init.body as string);
        return jsonResponse({ data: [{ url: 'https://cdn.example.com/xai.png' }] });
      }
      return imageUrlResponse();
    });

    try {
      const provider = imageProvider({
        imageProvider: 'xai',
        apiUrl: 'https://api.x.ai/v1',
        model: 'grok-imagine-image-quality',
      });
      const result = await generateImageWithProvider(provider, {
        prompt: '一个未来感城市横版头图',
        size: '2048x2048',
        n: 1,
      });

      assert.strictEqual('size' in capturedBody, false);
      assert.strictEqual(capturedBody.aspect_ratio, '1:1');
      assert.strictEqual(capturedBody.resolution, '2k');
      assert.ok(result.files.length > 0, 'expected at least one materialized image file');
    } finally {
      restore();
    }
  });

  test('图片模型未激活时拒绝调用', async () => {
    await assert.rejects(
      () => generateImageWithProvider(imageProvider({ isActive: false }), { prompt: 'test' }),
      /图片模型未启用/,
    );
  });

  test('modelType 不是 image 时拒绝调用', async () => {
    await assert.rejects(
      () => generateImageWithProvider(imageProvider({ modelType: 'text' }), { prompt: 'test' }),
      /所选模型不是图片模型/,
    );
  });

  test('提示词为空时拒绝调用', async () => {
    await assert.rejects(
      () => generateImageWithProvider(imageProvider(), { prompt: '   ' }),
      /提示词不能为空/,
    );
  });

  test('API 返回错误状态码时抛出可读错误', async () => {
    const restore = mockFetch(() =>
      new Response(JSON.stringify({ error: { message: 'invalid_api_key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    try {
      await assert.rejects(
        () => generateImageWithProvider(imageProvider(), { prompt: 'test' }),
        /HTTP 401/,
      );
    } finally {
      restore();
    }
  });
});
