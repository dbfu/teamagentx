import prisma from '../../lib/prisma.js';

export interface TokenUsageStats {
  llmProviderId: string;
  llmProviderName: string;
  llmProviderType: string;
  llmProviderModel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  executionCount: number;
}

export interface TokenUsageByProvider {
  provider: {
    id: string;
    name: string;
    type: string;
    model: string;
  };
  stats: TokenUsageStats;
}

export interface DailyTokenUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  executionCount: number;
}

export interface AgentTokenUsage {
  agentId: string;
  agentName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  executionCount: number;
}

class TokenUsageService {
  /**
   * 获取所有 LLM Provider 的 token 使用统计
   */
  async getUsageByProvider(
    startDate?: Date,
    endDate?: Date
  ): Promise<TokenUsageByProvider[]> {
    const whereClause: any = {
      llmProviderId: { not: null },
    };

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = startDate;
      if (endDate) whereClause.createdAt.lte = endDate;
    }

    const records = await prisma.executionRecord.findMany({
      where: whereClause,
      select: {
        llmProviderId: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
      },
    });

    // 获取所有 Provider 信息
    const providers = await prisma.llmProvider.findMany();
    const providerMap = new Map(providers.map((p) => [p.id, p]));

    // 按 llmProviderId 分组统计
    const grouped = new Map<string, {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      totalCacheReadTokens: number;
      totalCacheCreationTokens: number;
      executionCount: number;
    }>();

    for (const record of records) {
      if (!record.llmProviderId) continue;

      const existing = grouped.get(record.llmProviderId) || {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        executionCount: 0,
      };

      existing.totalInputTokens += record.inputTokens || 0;
      existing.totalOutputTokens += record.outputTokens || 0;
      existing.totalTokens += record.totalTokens || 0;
      existing.totalCacheReadTokens += record.cacheReadTokens || 0;
      existing.totalCacheCreationTokens += record.cacheCreationTokens || 0;
      existing.executionCount += 1;

      grouped.set(record.llmProviderId, existing);
    }

    // 构建结果
    return Array.from(grouped.entries()).map(([id, stats]) => {
      const provider = providerMap.get(id);
      return {
        provider: {
          id,
          name: provider?.name || 'Unknown',
          type: provider?.type || 'unknown',
          model: provider?.model || 'unknown',
        },
        stats: {
          llmProviderId: id,
          llmProviderName: provider?.name || 'Unknown',
          llmProviderType: provider?.type || 'unknown',
          llmProviderModel: provider?.model || 'unknown',
          ...stats,
        },
      };
    }).sort((a, b) => b.stats.totalTokens - a.stats.totalTokens);
  }

  /**
   * 获取每日 token 使用趋势
   */
  async getDailyUsage(
    llmProviderId?: string,
    startDate?: Date,
    endDate?: Date,
    days: number = 30
  ): Promise<DailyTokenUsage[]> {
    const effectiveStartDate = startDate || new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const effectiveEndDate = endDate || new Date();

    const whereClause: any = {
      createdAt: {
        gte: effectiveStartDate,
        lte: effectiveEndDate,
      },
    };
    if (llmProviderId) whereClause.llmProviderId = llmProviderId;

    const records = await prisma.executionRecord.findMany({
      where: whereClause,
      select: {
        createdAt: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    });

    // 按日期分组
    const dailyMap = new Map<string, DailyTokenUsage>();

    for (const record of records) {
      const dateKey = record.createdAt.toISOString().split('T')[0];

      const existing = dailyMap.get(dateKey) || {
        date: dateKey,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        executionCount: 0,
      };

      existing.inputTokens += record.inputTokens || 0;
      existing.outputTokens += record.outputTokens || 0;
      existing.totalTokens += record.totalTokens || 0;
      existing.executionCount += 1;

      dailyMap.set(dateKey, existing);
    }

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * 获取按 Agent 分组的 token 使用统计
   */
  async getUsageByAgent(
    llmProviderId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AgentTokenUsage[]> {
    const whereClause: any = {};

    if (llmProviderId) whereClause.llmProviderId = llmProviderId;
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = startDate;
      if (endDate) whereClause.createdAt.lte = endDate;
    }

    const records = await prisma.executionRecord.findMany({
      where: whereClause,
      select: {
        agentId: true,
        agentName: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    });

    // 按 agentId 分组
    const grouped = new Map<string, AgentTokenUsage>();

    for (const record of records) {
      const existing = grouped.get(record.agentId) || {
        agentId: record.agentId,
        agentName: record.agentName,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        executionCount: 0,
      };

      existing.totalInputTokens += record.inputTokens || 0;
      existing.totalOutputTokens += record.outputTokens || 0;
      existing.totalTokens += record.totalTokens || 0;
      existing.executionCount += 1;

      grouped.set(record.agentId, existing);
    }

    return Array.from(grouped.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  }

  /**
   * 获取单个 Provider 的详细使用情况（包含 Agent 分布）
   */
  async getProviderDetail(
    llmProviderId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    provider: {
      id: string;
      name: string;
      type: string;
      model: string;
    };
    totalStats: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      executionCount: number;
    };
    agentBreakdown: AgentTokenUsage[];
    recentExecutions: Array<{
      id: string;
      agentName: string;
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
      createdAt: string;
    }>;
  }> {
    // 获取 Provider 信息
    const provider = await prisma.llmProvider.findUnique({
      where: { id: llmProviderId },
    });

    if (!provider) {
      throw new Error(`Provider not found: ${llmProviderId}`);
    }

    const whereClause: any = { llmProviderId };

    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) whereClause.createdAt.gte = startDate;
      if (endDate) whereClause.createdAt.lte = endDate;
    }

    // 获取所有记录
    const records = await prisma.executionRecord.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        agentId: true,
        agentName: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        createdAt: true,
      },
    });

    // 计算总统计
    const totalStats = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      executionCount: 0,
    };

    // Agent 分组
    const agentMap = new Map<string, AgentTokenUsage>();

    for (const record of records) {
      totalStats.inputTokens += record.inputTokens || 0;
      totalStats.outputTokens += record.outputTokens || 0;
      totalStats.totalTokens += record.totalTokens || 0;
      totalStats.cacheReadTokens += record.cacheReadTokens || 0;
      totalStats.cacheCreationTokens += record.cacheCreationTokens || 0;
      totalStats.executionCount += 1;

      const existing = agentMap.get(record.agentId) || {
        agentId: record.agentId,
        agentName: record.agentName,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        executionCount: 0,
      };

      existing.totalInputTokens += record.inputTokens || 0;
      existing.totalOutputTokens += record.outputTokens || 0;
      existing.totalTokens += record.totalTokens || 0;
      existing.executionCount += 1;

      agentMap.set(record.agentId, existing);
    }

    return {
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        model: provider.model,
      },
      totalStats,
      agentBreakdown: Array.from(agentMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
      recentExecutions: records.slice(0, 10).map((r) => ({
        id: r.id,
        agentName: r.agentName,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        totalTokens: r.totalTokens,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * 格式化 token 数量（用于显示）
   */
  formatTokens(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return String(num);
  }
}

export const tokenUsageService = new TokenUsageService();