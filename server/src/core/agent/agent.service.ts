import prisma from '../../lib/prisma.js';
import { Agent, AgentType, LlmProvider, AgentCategory, AgentLevel } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  type AgentSpeechConfig,
  serializeAgentSpeechConfig,
} from '../../modules/speech/speech-config.js';

// 包含关联的 Agent 类型
export type AgentWithRelations = Agent & {
  category: AgentCategory | null;
  llmProvider: LlmProvider | null;
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
  categoryId?: string;
  llmProviderId?: string;
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
    select: { apiProtocol: true, name: true },
  });
  if (!provider) {
    const error = new Error('LLM 供应商不存在') as Error & { code?: string };
    error.code = 'P2025';
    throw error;
  }
  if (provider.apiProtocol !== requiredProtocol) {
    const label = acpTool === 'claude' ? 'Claude' : 'Codex';
    throw new Error(`${label} 仅支持 ${requiredProtocol} 协议供应商，当前供应商 ${provider.name} 的协议是 ${provider.apiProtocol}`);
  }
}

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
    const agentType = data.type || 'builtin';
    assertAcpToolSupported(agentType, data.acpTool);
    await assertLlmProviderCompatible(agentType, data.acpTool, llmProviderId);

    return prisma.agent.create({
      data: {
        id: data.id || randomUUID(), // 使用自定义 ID 或生成新 ID
        name: data.name,
        avatar: data.avatar,
        avatarColor: data.avatarColor,
        description: data.description,
        prompt: data.prompt,
        type: agentType,
        agentLevel: data.agentLevel || 'normal',
        acpTool: data.acpTool,
        workDir: data.workDir,
        categoryId,
        llmProviderId,
        speechConfig: serializeAgentSpeechConfig(data.speechConfig),
        updatedAt: now,
      },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async findAll(): Promise<AgentWithRelations[]> {
    return prisma.agent.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async findActive(): Promise<AgentWithRelations[]> {
    return prisma.agent.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async findById(id: string): Promise<AgentWithRelations | null> {
    return prisma.agent.findUnique({
      where: { id },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async findByName(name: string): Promise<AgentWithRelations | null> {
    return prisma.agent.findUnique({
      where: { name },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async update(id: string, data: UpdateAgentInput): Promise<AgentWithRelations> {
    // 处理外键字段：空字符串转换为 undefined（表示不更新），'null' 字符串转换为 null（表示移除）
    const { categoryId, llmProviderId, speechConfig, ...restData } = data;

    // speechConfig 是本机展示偏好，系统助手也允许修改；其他字段仍受保护
    const hasNonVoiceFields =
      Object.keys(restData).length > 0 ||
      categoryId !== undefined ||
      llmProviderId !== undefined;
    if (hasNonVoiceFields) {
      await assertAgentIsUserEditable(id, '修改');
    }
    const processedCategoryId = categoryId === '' ? undefined : categoryId === 'null' ? null : categoryId;
    const processedLlmProviderId = llmProviderId === '' ? undefined : llmProviderId === 'null' ? null : llmProviderId;
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

    return prisma.agent.update({
      where: { id },
      data: {
        ...restData,
        ...(processedCategoryId !== undefined && { categoryId: processedCategoryId }),
        ...(processedLlmProviderId !== undefined && { llmProviderId: processedLlmProviderId }),
        ...(speechConfig !== undefined && { speechConfig: serializeAgentSpeechConfig(speechConfig) }),
        updatedAt: new Date(),
      },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async delete(id: string): Promise<AgentWithRelations> {
    await assertAgentIsUserEditable(id, '删除');

    return prisma.agent.delete({
      where: { id },
      include: {
        category: true,
        llmProvider: true,
      },
    });
  },

  async setActive(id: string, isActive: boolean): Promise<AgentWithRelations> {
    await assertAgentIsUserEditable(id, '启用或停用');

    return prisma.agent.update({
      where: { id },
      data: { isActive, updatedAt: new Date() },
      include: {
        category: true,
        llmProvider: true,
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
      orderBy: { sortOrder: 'desc' },
    });

    // 获取所有助手
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        llmProvider: true,
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

    // 对分类按 sortOrder 排序，系统分类（sortOrder = -1000）放最后
    const sortedCategorized = new Map<string, { category: any; agents: Agent[] }>();
    const entries = Array.from(categorized.entries());
    entries.sort((a, b) => {
      const sortOrderA = a[1].category.sortOrder ?? 0;
      const sortOrderB = b[1].category.sortOrder ?? 0;
      // sortOrder 越大越靠前，系统分类 -1000 放最后
      return sortOrderB - sortOrderA;
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
