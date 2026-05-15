import type { LlmProvider } from '@prisma/client';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { uploadService } from '../../modules/upload/upload.service.js';

export type ImageGenerationProvider = LlmProvider | null | undefined;

export interface ImageGenerationEnvOptions {
  outputDir?: string;
  urlPrefix?: string;
}

const BUILTIN_IMAGE_SKILL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'builtin-skills',
  'image-generation-sdk',
);

export function getBuiltinImageGenerationSkillDir(): string {
  return BUILTIN_IMAGE_SKILL_DIR;
}

export function buildImageGenerationEnv(
  provider: ImageGenerationProvider,
  options: ImageGenerationEnvOptions = {},
): Record<string, string> {
  if (!provider) return {};

  const outputDir = options.outputDir || uploadService.getImageUploadDir();
  const urlPrefix = options.urlPrefix || uploadService.getImageUrlPrefix();
  const imageProvider = String((provider as any).imageProvider || provider.type || 'custom');
  const imageApiType = String((provider as any).imageApiType || 'sync');
  const env: Record<string, string> = {
    IMAGE_GEN_API_KEY: provider.apiKey,
    IMAGE_GEN_MODEL: provider.model,
    IMAGE_GEN_PROVIDER: imageProvider,
    IMAGE_GEN_API_TYPE: imageApiType,
    TEAMAGENTX_IMAGE_OUTPUT_DIR: outputDir,
    TEAMAGENTX_IMAGE_URL_PREFIX: urlPrefix,
  };

  if (provider.apiUrl) {
    env.IMAGE_GEN_BASE_URL = provider.apiUrl;
  }

  return env;
}

export function getImageGenerationSkillInstructions(provider: ImageGenerationProvider): string {
  if (!provider) {
    return `## 图片生成能力
当前助手未开启图片生成能力或未绑定图片模型。用户要求生成图片时，先说明需要在助手配置中开启图片生成能力并选择图片模型。不要猜测 API Key、Base URL 或模型 ID。`;
  }

  const providerName = String((provider as any).imageProvider || provider.type || 'custom');
  const apiType = String((provider as any).imageApiType || 'sync');

  return `## 图片生成能力
当前助手已开启图片生成能力，可在用户要求生成图片、海报、插画、产品图、视觉稿时使用。

### 当前图片模型
- 配置名称：${provider.name}
- 模型 ID：${provider.model}
- 供应商类型：${providerName}
- 调用方式：${apiType}

### 调用规则
- 必须通过 TeamAgentX 受控工具生成图片：Claude 工具名为 \`mcp__tax__generate_image\`，Codex/ACP 工具名为 \`tax.generate_image\` 或 \`generate_image\`。
- 不要自己读取、要求或输出 API Key；模型密钥只保存在 TeamAgentX 服务端。
- 工具成功后读取 \`urls\` 字段，并在回复中使用 Markdown 图片语法返回给用户，例如：\`![生成图片](/uploads/images/example.png)\`。
- **工具调用失败时，禁止自动重试**：不要再次调用 \`generate_image\`/\`mcp__tax__generate_image\`，无论错误是网络、超时、HTTP 4xx/5xx、任务失败还是任何其他原因。把错误信息原样转述给用户，并简要给出可以调整的提示词、尺寸、数量或模型配置建议，由用户决定是否重新发起请求。`;
}
