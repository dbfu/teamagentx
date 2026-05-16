import type { LlmProvider } from '@prisma/client';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import prisma from '../../lib/prisma.js';
import { createLlmClient } from '../../lib/llm-client.js';
import { buildImageGenerationEnv } from './image-generation-config.js';
import { uploadService } from '../../modules/upload/upload.service.js';
import { normalizeImageRequestParams } from './image-generation-provider-profiles.js';

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

// kept for tests that inject a custom fetch
export interface ImageGenerationDeps {
  execFile?: unknown;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_SIZE = '1024x1024';

// 各供应商在 base URL 上追加的固定路径。前端会同步展示同一份映射给用户。
const SUBMIT_PATH_OPENROUTER = '/chat/completions';
const SUBMIT_PATH_DEFAULT = '/images/generations';
const TASK_PATH_TEMPLATE_DEFAULT = '/tasks/{task_id}';
const SUBMIT_PATH_BAILIAN_SYNC = '/multimodal-generation/generation';
const SUBMIT_PATH_BAILIAN_ASYNC = '/image-generation/generation';

function submitPathFor(providerType: string, mode: 'sync' | 'async' | 'auto'): string {
  if (providerType === 'bailian') return mode === 'sync' ? SUBMIT_PATH_BAILIAN_SYNC : SUBMIT_PATH_BAILIAN_ASYNC;
  return providerType === 'openrouter' ? SUBMIT_PATH_OPENROUTER : SUBMIT_PATH_DEFAULT;
}
const DEFAULT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

const LOG_PREFIX = '[ImageGen]';

function log(msg: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`${LOG_PREFIX} ${msg}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(`${LOG_PREFIX} ${msg}`);
  }
}

function logError(msg: string, data?: unknown): void {
  if (data !== undefined) {
    console.error(`${LOG_PREFIX} ${msg}`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.error(`${LOG_PREFIX} ${msg}`);
  }
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

interface ImageConfig {
  prompt: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  mode: 'sync' | 'async' | 'auto';
  outputDir: string;
  urlPrefix: string;
  filename: string;
  size: string;
  n: number;
  timeoutMs: number;
  pollIntervalMs: number;
  submitPath: string;
  taskPathTemplate: string;
  cancelPathTemplate: string;
  extraJson: Record<string, unknown>;
}

interface ImageItem {
  kind: 'url' | 'base64';
  value: string;
  mimeType?: string;
}

type OpenRouterModality = 'image' | 'text';

function buildConfig(provider: LlmProvider, input: GenerateImageInput): ImageConfig {
  const env = buildImageGenerationEnv(provider);
  const mode = (env.IMAGE_GEN_API_TYPE || 'sync') as 'sync' | 'async' | 'auto';
  const providerType = env.IMAGE_GEN_PROVIDER || 'custom';
  const normalized = normalizeImageRequestParams(providerType, input.size || DEFAULT_SIZE, input.extraJson || {});
  const config: ImageConfig = {
    prompt: input.prompt.trim(),
    apiKey: env.IMAGE_GEN_API_KEY,
    baseUrl: (env.IMAGE_GEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.IMAGE_GEN_MODEL,
    provider: providerType,
    mode,
    outputDir: uploadService.getImageUploadDir(),
    urlPrefix: uploadService.getImageUrlPrefix(),
    filename: input.filename || '',
    size: normalized.size || DEFAULT_SIZE,
    n: input.n && input.n > 0 ? input.n : 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    submitPath: submitPathFor(providerType, mode),
    taskPathTemplate: TASK_PATH_TEMPLATE_DEFAULT,
    cancelPathTemplate: TASK_PATH_TEMPLATE_DEFAULT,
    extraJson: normalized.extraJson,
  };

  log('配置已解析', {
    baseUrl: config.baseUrl,
    model: config.model,
    provider: config.provider,
    mode: config.mode,
    size: config.size,
    n: config.n,
    submitPath: config.submitPath,
    taskPathTemplate: config.taskPathTemplate,
    apiKey: maskKey(config.apiKey),
    outputDir: config.outputDir,
    extraJson: config.extraJson,
  });

  return config;
}

function buildUrl(baseUrl: string, suffix: string): string {
  if (/^https?:\/\//i.test(suffix)) return suffix;
  return `${baseUrl}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function isOpenAiGptImageModel(model: string): boolean {
  const normalized = normalizeModelName(model);
  return normalized.startsWith('gpt-image') || normalized.startsWith('chatgpt-image');
}

function buildProviderRequestBody(config: ImageConfig): Record<string, unknown> {
  if (config.provider === 'xai') {
    return {
      model: config.model,
      prompt: config.prompt,
      n: config.n,
      ...config.extraJson,
    };
  }

  if (config.provider === 'openai') {
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: config.prompt,
      size: config.size,
      n: config.n,
      ...config.extraJson,
    };

    if (isOpenAiGptImageModel(config.model)) {
      delete body.response_format;
    }

    return body;
  }

  return {
    model: config.model,
    prompt: config.prompt,
    size: config.size,
    n: config.n,
    ...config.extraJson,
  };
}

function inferOpenRouterModalities(config: ImageConfig): OpenRouterModality[] {
  const provided = config.extraJson.modalities;
  if (Array.isArray(provided)) {
    const valid = provided.filter((value): value is OpenRouterModality => value === 'image' || value === 'text');
    if (valid.length > 0) return valid;
  }

  const model = normalizeModelName(config.model);
  if (
    model.startsWith('black-forest-labs/')
    || model.startsWith('sourceful/')
    || model.startsWith('recraft/')
  ) {
    return ['image'];
  }

  return ['image', 'text'];
}

function buildOpenRouterCapabilityError(config: ImageConfig, detail: string): Error {
  const modalities = inferOpenRouterModalities(config).join(', ');
  const message = [
    `OpenRouter 模型 "${config.model}" 不支持当前图片输出能力请求（modalities: [${modalities}]）。`,
    '请改用 output_modalities 包含 image 的模型。',
    '例如：google/gemini-3.1-flash-image-preview、google/gemini-2.5-flash-image、black-forest-labs/flux.2-pro。',
    '当前你配置的 google/gemini-3-flash-preview 是文本模型，不是图片生成模型。',
  ].join(' ');
  return new Error(`${message} 原始错误: ${detail}`);
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  log(`${label} → ${init.method || 'GET'} ${url}`);
  if (init.body) {
    // 不打印 API key，只打印 body
    log(`${label} 请求体`, JSON.parse(init.body as string));
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();

    log(`${label} HTTP ${response.status} 原始响应`, text.slice(0, 2000));

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === 'string' ? body : JSON.stringify(body);
      throw new Error(`HTTP ${response.status}: ${(detail || '').slice(0, 500)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(config: ImageConfig): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
  };
}

function walk(value: unknown, visit: (node: unknown, key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, k);
      walk(child, visit);
    }
  }
}

/**
 * 从响应体中提取任务 ID。
 * 优先匹配更精确的字段名，避免把嵌套的通用 "id" 误认作任务 ID。
 * 支持的字段名（按优先级）：task_id > taskId > job_id > jobId > request_id > requestId > id
 */
function extractTaskId(value: unknown): string {
  const priority = ['task_id', 'taskId', 'job_id', 'jobId', 'request_id', 'requestId', 'id'];
  const found: Record<string, string[]> = {};

  walk(value, (node, key) => {
    if (priority.includes(key) && typeof node === 'string' && node.trim()) {
      if (!found[key]) found[key] = [];
      found[key].push(node);
    }
  });

  log('extractTaskId 候选', found);

  for (const field of priority) {
    if (found[field]?.length) {
      log(`extractTaskId 使用字段 "${field}" = ${found[field][0]}`);
      return found[field][0];
    }
  }

  logError('extractTaskId 未在响应中找到任务 ID，完整响应:', value);
  return '';
}

function findStatus(value: unknown): string {
  const statuses: string[] = [];
  walk(value, (node, key) => {
    if ((key === 'status' || key === 'task_status') && typeof node === 'string') {
      statuses.push(node.toLowerCase());
    }
  });
  log(`findStatus 结果: ${statuses.length ? statuses.join(', ') : '(未找到 status 字段)'}`);
  return statuses[0] || '';
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isDataImage(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function dataUrlToImage(value: string): ImageItem {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(value);
  return { kind: 'base64', value: match?.[2] || '', mimeType: match?.[1] || 'image/png' };
}

function dedupeImages(images: ImageItem[]): ImageItem[] {
  const seen = new Set<string>();
  return images.filter((img) => {
    const key = `${img.kind}:${img.value.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 从 API 响应中提取图片，兼容主流提供商响应格式：
 * - OpenAI DALL-E sync:  { data: [{ url: "https://..." }] }
 * - OpenAI DALL-E b64:   { data: [{ b64_json: "..." }] }
 * - Stability AI:        { artifacts: [{ base64: "..." }] }
 * - apimart gpt-image-2: { data: { result: { images: [{ url: ["https://..."] }] } } }
 * - 通用 URL 数组:       { images: ["https://..."] } 或嵌套结构
 * - Data URI 内联图片:   任意字段值为 data:image/...;base64,...
 */
function extractImages(value: unknown, label = ''): ImageItem[] {
  const images: ImageItem[] = [];
  walk(value, (node, key) => {
    if (typeof node === 'string') {
      if (key === 'b64_json' || key === 'base64') {
        // OpenAI b64_json / Stability AI base64 — 仅当是合理长度的 base64 字符串时接受
        if (node.length > 64 && /^[A-Za-z0-9+/]+=*$/.test(node.slice(0, 32))) {
          images.push({ kind: 'base64', value: node });
        }
      } else if (key === 'url' && (isHttpUrl(node) || isDataImage(node))) {
        images.push(isDataImage(node) ? dataUrlToImage(node) : { kind: 'url', value: node });
      } else if (key === 'image' && isHttpUrl(node)) {
        images.push({ kind: 'url', value: node });
      } else if (isDataImage(node)) {
        images.push(dataUrlToImage(node));
      } else if ((key === 'image_url' || key === 'imageUrl' || key === 'img_url') && isHttpUrl(node)) {
        images.push({ kind: 'url', value: node });
      }
    } else if (key === 'url' && Array.isArray(node)) {
      // apimart pattern: url field is an array of URL strings, e.g. { "url": ["https://..."] }
      for (const item of node) {
        if (typeof item === 'string') {
          if (isHttpUrl(item)) images.push({ kind: 'url', value: item });
          else if (isDataImage(item)) images.push(dataUrlToImage(item));
        }
      }
    } else if ((key === 'images' || key === 'results' || key === 'outputs') && Array.isArray(node)) {
      // 通用 images/results/outputs 数组: ["https://...", ...] 或 [{url:"..."}, ...]
      for (const item of node) {
        if (typeof item === 'string' && isHttpUrl(item)) images.push({ kind: 'url', value: item });
      }
    }
  });

  const result = dedupeImages(images);
  log(`extractImages${label ? ` (${label})` : ''} 找到 ${result.length} 张`, result.map((i) => ({ kind: i.kind, preview: i.value.slice(0, 80) })));
  return result;
}

async function submitSync(config: ImageConfig): Promise<ImageItem[]> {
  const body = buildProviderRequestBody(config);
  log('submitSync 开始');
  const data = await fetchJson(buildUrl(config.baseUrl, config.submitPath), {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(body),
  }, config.timeoutMs, 'submitSync');
  return extractImages(data, 'sync 响应');
}

function buildBailianBody(config: ImageConfig): Record<string, unknown> {
  const { negative_prompt, prompt_extend, watermark, seed, ...restExtra } = config.extraJson;
  return {
    model: config.model,
    input: {
      messages: [{
        role: 'user',
        content: [{ text: config.prompt }],
      }],
    },
    parameters: {
      n: config.n,
      size: config.size,
      ...(prompt_extend !== undefined ? { prompt_extend } : {}),
      ...(watermark !== undefined ? { watermark } : {}),
      ...(negative_prompt !== undefined ? { negative_prompt } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...restExtra,
    },
  };
}

async function submitBailianSync(config: ImageConfig): Promise<ImageItem[]> {
  const body = buildBailianBody(config);
  log('submitBailianSync 开始');
  const data = await fetchJson(buildUrl(config.baseUrl, SUBMIT_PATH_BAILIAN_SYNC), {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(body),
  }, config.timeoutMs, 'submitBailianSync');
  return extractImages(data, 'bailian sync 响应');
}

async function submitBailianAsync(config: ImageConfig): Promise<ImageItem[]> {
  const startedAt = Date.now();
  const body = buildBailianBody(config);
  log('submitBailianAsync 开始提交任务');
  const submitData = await fetchJson(buildUrl(config.baseUrl, SUBMIT_PATH_BAILIAN_ASYNC), {
    method: 'POST',
    headers: {
      ...authHeaders(config),
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  }, Math.min(config.timeoutMs, 30_000), 'submitBailianAsync');

  let taskId = extractTaskId(submitData);
  if (!taskId) {
    taskId = await llmFallbackExtractTaskId(submitData);
    if (!taskId) {
      throw new Error(`submitBailianAsync: 响应中未找到任务 ID。响应内容: ${JSON.stringify(submitData).slice(0, 800)}`);
    }
  }

  return pollTask(config, taskId, Math.max(config.timeoutMs - (Date.now() - startedAt), 5_000));
}

/**
 * OpenRouter 通过 chat completions 接口生成图片：
 * https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 *
 * 请求：POST <baseUrl>/chat/completions
 *   body: { model, messages:[{role:'user', content: prompt}], modalities:['image','text'], ...extraJson }
 * 响应：choices[0].message.images[].image_url.url （通常是 data:image/png;base64,...）
 */
async function submitOpenRouter(config: ImageConfig): Promise<ImageItem[]> {
  const modalities = inferOpenRouterModalities(config);
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [{ role: 'user', content: config.prompt }],
    modalities,
    ...config.extraJson,
  };
  log('submitOpenRouter 开始');
  let data: unknown;
  try {
    data = await fetchJson(buildUrl(config.baseUrl, config.submitPath), {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(body),
    }, config.timeoutMs, 'submitOpenRouter');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('No endpoints found that support the requested output modalities')) {
      throw buildOpenRouterCapabilityError(config, detail);
    }
    throw error;
  }
  return extractImages(data, 'openrouter 响应');
}

async function cancelTask(config: ImageConfig, taskId: string): Promise<void> {
  if (!config.cancelPathTemplate) return;
  const cancelPath = config.cancelPathTemplate.replaceAll('{task_id}', encodeURIComponent(taskId));
  log(`cancelTask taskId=${taskId}`);
  try {
    await fetchJson(buildUrl(config.baseUrl, cancelPath), {
      method: 'DELETE',
      headers: { authorization: `Bearer ${config.apiKey}` },
    }, 10_000, 'cancelTask');
  } catch (e) {
    log('cancelTask 失败（忽略）', String(e));
  }
}

async function pollTask(config: ImageConfig, taskId: string, budgetMs: number): Promise<ImageItem[]> {
  const deadline = Date.now() + budgetMs;
  const taskPath = config.taskPathTemplate.replaceAll('{task_id}', encodeURIComponent(taskId));
  const pollUrl = buildUrl(config.baseUrl, taskPath);
  let pollCount = 0;

  log(`pollTask 开始 taskId=${taskId} url=${pollUrl} budget=${budgetMs}ms interval=${config.pollIntervalMs}ms`);

  while (Date.now() < deadline) {
    pollCount++;
    log(`pollTask 第 ${pollCount} 次轮询 (剩余 ${deadline - Date.now()}ms)`);

    const data = await fetchJson(pollUrl, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.apiKey}` },
    }, Math.min(config.pollIntervalMs * 2, 30_000), `pollTask#${pollCount}`);

    const status = findStatus(data);
    log(`pollTask#${pollCount} status="${status}"`);

    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      log('pollTask 任务完成，提取图片');
      const images = extractImages(data, `poll#${pollCount} 完成`);
      if (images.length > 0) return images;
      throw new Error(`任务已完成但未找到图片，响应: ${JSON.stringify(data).slice(0, 800)}`);
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`任务失败 (status="${status}")，响应: ${JSON.stringify(data).slice(0, 800)}`);
    }

    log(`pollTask#${pollCount} 状态 "${status}" 继续等待 ${config.pollIntervalMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(`异步任务超时，已轮询 ${pollCount} 次，耗时超过 ${budgetMs}ms`);
}

/**
 * 当规则匹配无法识别 task_id 时，用系统默认文本模型解析原始响应。
 * 只在确实找不到时触发，失败也只是 warning，不阻断流程。
 */
async function llmFallbackExtractTaskId(responseData: unknown): Promise<string> {
  try {
    const defaultProvider = await prisma.llmProvider.findFirst({
      where: { isActive: true, modelType: 'text', isDefault: true },
    }) ?? await prisma.llmProvider.findFirst({
      where: { isActive: true, modelType: 'text' },
    });

    if (!defaultProvider) {
      log('llmFallback: 无可用文本模型，跳过');
      return '';
    }

    log(`llmFallback: 使用 ${defaultProvider.name} 识别 task_id`);
    const client = createLlmClient(defaultProvider as LlmProvider, { maxTokens: 64, temperature: 0 });
    const responseJson = JSON.stringify(responseData).slice(0, 1500);
    const answer = await client.invoke(
      `你是一个 JSON 解析助手。下面是一个图片生成接口的响应 JSON，该接口是异步任务模式，会返回一个任务 ID 用于后续轮询结果。
请找出其中代表"任务 ID"的字段值，直接输出该值，不要输出任何其他内容，不要加引号或解释。
如果找不到任务 ID，输出空字符串。

响应 JSON：
${responseJson}`,
    );

    const taskId = answer.trim().replace(/^["']|["']$/g, '');
    log(`llmFallback: 识别到 taskId="${taskId}"`);
    return taskId;
  } catch (e) {
    logError('llmFallback: 调用失败，跳过', String(e));
    return '';
  }
}

async function submitAsync(config: ImageConfig): Promise<ImageItem[]> {
  const startedAt = Date.now();
  const body = buildProviderRequestBody(config);

  log('submitAsync 开始提交任务');
  const submitData = await fetchJson(buildUrl(config.baseUrl, config.submitPath), {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify(body),
  }, Math.min(config.timeoutMs, 30_000), 'submitAsync');

  let taskId = extractTaskId(submitData);

  if (!taskId) {
    if (config.mode === 'auto') {
      log('submitAsync: 未找到 taskId，auto 模式尝试从提交响应中直接提取图片');
      return extractImages(submitData, 'auto 模式直接提取');
    }
    // 规则匹配失败：尝试用默认 LLM 兜底识别 task_id 字段
    taskId = await llmFallbackExtractTaskId(submitData);
    if (!taskId) {
      throw new Error(
        `submitAsync: 响应中未找到任务 ID，无法轮询。响应内容: ${JSON.stringify(submitData).slice(0, 800)}`,
      );
    }
  }

  log(`submitAsync: 提交成功，taskId=${taskId}，开始轮询`);

  try {
    return await pollTask(config, taskId, Math.max(config.timeoutMs - (Date.now() - startedAt), 5_000));
  } catch (error) {
    logError('submitAsync: 轮询失败，尝试取消任务', String(error));
    await cancelTask(config, taskId);
    throw error;
  }
}

function extensionFromMime(mimeType = 'image/png'): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.png';
}

function uniqueToken(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function outputName(filename: string, index: number, count: number, mimeType?: string): string {
  const ext = extensionFromMime(mimeType);
  if (!filename) {
    const suffix = count > 1 ? `_${String(index + 1).padStart(3, '0')}` : '';
    return `img_${uniqueToken()}${suffix}${ext}`;
  }
  const parsed = path.parse(filename);
  if (count <= 1) return parsed.ext ? filename : `${filename}${ext}`;
  const suffix = `_${String(index + 1).padStart(3, '0')}`;
  return `${parsed.name}${suffix}${parsed.ext || ext}`;
}

async function downloadImage(url: string, timeoutMs: number): Promise<Buffer> {
  log(`downloadImage: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status} url=${url}`);
    const buf = Buffer.from(await response.arrayBuffer());
    log(`downloadImage: 下载完成 ${buf.length} bytes`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function materializeImages(config: ImageConfig, images: ImageItem[]): Promise<string[]> {
  if (images.length === 0) throw new Error('API 响应中未找到图片 URL 或 base64 内容');

  await mkdir(config.outputDir, { recursive: true });
  const count = Math.min(images.length, config.n);
  const files: string[] = [];

  for (let i = 0; i < count; i++) {
    const image = images[i];
    const buffer =
      image.kind === 'url'
        ? await downloadImage(image.value, config.timeoutMs)
        : Buffer.from(image.value, 'base64');

    if (buffer.length === 0) throw new Error('生成的图片内容为空');

    const filePath = path.join(config.outputDir, outputName(config.filename, i, count, image.mimeType));
    await writeFile(filePath, buffer);
    log(`materializeImages: 已写入 ${filePath} (${buffer.length} bytes)`);
    files.push(filePath);
  }

  return files;
}

function outputUrls(config: ImageConfig, files: string[]): string[] {
  const prefix = config.urlPrefix;
  if (!prefix) return [];
  return files.map((file) => {
    const basename = path.basename(file);
    return `${prefix.replace(/\/+$/, '')}/${encodeURIComponent(basename)}`;
  });
}

function assertImageProviderUsable(provider: LlmProvider): void {
  if (!provider.isActive) throw new Error('图片模型未启用');
  if (((provider as any).modelType || 'text') !== 'image') throw new Error('所选模型不是图片模型');
  if (!provider.apiKey || !provider.model) throw new Error('图片模型配置不完整');
}

export async function generateImageWithProvider(
  provider: LlmProvider,
  input: GenerateImageInput,
  _deps: ImageGenerationDeps = {},
): Promise<GenerateImageResult> {
  assertImageProviderUsable(provider);

  const prompt = input.prompt?.trim();
  if (!prompt) throw new Error('图片生成提示词不能为空');

  const config = buildConfig(provider, { ...input, prompt });
  const providerLabel = `${config.provider}/${config.model}`;

  log(`generateImage 开始 provider=${providerLabel} mode=${config.mode} prompt="${prompt.slice(0, 80)}"`);

  let images: ImageItem[];
  try {
    if (config.provider === 'openrouter') {
      images = await submitOpenRouter(config);
    } else if (config.provider === 'bailian') {
      images = config.mode === 'async' || config.mode === 'auto'
        ? await submitBailianAsync(config)
        : await submitBailianSync(config);
    } else if (config.mode === 'async' || config.mode === 'auto') {
      images = await submitAsync(config);
    } else {
      images = await submitSync(config);
    }
  } catch (error) {
    logError('generateImage 失败', error instanceof Error ? error.message : String(error));
    throw error;
  }

  const files = await materializeImages(config, images);
  const urls = outputUrls(config, files);

  log(`generateImage 完成 files=${files.length}`, urls);

  return {
    success: true,
    files,
    urls,
    provider: providerLabel,
    mode: config.mode,
  };
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
  if (!provider) throw new Error('当前助手未开启图片生成能力或未绑定图片模型');
  return generateImageWithProvider(provider, input, deps);
}
