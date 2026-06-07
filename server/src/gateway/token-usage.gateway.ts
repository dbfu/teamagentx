import { FastifyInstance } from 'fastify';
import { tokenUsageService } from '../modules/token-usage/token-usage.service.js';

interface UsageQueryParams {
  startDate?: string;
  endDate?: string;
  llmProviderId?: string;
  agentId?: string;
  days?: number;
}

interface ProviderParams {
  id: string;
}

const tokenStatsSchema = {
  type: 'object',
  properties: {
    llmProviderId: { type: 'string' },
    llmProviderName: { type: 'string' },
    llmProviderType: { type: 'string' },
    llmProviderModel: { type: 'string' },
    totalInputTokens: { type: 'integer' },
    totalOutputTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    totalCacheReadTokens: { type: 'integer' },
    totalCacheCreationTokens: { type: 'integer' },
    executionCount: { type: 'integer' },
  },
};

const providerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string' },
    model: { type: 'string' },
  },
};

const dailyUsageSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    inputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    executionCount: { type: 'integer' },
  },
};

const agentUsageSchema = {
  type: 'object',
  properties: {
    agentId: { type: 'string' },
    agentName: { type: 'string' },
    totalInputTokens: { type: 'integer' },
    totalOutputTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    executionCount: { type: 'integer' },
  },
};

export async function tokenUsageGateway(app: FastifyInstance) {
  // 获取所有 Provider 的 token 使用统计
  app.get<{ Querystring: UsageQueryParams }>(
    '/token-usage/by-provider',
    {
      schema: {
        description: '获取所有 LLM Provider 的 token 使用统计',
        tags: ['TokenUsage'],
        querystring: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: '开始日期 (ISO格式)' },
            endDate: { type: 'string', description: '结束日期 (ISO格式)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    provider: providerSchema,
                    stats: tokenStatsSchema,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { startDate, endDate } = request.query;

      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;

      const data = await tokenUsageService.getUsageByProvider(start, end);
      return reply.send({ success: true, data });
    }
  );

  // 获取每日 token 使用趋势
  app.get<{ Querystring: UsageQueryParams }>(
    '/token-usage/daily',
    {
      schema: {
        description: '获取每日 token 使用趋势',
        tags: ['TokenUsage'],
        querystring: {
          type: 'object',
          properties: {
            llmProviderId: { type: 'string', description: 'LLM Provider ID' },
            startDate: { type: 'string', description: '开始日期 (ISO格式)' },
            endDate: { type: 'string', description: '结束日期 (ISO格式)' },
            days: { type: 'integer', default: 30, description: '查询天数' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: dailyUsageSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { llmProviderId, startDate, endDate, days } = request.query;

      const data = await tokenUsageService.getDailyUsage(
        llmProviderId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined,
        days || 30
      );
      return reply.send({ success: true, data });
    }
  );

  // 获取按 Agent 分组的 token 使用统计
  app.get<{ Querystring: UsageQueryParams }>(
    '/token-usage/by-agent',
    {
      schema: {
        description: '获取按 Agent 分组的 token 使用统计',
        tags: ['TokenUsage'],
        querystring: {
          type: 'object',
          properties: {
            llmProviderId: { type: 'string', description: 'LLM Provider ID' },
            startDate: { type: 'string', description: '开始日期 (ISO格式)' },
            endDate: { type: 'string', description: '结束日期 (ISO格式)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: agentUsageSchema,
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { llmProviderId, startDate, endDate } = request.query;

      const data = await tokenUsageService.getUsageByAgent(
        llmProviderId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );
      return reply.send({ success: true, data });
    }
  );

  // 获取单个 Provider 的详细使用情况
  app.get<{ Params: ProviderParams; Querystring: UsageQueryParams }>(
    '/token-usage/provider/:id/detail',
    {
      schema: {
        description: '获取单个 Provider 的详细使用情况',
        tags: ['TokenUsage'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', description: 'LLM Provider ID' } },
        },
        querystring: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: '开始日期 (ISO格式)' },
            endDate: { type: 'string', description: '结束日期 (ISO格式)' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  provider: providerSchema,
                  totalStats: {
                    type: 'object',
                    properties: {
                      inputTokens: { type: 'integer' },
                      outputTokens: { type: 'integer' },
                      totalTokens: { type: 'integer' },
                      cacheReadTokens: { type: 'integer' },
                      cacheCreationTokens: { type: 'integer' },
                      executionCount: { type: 'integer' },
                    },
                  },
                  agentBreakdown: {
                    type: 'array',
                    items: agentUsageSchema,
                  },
                  recentExecutions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        agentName: { type: 'string' },
                        inputTokens: { type: 'integer' },
                        outputTokens: { type: 'integer' },
                        totalTokens: { type: 'integer' },
                        createdAt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { startDate, endDate } = request.query;

      try {
        const data = await tokenUsageService.getProviderDetail(
          id,
          startDate ? new Date(startDate) : undefined,
          endDate ? new Date(endDate) : undefined
        );
        return reply.send({ success: true, data });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          return reply.code(404).send({ success: false, error: error.message });
        }
        throw error;
      }
    }
  );
}