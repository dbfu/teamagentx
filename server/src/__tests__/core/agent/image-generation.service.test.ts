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
