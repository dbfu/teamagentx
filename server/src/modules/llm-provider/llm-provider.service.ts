import prisma from '../../lib/prisma.js';
import { LlmProvider, LlmProviderType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createLlmClient } from '../../lib/llm-client.js';

export type LlmModelType = 'text' | 'image' | 'video' | 'audio';
export type ImageGenApiType = 'sync' | 'async' | 'auto';

export type CreateLlmProviderInput = {
  name: string;
  type?: LlmProviderType;
  modelType?: LlmModelType;
  apiProtocol?: string;
  apiUrl?: string;
  apiKey: string;
  model: string;
  sttModel?: string | null;
  audioUsage?: string | null;
  imageProvider?: string | null;
  imageApiType?: ImageGenApiType | null;
  isActive?: boolean;
  isDefault?: boolean;
};

export type UpdateLlmProviderInput = Partial<CreateLlmProviderInput>;

export type ParsedModelConfig = {
  name: string | null;
  apiUrl: string | null;
  apiKey: string | null;
  model: string | null;
  apiProtocol: 'anthropic' | 'openai' | null;
};

function normalizeAudioUsage(audioUsage?: string | null): 'tts' | 'stt' | 'both' {
  if (audioUsage === 'tts' || audioUsage === 'stt') return audioUsage;
  return 'both';
}

function canUseAudioDefault(modelType: LlmModelType, audioUsage?: string | null): boolean {
  return modelType !== 'audio' || normalizeAudioUsage(audioUsage) !== 'tts';
}

function buildDefaultResetWhere(modelType: LlmModelType, idToExclude?: string) {
  if (modelType === 'audio') {
    return {
      isDefault: true,
      modelType,
      ...(idToExclude ? { id: { not: idToExclude } } : {}),
      audioUsage: { in: ['stt', 'both'] },
    };
  }

  return {
    isDefault: true,
    modelType,
    ...(idToExclude ? { id: { not: idToExclude } } : {}),
  };
}

// System prompt for AI-assisted model configuration parsing.
const PARSE_CONFIG_PROMPT = `You are a model configuration parsing assistant. The user will provide a description of API configuration details. Extract the following fields and return them as JSON:

- name: model configuration name. Only extract a name explicitly provided by the user; otherwise return null.
- apiUrl: API endpoint URL. Only extract a URL explicitly provided by the user; otherwise return null.
- apiKey: API key. Only extract a key explicitly provided by the user; otherwise return null.
- model: model name. Only extract a model name explicitly provided by the user; otherwise return null.
- apiProtocol: API protocol type, either anthropic or openai. Only infer this from an explicitly mentioned protocol; otherwise return null.

Do not infer or guess any field values. Only extract information the user explicitly provided.

Return JSON only. Do not include any explanatory text.`;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isMaskedApiKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value === '****' || /^.{3}\*\*\*.{4}$/.test(value);
}

function normalizeApiProtocol(value: unknown): 'anthropic' | 'openai' | null {
  if (value !== 'anthropic' && value !== 'openai') return null;
  return value;
}

function normalizeParsedModelConfig(value: unknown): ParsedModelConfig {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    name: stringOrNull(record.name),
    apiUrl: stringOrNull(record.apiUrl),
    apiKey: stringOrNull(record.apiKey),
    model: stringOrNull(record.model),
    apiProtocol: normalizeApiProtocol(record.apiProtocol),
  };
}

function extractJsonCandidate(content: string): string {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) return jsonMatch[1].trim();

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1).trim();

  return content.trim();
}

function parseKeyValueConfig(content: string): ParsedModelConfig {
  const result: ParsedModelConfig = {
    name: null,
    apiUrl: null,
    apiKey: null,
    model: null,
    apiProtocol: null,
  };

  const aliases: Record<string, keyof ParsedModelConfig> = {
    name: 'name',
    '模型配置名称': 'name',
    '配置名称': 'name',
    apiUrl: 'apiUrl',
    api_url: 'apiUrl',
    url: 'apiUrl',
    '端点': 'apiUrl',
    '接口地址': 'apiUrl',
    apiKey: 'apiKey',
    api_key: 'apiKey',
    key: 'apiKey',
    '密钥': 'apiKey',
    model: 'model',
    '模型': 'model',
    apiProtocol: 'apiProtocol',
    api_protocol: 'apiProtocol',
    protocol: 'apiProtocol',
    '协议': 'apiProtocol',
  };

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*["']?([^"':：=]+)["']?\s*[:：=]\s*(.*?)\s*,?\s*$/);
    if (!match) continue;

    const key = aliases[match[1].trim()];
    if (!key) continue;

    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'apiProtocol') {
      result.apiProtocol = normalizeApiProtocol(value);
    } else {
      result[key] = stringOrNull(value);
    }
  }

  return result;
}

export function parseAiConfigResponse(content: string): ParsedModelConfig {
  try {
    return normalizeParsedModelConfig(JSON.parse(extractJsonCandidate(content)));
  } catch {
    return parseKeyValueConfig(content);
  }
}

