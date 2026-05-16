import type { LlmProvider } from '@prisma/client';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { uploadService } from '../../modules/upload/upload.service.js';
import { getImageProviderProfile } from './image-generation-provider-profiles.js';

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
    return '';
  }

  const providerName = String((provider as any).imageProvider || provider.type || 'custom');
  const apiType = String((provider as any).imageApiType || 'sync');
  const profile = getImageProviderProfile(providerName, provider.model);
  const docs = profile.docs.length > 0
    ? profile.docs.map((url) => `- ${url}`).join('\n')
    : '- 当前供应商没有单独维护的参考链接，请优先使用最保守的 size / n / extraJson。';
  const sizeGuidance = profile.sizeGuidance.map((item) => `- ${item}`).join('\n');
  const extraFieldGuidance = profile.extraFieldGuidance.map((item) => `- ${item}`).join('\n');
  const examples = profile.examples.map((item) => `- ${item}`).join('\n');

  return `## 图片生成能力
当前助手已开启图片生成能力，可在用户要求生成图片、海报、插画、产品图、视觉稿时使用。

### 当前图片模型
- 配置名称：${provider.name}
- 模型 ID：${provider.model}
- 供应商类型：${providerName}
- 调用方式：${apiType}
- API Base URL：${provider.apiUrl || '(未配置，自带默认值)'}

### 当前供应商参数手册
${profile.summary}

参考文档：
${docs}

尺寸规则：
${sizeGuidance}

额外参数规则：
${extraFieldGuidance}

常见映射示例：
${examples}

### 调用规则
- 必须通过 TeamAgentX 受控工具生成图片：Claude 工具名为 \`mcp__tax__generate_image\`，Codex/ACP 工具名为 \`tax.generate_image\` 或 \`generate_image\`。
- 不要自己读取、要求或输出 API Key；模型密钥只保存在 TeamAgentX 服务端。
- 用户如果只给了语义化尺寸，比如“竖版海报”“横版 banner”“方形头像”，你应该先结合当前供应商手册，把它翻译成合适的 \`size\` 和必要的 \`extraJson\`，再调用工具。
- 只有在当前供应商文档明确支持时，才传 \`extraJson\` 字段；不要臆造字段名。
- 工具成功后读取 \`urls\` 字段，并在回复中使用 Markdown 图片语法返回给用户，例如：\`![生成图片](/uploads/images/example.png)\`。
- **工具调用失败时，禁止自动重试**：不要再次调用 \`generate_image\`/\`mcp__tax__generate_image\`，无论错误是网络、超时、HTTP 4xx/5xx、任务失败还是任何其他原因。把错误信息原样转述给用户，并简要给出可以调整的提示词、尺寸、数量或模型配置建议，由用户决定是否重新发起请求。`;
}
