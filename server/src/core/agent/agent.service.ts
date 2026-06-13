import prisma from '../../lib/prisma.js';
import { Agent, AgentType, LlmProvider, AgentCategory, AgentLevel, AgentCapability } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  type AgentSpeechConfig,
  serializeAgentSpeechConfig,
} from '../../modules/speech/speech-config.js';
import { invalidateSystemAgentsCache } from '../../modules/chatroom/system-agents-cache.js';
import { normalizeAgentProxyConfig } from './proxy-config.js';
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID, HIDDEN_SYSTEM_AGENT_IDS } from './system-assistant.constants.js';
import {
  DEFAULT_AGENT_THINKING_MODE,
  normalizeAgentThinkingMode,
  type AgentThinkingMode,
} from './thinking-mode.js';

// 包含关联的 Agent 类型
export type AgentWithRelations = Agent & {
  category: AgentCategory | null;
  llmProvider: LlmProvider | null;
  capabilities?: Array<AgentCapability & { llmProvider: LlmProvider | null }>;
};

export type AgentCapabilityInput = {
  enabled?: boolean;
  llmProviderId?: string | null;
  config?: Record<string, unknown> | null;
};

export type CreateAgentInput = {
  id?: string; // 可选的自定义 ID
  name: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  prompt: string;
  type?: AgentType;
  agentLevel?: AgentLevel;
  acpTool?: string;
  workDir?: string;
  proxyConfig?: string | null;
  codexModel?: string | null;
  codexFastMode?: boolean;
  claudeModel?: string | null;
  thinkingMode?: AgentThinkingMode | null;
  categoryId?: string;
  llmProviderId?: string;
  fallbackLlmProviderIds?: string[] | null;
  imageGeneration?: AgentCapabilityInput;
  speechConfig?: AgentSpeechConfig | null;
};

export type UpdateAgentInput = Partial<CreateAgentInput> & {
  categoryId?: string | null; // 允许 null 来移除分类
  llmProviderId?: string | null; // 允许 null 来移除 LLM 供应商
};

async function assertAgentIsUserEditable(id: string, action: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { agentLevel: true },
  });

  if (!agent) {
    const error = new Error('助手不存在') as Error & { code?: string };
    error.code = 'P2025';
    throw error;
  }

  if (agent.agentLevel === 'system') {
    throw new Error(`系统助手不允许${action}`);
  }
}

function getRequiredProviderProtocol(type?: AgentType | null, acpTool?: string | null): 'anthropic' | 'openai' | null {
  if (type !== 'acp') return null;
  if (acpTool === 'claude') return 'anthropic';
  if (acpTool === 'codex') return 'openai';
  return null;
}

function assertAcpToolSupported(type?: AgentType | null, acpTool?: string | null): void {
  if (type !== 'acp') return;
  const tool = acpTool || 'claude';
  if (tool !== 'claude' && tool !== 'codex') {
    throw new Error('目前仅支持 Claude 和 Codex 工具');
  }
}

async function assertLlmProviderCompatible(
  type: AgentType | undefined | null,
  acpTool: string | undefined | null,
  llmProviderId: string | null | undefined,
): Promise<void> {
  if (!llmProviderId) return;

  const requiredProtocol = getRequiredProviderProtocol(type, acpTool);
  if (type === 'acp' && !requiredProtocol) {
    throw new Error('该 ACP 工具暂不支持自定义 LLM 供应商');
  }
  if (!requiredProtocol) return;

  const provider = await prisma.llmProvider.findUnique({
    where: { id: llmProviderId },
    select: { apiProtocol: true, name: true, modelType: true },
  });
  if (!provider) {
    const error = new Error('LLM 供应商不存在') as Error & { code?: string };
    error.code = 'P2025';
    throw error;
  }
  if (((provider as any).modelType || 'text') !== 'text') {
    throw new Error(`助手只能绑定文本模型，当前供应商 ${provider.name} 的模型类型是 ${(provider as any).modelType}`);
  }
  if (provider.apiProtocol !== requiredProtocol) {
    const label = acpTool === 'claude' ? 'Claude' : 'Codex';
    throw new Error(`${label} 仅支持 ${requiredProtocol} 协议供应商，当前供应商 ${provider.name} 的协议是 ${provider.apiProtocol}`);
  }
}

