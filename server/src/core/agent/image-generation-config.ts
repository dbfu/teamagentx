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
  '..',
  '..',
  '..',
  'preinstalled-skills',
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
    : '- This provider has no separately maintained reference links. Prefer conservative size / n / extraJson usage.';
  const sizeGuidance = profile.sizeGuidance.map((item) => `- ${item}`).join('\n');
  const extraFieldGuidance = profile.extraFieldGuidance.map((item) => `- ${item}`).join('\n');
  const examples = profile.examples.map((item) => `- ${item}`).join('\n');

  return `## Image Generation Capability
The current assistant has image generation enabled. Use it when the user asks to create images, posters, illustrations, product visuals, or visual drafts.

### Current Image Model
- Configuration name: ${provider.name}
- Model ID: ${provider.model}
- Provider type: ${providerName}
- Invocation mode: ${apiType}
- API Base URL: ${provider.apiUrl || '(not configured; built-in default is used)'}

### Current Provider Parameter Guide
${profile.summary}

Reference docs:
${docs}

Size rules:
${sizeGuidance}

Extra parameter rules:
${extraFieldGuidance}

Common mapping examples:
${examples}

### Invocation Rules
- You must generate images through TeamAgentX-controlled tools: for Claude, use \`mcp__tax__generate_image\`; for Codex/ACP, use \`tax.generate_image\` or \`generate_image\`.
- Do not read, request, or output API keys yourself. Model credentials are stored only on the TeamAgentX server.
- If the user only gives a semantic size such as "portrait poster", "landscape banner", or "square avatar", translate it into an appropriate \`size\` and any required \`extraJson\` based on the current provider guide before calling the tool.
- Only pass \`extraJson\` fields that are explicitly supported by the current provider docs. Do not invent field names.
- After a successful tool call, read the \`urls\` field and return the result with Markdown image syntax, for example: \`![generated image](/uploads/images/example.png)\`.
- **Do not auto-retry after a tool failure**: do not call \`generate_image\`/\`mcp__tax__generate_image\` again, whether the failure is caused by network issues, timeout, HTTP 4xx/5xx, task failure, or anything else. Relay the error as-is and briefly suggest prompt, size, count, or model-configuration adjustments; let the user decide whether to retry.`;
}
