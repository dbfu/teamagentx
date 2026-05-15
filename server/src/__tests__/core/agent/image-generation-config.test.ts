import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildImageGenerationEnv, getImageGenerationSkillInstructions } from '../../../core/agent/image-generation-config.js';

function imageProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'image-provider-1',
    name: 'Image Provider',
    type: 'custom',
    modelType: 'image',
    apiProtocol: 'openai',
    apiUrl: 'https://image.example.com/v1',
    apiKey: 'image-key',
    model: 'image-model',
    imageProvider: 'openai',
    imageApiType: 'sync',
    supportsThinking: null,
    isActive: true,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    ...overrides,
  } as any;
}

describe('Image generation config', () => {
  test('图片模型映射为脚本可读取的安全环境变量', () => {
    const env = buildImageGenerationEnv(imageProvider(), {
      outputDir: '/tmp/teamagentx-images',
      urlPrefix: '/uploads/images',
    });

    assert.deepStrictEqual(env, {
      IMAGE_GEN_API_KEY: 'image-key',
      IMAGE_GEN_BASE_URL: 'https://image.example.com/v1',
      IMAGE_GEN_MODEL: 'image-model',
      IMAGE_GEN_PROVIDER: 'openai',
      IMAGE_GEN_API_TYPE: 'sync',
      TEAMAGENTX_IMAGE_OUTPUT_DIR: '/tmp/teamagentx-images',
      TEAMAGENTX_IMAGE_URL_PREFIX: '/uploads/images',
    });
  });

  test('未配置图片模型时返回空环境并提示需要配置', () => {
    assert.deepStrictEqual(buildImageGenerationEnv(null), {});
    assert.match(getImageGenerationSkillInstructions(null), /未开启图片生成能力/);
  });

  test('图片技能说明包含当前供应商文档和参数指导', () => {
    const instructions = getImageGenerationSkillInstructions(imageProvider({
      model: 'google/gemini-3.1-flash-image-preview',
      imageProvider: 'openrouter',
      apiUrl: 'https://openrouter.ai/api/v1',
    }));

    assert.match(instructions, /当前供应商参数手册/);
    assert.match(instructions, /openrouter\.ai\/docs\/guides\/overview\/multimodal\/image-generation/);
    assert.match(instructions, /extraJson\.image_config/i);
    assert.match(instructions, /语义化尺寸/);
  });
});