function normalizeProviderIdList(value: string[] | null | undefined): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function parseFallbackLlmProviderIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return normalizeProviderIdList(parsed) ?? [];
  } catch {
    return [];
  }
}

function serializeFallbackLlmProviderIds(value: string[] | null | undefined): string | null | undefined {
  const normalized = normalizeProviderIdList(value);
  if (normalized === undefined) return undefined;
  if (normalized === null || normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

async function assertFallbackLlmProvidersCompatible(
  type: AgentType | undefined | null,
  acpTool: string | undefined | null,
  fallbackLlmProviderIds: string[] | null | undefined,
): Promise<void> {
  if (!fallbackLlmProviderIds?.length) return;

  const requiredProtocol = getRequiredProviderProtocol(type, acpTool);
  if (type === 'acp' && !requiredProtocol) {
    throw new Error('该 ACP 工具暂不支持自定义 LLM 供应商');
  }

  const providers = await prisma.llmProvider.findMany({
    where: { id: { in: fallbackLlmProviderIds } },
    select: { id: true, apiProtocol: true, name: true, modelType: true },
  });
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  for (const providerId of fallbackLlmProviderIds) {
    const provider = providerById.get(providerId);
    if (!provider) {
      const error = new Error('备用 LLM 供应商不存在') as Error & { code?: string };
      error.code = 'P2025';
      throw error;
    }
    if (((provider as any).modelType || 'text') !== 'text') {
      throw new Error(`备用模型只能选择文本模型，当前供应商 ${provider.name} 的模型类型是 ${(provider as any).modelType}`);
    }
    if (requiredProtocol && provider.apiProtocol !== requiredProtocol) {
      const label = acpTool === 'claude' ? 'Claude' : 'Codex';
      throw new Error(`${label} 备用模型仅支持 ${requiredProtocol} 协议供应商，当前供应商 ${provider.name} 的协议是 ${provider.apiProtocol}`);
    }
  }
}

async function assertImageProviderCompatible(llmProviderId: string | null | undefined): Promise<void> {
  if (!llmProviderId) return;

  const provider = await prisma.llmProvider.findUnique({
    where: { id: llmProviderId },
    select: { name: true, modelType: true },
  });
  if (!provider) {
    const error = new Error('图片模型供应商不存在') as Error & { code?: string };
    error.code = 'P2025';
    throw error;
  }
  if (((provider as any).modelType || 'text') !== 'image') {
    throw new Error(`图片能力只能绑定图片模型，当前供应商 ${provider.name} 的模型类型是 ${(provider as any).modelType || 'text'}`);
  }
}

function normalizeNullableId(value: string | null | undefined): string | null | undefined {
  if (value === '') return undefined;
  if (value === 'null') return null;
  return value;
}

function normalizeNullableString(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function upsertImageCapability(tx: any, agentId: string, input: AgentCapabilityInput): Promise<void> {
  const enabled = Boolean(input.enabled);
  const llmProviderId = normalizeNullableId(input.llmProviderId ?? null) ?? null;
  if (enabled && !llmProviderId) {
    throw new Error('开启图片能力时必须选择图片模型');
  }

  await tx.agentCapability.upsert({
    where: { agentId_capabilityType: { agentId, capabilityType: 'image' } },
    create: {
      agentId,
      capabilityType: 'image',
      enabled,
      llmProviderId: enabled ? llmProviderId : null,
      config: input.config ?? undefined,
    },
    update: {
      enabled,
      llmProviderId: enabled ? llmProviderId : null,
      config: input.config ?? undefined,
    },
  });
}

const agentInclude = {
  category: true,
  llmProvider: true,
  capabilities: {
    include: {
      llmProvider: true,
    },
  },
} as const;

const AGENT_SORT_ORDER_STEP = 1000;

// 批量更新排序请求类型
export type UpdateSortOrderInput = {
  id: string;
  sortOrder: number;
  categoryId?: string | null;  // 可选：同时更新分类
};

export const agentService = {
  async create(data: CreateAgentInput): Promise<AgentWithRelations> {
    const now = new Date();
    // 处理外键字段：空字符串转换为 null
    const categoryId = (data.categoryId === '' || data.categoryId === 'null') ? null : data.categoryId;
    const llmProviderId = (data.llmProviderId === '' || data.llmProviderId === 'null') ? null : data.llmProviderId;
    const fallbackLlmProviderIds = normalizeProviderIdList(data.fallbackLlmProviderIds) ?? [];
    const agentType = data.type || 'builtin';
    assertAcpToolSupported(agentType, data.acpTool);
    await assertLlmProviderCompatible(agentType, data.acpTool, llmProviderId);
    await assertFallbackLlmProvidersCompatible(agentType, data.acpTool, fallbackLlmProviderIds);
    if (data.imageGeneration?.enabled) {
      await assertImageProviderCompatible(data.imageGeneration.llmProviderId);
    }

    const agentId = data.id || randomUUID();
    return prisma.$transaction(async (tx) => {
      const currentFirstAgent = await tx.agent.findFirst({
        where: {
          categoryId,
          agentLevel: 'normal',
        },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });

      await tx.agent.create({
        data: {
          id: agentId,
          name: data.name,
          avatar: data.avatar,
          avatarColor: data.avatarColor,
          description: data.description,
          prompt: data.prompt,
          type: agentType,
          agentLevel: data.agentLevel || 'normal',
          acpTool: data.acpTool,
          workDir: data.workDir,
          proxyConfig: normalizeAgentProxyConfig(data.proxyConfig),
          codexModel: normalizeNullableString(data.codexModel),
          codexFastMode: data.codexFastMode ?? false,
          claudeModel: normalizeNullableString(data.claudeModel),
          thinkingMode: normalizeAgentThinkingMode(data.thinkingMode) ?? DEFAULT_AGENT_THINKING_MODE,
          categoryId,
          llmProviderId,
          fallbackLlmProviderIds: serializeFallbackLlmProviderIds(fallbackLlmProviderIds),
          speechConfig: serializeAgentSpeechConfig(data.speechConfig),
          sortOrder: (currentFirstAgent?.sortOrder ?? 0) + AGENT_SORT_ORDER_STEP,
          updatedAt: now,
        },
      });
      if (data.imageGeneration) {
        await upsertImageCapability(tx, agentId, data.imageGeneration);
      }
      return tx.agent.findUniqueOrThrow({
        where: { id: agentId },
        include: agentInclude,
      });
    });
  },

  async findAll(): Promise<AgentWithRelations[]> {
    return prisma.agent.findMany({
      where: {
        id: { notIn: HIDDEN_SYSTEM_AGENT_IDS },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        ...agentInclude,
      },
    });
  },

  async findActive(): Promise<AgentWithRelations[]> {
    return prisma.agent.findMany({
      where: {
        isActive: true,
        id: { notIn: HIDDEN_SYSTEM_AGENT_IDS },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        ...agentInclude,
      },
    });
  },

  async findById(id: string): Promise<AgentWithRelations | null> {
    return prisma.agent.findUnique({
      where: { id },
      include: {
        ...agentInclude,
      },
    });
  },

  async findByName(name: string): Promise<AgentWithRelations | null> {
    return prisma.agent.findUnique({
      where: { name },
      include: {
        ...agentInclude,
      },
    });
  },

  async update(id: string, data: UpdateAgentInput): Promise<AgentWithRelations> {
    // 系统助手允许更新的字段白名单（仅展示/偏好类字段）
    // 任何不在白名单中的字段（包括未来新增的字段）都会被拦截，避免字段保护失效
    const SYSTEM_AGENT_UPDATABLE_FIELDS = [
      'speechConfig',
      ...([GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID].includes(id)
        ? [
            'type',
            'acpTool',
            'proxyConfig',
            'codexModel',
            'codexFastMode',
            'claudeModel',
            'thinkingMode',
            'llmProviderId',
            'fallbackLlmProviderIds',
            'imageGeneration',
          ] as const
        : []),
    ] as const;

    const existingAgent = await prisma.agent.findUnique({
      where: { id },
      select: { agentLevel: true },
    });
    if (!existingAgent) {
      const error = new Error('助手不存在') as Error & { code?: string };
      error.code = 'P2025';
      throw error;
    }

    let effectiveData: UpdateAgentInput = data;
    if (existingAgent.agentLevel === 'system') {
      const filtered: UpdateAgentInput = {};
      for (const key of SYSTEM_AGENT_UPDATABLE_FIELDS) {
        if (key in data) {
          (filtered as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
        }
      }
      // 若调用方尝试更新白名单外的字段，直接拒绝以保持原有错误语义
      const attemptedKeys = Object.keys(data).filter(
        (k) => !(SYSTEM_AGENT_UPDATABLE_FIELDS as readonly string[]).includes(k)
      );
      if (attemptedKeys.length > 0) {
        throw new Error('系统助手不允许修改');
      }
      effectiveData = filtered;
    }

    // 处理外键字段：空字符串转换为 undefined（表示不更新），'null' 字符串转换为 null（表示移除）
    const normalizedEffectiveData: UpdateAgentInput = existingAgent.agentLevel === 'system' && effectiveData.imageGeneration
      ? {
          ...effectiveData,
          imageGeneration: {
            enabled: false,
            llmProviderId: null,
          },
        }
      : effectiveData;
    const { categoryId, llmProviderId, fallbackLlmProviderIds, speechConfig, imageGeneration, proxyConfig, codexModel, claudeModel, thinkingMode, ...restData } = normalizedEffectiveData;
    const processedCategoryId = categoryId === '' ? undefined : categoryId === 'null' ? null : categoryId;
    const processedLlmProviderId = llmProviderId === '' ? undefined : llmProviderId === 'null' ? null : llmProviderId;
    const processedFallbackLlmProviderIds = normalizeProviderIdList(fallbackLlmProviderIds);
    const serializedFallbackLlmProviderIds = serializeFallbackLlmProviderIds(processedFallbackLlmProviderIds);
    const processedProxyConfig = normalizeAgentProxyConfig(proxyConfig);
    const processedCodexModel = normalizeNullableString(codexModel);
    const processedClaudeModel = normalizeNullableString(claudeModel);
    const processedThinkingMode = normalizeAgentThinkingMode(thinkingMode);
    const currentAgent = await prisma.agent.findUnique({
      where: { id },
      select: { type: true, acpTool: true, llmProviderId: true },
    });
    if (!currentAgent) {
      const error = new Error('助手不存在') as Error & { code?: string };
      error.code = 'P2025';
      throw error;
    }
    assertAcpToolSupported(
      restData.type ?? currentAgent.type,
      restData.acpTool ?? currentAgent.acpTool,
    );
    await assertLlmProviderCompatible(
      restData.type ?? currentAgent.type,
      restData.acpTool ?? currentAgent.acpTool,
      processedLlmProviderId === undefined ? currentAgent.llmProviderId : processedLlmProviderId,
    );
    await assertFallbackLlmProvidersCompatible(
      restData.type ?? currentAgent.type,
      restData.acpTool ?? currentAgent.acpTool,
      processedFallbackLlmProviderIds,
    );
    if (imageGeneration?.enabled) {
      await assertImageProviderCompatible(imageGeneration.llmProviderId);
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id },
        data: {
          ...restData,
          ...(processedCategoryId !== undefined && { categoryId: processedCategoryId }),
          ...(processedLlmProviderId !== undefined && { llmProviderId: processedLlmProviderId }),
          ...(serializedFallbackLlmProviderIds !== undefined && { fallbackLlmProviderIds: serializedFallbackLlmProviderIds }),
          ...(processedProxyConfig !== undefined && { proxyConfig: processedProxyConfig }),
          ...(processedCodexModel !== undefined && { codexModel: processedCodexModel }),
          ...(processedClaudeModel !== undefined && { claudeModel: processedClaudeModel }),
          ...(processedThinkingMode !== undefined && { thinkingMode: processedThinkingMode }),
          ...(speechConfig !== undefined && { speechConfig: serializeAgentSpeechConfig(speechConfig) }),
          updatedAt: new Date(),
        },
      });
      if (imageGeneration) {
        await upsertImageCapability(tx, id, imageGeneration);
      }
      return tx.agent.findUniqueOrThrow({
        where: { id },
        include: agentInclude,
      });
    });
    // 系统助手字段变更可能影响群聊列表展示，主动清空缓存
    if (existingAgent.agentLevel === 'system') {
      invalidateSystemAgentsCache();
    }
    return result;
  },

  async delete(id: string): Promise<AgentWithRelations> {
    await assertAgentIsUserEditable(id, '删除');

    return prisma.agent.delete({
      where: { id },
      include: {
        ...agentInclude,
      },
    });
  },

  async setActive(id: string, isActive: boolean): Promise<AgentWithRelations> {
    await assertAgentIsUserEditable(id, '启用或停用');

    return prisma.agent.update({
      where: { id },
      data: { isActive, updatedAt: new Date() },
      include: {
        ...agentInclude,
      },
    });
  },

  // 按分类分组获取助手（包含没有助手的分类）
  async findAllGroupedByCategory(): Promise<{
    categorized: Map<string, { category: any; agents: Agent[] }>;
    uncategorized: Agent[];
  }> {
    // 先获取所有分类
    const allCategories = await prisma.agentCategory.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    // 获取所有助手
    const agents = await prisma.agent.findMany({
      where: {
        id: { notIn: HIDDEN_SYSTEM_AGENT_IDS },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        ...agentInclude,
      },
    });

    // 初始化所有分类（包括没有助手的）
    const categorized = new Map<string, { category: any; agents: Agent[] }>();
    for (const category of allCategories) {
      categorized.set(category.id, {
        category,
        agents: [],
      });
    }

    const uncategorized: Agent[] = [];

    // 将助手分配到对应分类
    for (const agent of agents) {
      if (agent.categoryId && categorized.has(agent.categoryId)) {
        categorized.get(agent.categoryId)!.agents.push(agent);
      } else {
        uncategorized.push(agent);
      }
    }

    // 对分类内的助手按 sortOrder 排序（sortOrder 越大越靠前，默认按创建时间）
    for (const [categoryId, group] of categorized) {
      group.agents.sort((a, b) => {
        const sortOrderA = a.sortOrder ?? 0;
        const sortOrderB = b.sortOrder ?? 0;
        if (sortOrderA !== sortOrderB) {
          return sortOrderB - sortOrderA;  // sortOrder 越大越靠前
        }
        // sortOrder 相同时按创建时间倒序
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    }
    // 未分类的也按 sortOrder 排序
    uncategorized.sort((a, b) => {
      const sortOrderA = a.sortOrder ?? 0;
      const sortOrderB = b.sortOrder ?? 0;
      if (sortOrderA !== sortOrderB) {
        return sortOrderB - sortOrderA;
      }
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // 对分类按 sortOrder 排序，与分类管理接口和前端拖拽保存方向保持一致
    const sortedCategorized = new Map<string, { category: any; agents: Agent[] }>();
    const entries = Array.from(categorized.entries());
    entries.sort((a, b) => {
      const sortOrderA = a[1].category.sortOrder ?? 0;
      const sortOrderB = b[1].category.sortOrder ?? 0;
      return sortOrderA - sortOrderB;
    });
    for (const [key, value] of entries) {
      sortedCategorized.set(key, value);
    }

    return { categorized: sortedCategorized, uncategorized };
  },

  // 批量更新助手排序
  async updateSortOrder(items: UpdateSortOrderInput[]): Promise<void> {
    // 使用事务批量更新
    await prisma.$transaction(
      items.map(item => {
        // 系统助手不允许修改排序
        return prisma.agent.updateMany({
          where: {
            id: item.id,
            agentLevel: 'normal',  // 只更新普通助手
          },
          data: {
            sortOrder: item.sortOrder,
            ...(item.categoryId !== undefined && { categoryId: item.categoryId }),
            updatedAt: new Date(),
          },
        });
      })
    );
  },
};
