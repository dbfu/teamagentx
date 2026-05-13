import type { LlmProvider } from '@prisma/client';
import { execFile as execFileCallback } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import prisma from '../../lib/prisma.js';
import {
  buildImageGenerationEnv,
  getBuiltinImageGenerationSkillDir,
} from './image-generation-config.js';

const execFilePromise = promisify(execFileCallback);

export interface GenerateImageInput {
  prompt: string;
  size?: string;
  n?: number;
  filename?: string;
  extraJson?: Record<string, unknown>;
}

export interface GenerateImageResult {
  success: true;
  files: string[];
  urls: string[];
  provider: string;
  mode: string;
}

interface ExecFileOptions {
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
}

type ExecFileLike = (
  file: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface ImageGenerationDeps {
  execFile?: ExecFileLike;
}

function assertImageProviderUsable(provider: LlmProvider): void {
  if (!provider.isActive) {
    throw new Error('图片模型未启用');
  }
  if (((provider as any).modelType || 'text') !== 'image') {
    throw new Error('所选模型不是图片模型');
  }
  if (!provider.apiKey || !provider.model) {
    throw new Error('图片模型配置不完整');
  }
}

function buildScriptArgs(input: GenerateImageInput): string[] {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error('图片生成提示词不能为空');
  }

  const args = ['--prompt', prompt];
  if (input.size) args.push('--size', input.size);
  if (input.n) args.push('--n', String(input.n));
  if (input.filename) args.push('--filename', input.filename);
  if (input.extraJson && Object.keys(input.extraJson).length > 0) {
    args.push('--extra-json', JSON.stringify(input.extraJson));
  }
  return args;
}

function parseScriptResult(stdout: string, stderr: string): GenerateImageResult {
  const raw = stdout.trim() || stderr.trim();
  if (!raw) {
    throw new Error('图片生成脚本没有返回结果');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`图片生成脚本返回了无法解析的结果: ${raw.slice(0, 300)}`);
  }

  if (!parsed?.success) {
    throw new Error(parsed?.error || '图片生成失败');
  }

  return {
    success: true,
    files: Array.isArray(parsed.files) ? parsed.files : [],
    urls: Array.isArray(parsed.urls) ? parsed.urls : [],
    provider: String(parsed.provider || ''),
    mode: String(parsed.mode || ''),
  };
}

export async function generateImageWithProvider(
  provider: LlmProvider,
  input: GenerateImageInput,
  deps: ImageGenerationDeps = {},
): Promise<GenerateImageResult> {
  assertImageProviderUsable(provider);

  const scriptPath = path.join(
    getBuiltinImageGenerationSkillDir(),
    'scripts',
    'generate-image.mjs',
  );
  const execFile = deps.execFile || execFilePromise;
  const env = {
    ...process.env,
    ...buildImageGenerationEnv(provider),
  };
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFile(process.execPath, [scriptPath, ...buildScriptArgs(input)], {
      env,
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 4,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error: any) {
    stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    if (!stdout && !stderr) {
      throw new Error(error instanceof Error ? error.message : '图片生成脚本执行失败');
    }
  }

  return parseScriptResult(stdout, stderr);
}

export async function resolveAgentImageProvider(agentId: string): Promise<LlmProvider | null> {
  const capability = await (prisma as any).agentCapability.findUnique({
    where: {
      agentId_capabilityType: {
        agentId,
        capabilityType: 'image',
      },
    },
    include: {
      llmProvider: true,
    },
  });

  if (!capability?.enabled || !capability.llmProvider) return null;
  return capability.llmProvider;
}

export async function generateImageForAgent(
  agentId: string,
  input: GenerateImageInput,
  deps: ImageGenerationDeps = {},
): Promise<GenerateImageResult> {
  const provider = await resolveAgentImageProvider(agentId);
  if (!provider) {
    throw new Error('当前助手未开启图片生成能力或未绑定图片模型');
  }
  return generateImageWithProvider(provider, input, deps);
}
