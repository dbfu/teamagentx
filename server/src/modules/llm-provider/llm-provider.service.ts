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

// AI 解析模型配置的系统提示词
const PARSE_CONFIG_PROMPT = `你是一个模型配置解析助手。用户会提供他们的 API 配置信息描述，你需要从中提取出以下字段并以 JSON 格式返回：

- name: 模型配置名称（仅提取用户明确提到的名称，未提及则返回 null）
- apiUrl: API 端点 URL（仅提取用户明确提到的 URL，未提及则返回 null）
- apiKey: API Key（仅提取用户明确提到的 Key，未提及则返回 null）
- model: 模型名称（仅提取用户明确提到的模型名称，未提及则返回 null）
- apiProtocol: API 协议类型，anthropic 或 openai（仅根据用户明确提到的协议判断，未提及则返回 null）

注意：不要推测或猜测任何字段的值，只提取用户明确提供的信息。

请只返回 JSON，不要包含其他解释文字。`;

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

      // 解析 AI 返回的 JSON
      // 尝试提取 JSON（可能被 markdown 包裹）
      let jsonStr = content;
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // 所有字段都可以为 null，用户可以在表单里手动补充
      return {
        name: parsed.name ?? null,
        apiUrl: parsed.apiUrl ?? null,
        apiKey: parsed.apiKey ?? null,
        model: parsed.model ?? null,
        apiProtocol: parsed.apiProtocol ?? null,
      };
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