export const llmProviderService = {
  async create(data: CreateLlmProviderInput): Promise<LlmProvider> {
    const modelType = data.modelType || 'text';
    const existingProviderCount = await prisma.llmProvider.count();
    const audioUsage = normalizeAudioUsage(data.audioUsage);
    const requestedDefault = data.isDefault ?? false;
    const canSetDefault = canUseAudioDefault(modelType, audioUsage);
    const shouldSetDefault = canSetDefault && (existingProviderCount === 0 || requestedDefault);

    // 如果设置为默认，需要先清除其他默认
    if (shouldSetDefault) {
      await prisma.llmProvider.updateMany({
        where: buildDefaultResetWhere(modelType),
        data: { isDefault: false },
      });
    }

    return prisma.llmProvider.create({
      data: {
        id: randomUUID(),
        name: data.name,
        type: data.type || 'custom',
        modelType,
        apiProtocol: data.apiProtocol || 'anthropic',
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
        model: data.model,
        sttModel: modelType === 'audio' ? (data.sttModel || null) : null,
        audioUsage: modelType === 'audio' ? audioUsage : 'both',
        imageProvider: modelType === 'image' ? data.imageProvider : null,
        imageApiType: modelType === 'image' ? (data.imageApiType || 'sync') : null,
        isActive: data.isActive ?? true,
        isDefault: shouldSetDefault,
      },
    });
  },

  async findAll(): Promise<LlmProvider[]> {
    return prisma.llmProvider.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { agents: true },
        },
      },
    });
  },

  async findActive(modelType: LlmModelType = 'text'): Promise<LlmProvider[]> {
    return prisma.llmProvider.findMany({
      where: { isActive: true, modelType },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findById(id: string): Promise<LlmProvider | null> {
    return prisma.llmProvider.findUnique({
      where: { id },
      include: {
        agents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  },

  async findByName(name: string): Promise<LlmProvider | null> {
    return prisma.llmProvider.findUnique({
      where: { name },
    });
  },

  async findDefault(modelType: LlmModelType = 'text'): Promise<LlmProvider | null> {
    return prisma.llmProvider.findFirst({
      where: { isDefault: true, isActive: true, modelType },
    });
  },

  async findDefaultImageProvider(): Promise<LlmProvider | null> {
    return this.findDefault('image');
  },

  async update(id: string, data: UpdateLlmProviderInput): Promise<LlmProvider> {
    const current = await prisma.llmProvider.findUnique({
      where: { id },
      select: { modelType: true, isDefault: true, audioUsage: true },
    });
    if (!current) {
      return prisma.llmProvider.update({
        where: { id },
        data: {},
      });
    }
    const modelType = data.modelType || (current.modelType as LlmModelType);
    const nextAudioUsage = modelType === 'audio'
      ? normalizeAudioUsage(data.audioUsage ?? current.audioUsage)
      : 'both';
    const normalizedIsDefault = data.isDefault === undefined
      ? undefined
      : canUseAudioDefault(modelType, nextAudioUsage) && data.isDefault;

    // 如果设置为默认，需要先清除其他默认
    if (
      normalizedIsDefault
      || (current.isDefault && data.modelType && data.modelType !== current.modelType)
    ) {
      await prisma.llmProvider.updateMany({
        where: buildDefaultResetWhere(modelType, id),
        data: { isDefault: false },
      });
    }

    const { audioUsage: rawAudioUsage, ...restData } = data;
    if (isMaskedApiKey(restData.apiKey)) {
      delete restData.apiKey;
    }

    return prisma.llmProvider.update({
      where: { id },
      data: {
        ...restData,
        ...(rawAudioUsage !== undefined ? { audioUsage: nextAudioUsage } : {}),
        ...(normalizedIsDefault !== undefined ? { isDefault: normalizedIsDefault } : {}),
        ...(modelType === 'audio' && !canUseAudioDefault(modelType, nextAudioUsage) ? { isDefault: false } : {}),
        ...(data.modelType && data.modelType !== 'image' ? { imageProvider: null, imageApiType: null } : {}),
        ...(data.modelType === 'image' && data.imageApiType === undefined ? { imageApiType: 'sync' } : {}),
        ...(data.modelType && data.modelType !== 'audio' ? { sttModel: null, audioUsage: 'both' } : {}),
        updatedAt: new Date(),
      },
    });
  },

  async delete(id: string): Promise<LlmProvider> {
    return prisma.llmProvider.delete({
      where: { id },
    });
  },

  async setActive(id: string, isActive: boolean): Promise<LlmProvider> {
    return prisma.llmProvider.update({
      where: { id },
      data: { isActive, updatedAt: new Date() },
    });
  },

  async setDefault(id: string): Promise<LlmProvider> {
    const provider = await prisma.llmProvider.findUnique({
      where: { id },
      select: { modelType: true, audioUsage: true },
    });
    if (!provider) {
      return prisma.llmProvider.update({
        where: { id },
        data: {},
      });
    }

    if (!canUseAudioDefault(provider.modelType as LlmModelType, provider.audioUsage)) {
      throw new Error('仅支持将 STT 或 TTS + STT 语音模型设为默认 STT');
    }

    // 清除其他默认
    await prisma.llmProvider.updateMany({
      where: buildDefaultResetWhere(provider.modelType as LlmModelType, id),
      data: { isDefault: false },
    });

    return prisma.llmProvider.update({
      where: { id },
      data: { isDefault: true, updatedAt: new Date() },
    });
  },

  /**
   * 使用 AI 解析用户输入的模型配置描述
   * 返回解析后的配置信息
   */
  async parseConfigDescription(description: string): Promise<ParsedModelConfig | { error: string }> {
    // 获取默认 LLM Provider
    const defaultProvider = await this.findDefault();
    if (!defaultProvider) {
      return { error: '没有可用的默认模型配置，请先手动创建一个模型配置' };
    }

    const model = createLlmClient(defaultProvider, { maxTokens: 500 });

    try {
      const content = await model.invoke([
        { role: 'system', content: PARSE_CONFIG_PROMPT },
        { role: 'user', content: description },
      ]);

      return parseAiConfigResponse(content);
    } catch (error) {
      console.error('Parse config error:', error);
      // 解析失败时返回空配置，让用户在表单里手动填写
      return {
        name: null,
        apiUrl: null,
        apiKey: null,
        model: null,
        apiProtocol: null,
      };
    }
  },
};
