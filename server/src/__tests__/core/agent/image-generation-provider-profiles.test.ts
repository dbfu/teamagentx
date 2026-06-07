import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getImageProviderProfile, normalizeImageRequestParams } from '../../../core/agent/image-generation-provider-profiles.js';

describe('Image generation provider profiles', () => {
  test('openrouter 像素尺寸会归一化到 image_config', () => {
    const result = normalizeImageRequestParams('openrouter', '1024x1792', {});

    assert.strictEqual(result.size, '1024x1792');
    assert.deepStrictEqual(result.extraJson, {
      image_config: {
        aspect_ratio: '9:16',
        image_size: '2K',
      },
    });
  });

  test('openai 比例字符串会归一化到像素尺寸', () => {
    const result = normalizeImageRequestParams('openai', '16:9', {});

    assert.strictEqual(result.size, '1536x1024');
    assert.deepStrictEqual(result.extraJson, {});
  });

  test('apimart 语义化海报尺寸会归一化到比例和分辨率', () => {
    const result = normalizeImageRequestParams('apimart', 'poster', {});

    assert.strictEqual(result.size, '2:3');
    assert.deepStrictEqual(result.extraJson, {});
  });

  test('bailian 比例字符串会归一化到宽高星号尺寸', () => {
    const result = normalizeImageRequestParams('bailian', '16:9', {});

    assert.strictEqual(result.size, '1696*960');
    assert.deepStrictEqual(result.extraJson, {});
  });

  test('xai 语义尺寸会归一化到 aspect_ratio 和 resolution', () => {
    const result = normalizeImageRequestParams('xai', '2048x2048', {});

    assert.strictEqual(result.size, '2048x2048');
    assert.deepStrictEqual(result.extraJson, {
      aspect_ratio: '1:1',
      resolution: '2k',
    });
  });

  test('gemini 配置文件包含官方文档和语义尺寸说明', () => {
    const profile = getImageProviderProfile('gemini', 'imagen-4.0-generate-001');

    assert.match(profile.summary, /aspectRatio/i);
    assert.ok(profile.docs.some((url) => url.includes('ai.google.dev')));
    assert.ok(profile.examples.some((item) => item.includes('imageSize')));
  });

  test('xai 配置文件包含官方模型文档', () => {
    const profile = getImageProviderProfile('xai', 'grok-imagine-image-quality');

    assert.ok(profile.docs.some((url) => url.includes('docs.x.ai')));
    assert.match(profile.summary, /grok-imagine-image-quality/);
  });
});
