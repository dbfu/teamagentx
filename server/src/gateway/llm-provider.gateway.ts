import { FastifyInstance } from 'fastify';
import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';

// 所有支持的 LLM 供应商类型 - 仅支持自定义
const LLM_PROVIDER_TYPES = ['custom'] as const;

// JSON Schema for response
const llmProviderResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    apiUrl: { type: 'string', nullable: true },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    isActive: { type: 'boolean' },
    isDefault: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const llmProviderWithCountResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    apiUrl: { type: 'string', nullable: true },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    isActive: { type: 'boolean' },
    isDefault: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    _count: {
      type: 'object',
      properties: {
        agents: { type: 'integer' },
      },
    },
  },
};

const createLlmProviderBodySchema = {
  type: 'object',
  required: ['name', 'apiKey', 'model'],
  properties: {
    name: { type: 'string', description: '供应商名称（唯一）' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES, description: '供应商类型' },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'], description: 'API 协议类型' },
    apiUrl: { type: 'string', description: 'API URL（可选，用于自定义供应商）' },
    apiKey: { type: 'string', description: 'API Key' },
    model: { type: 'string', description: '模型名称' },
    isActive: { type: 'boolean', description: '是否激活' },
    isDefault: { type: 'boolean', description: '是否为默认供应商' },
  },
};

const updateLlmProviderBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    apiUrl: { type: 'string' },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    isActive: { type: 'boolean' },
    isDefault: { type: 'boolean' },
  },
};

const setStatusBodySchema = {
  type: 'object',
  required: ['isActive'],
  properties: {
    isActive: { type: 'boolean', description: '是否激活' },
  },
};

export type LlmProviderType = typeof LLM_PROVIDER_TYPES[number];

interface CreateLlmProviderBody {
  name: string;
  type?: LlmProviderType;
  apiProtocol?: 'anthropic' | 'openai';
  apiUrl?: string;
  apiKey: string;
  model: string;
  isActive?: boolean;
  isDefault?: boolean;
}

interface UpdateLlmProviderBody {
  name?: string;
  type?: LlmProviderType;
  apiProtocol?: 'anthropic' | 'openai';
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

interface SetStatusBody {
  isActive: boolean;
}

interface LlmProviderParams {
  id: string;
}

export async function llmProviderGateway(app: FastifyInstance) {
  // 获取所有供应商列表
  app.get(
    '/llm-providers',
    {
      schema: {
        description: '获取所有 LLM 供应商列表',
        tags: ['LlmProviders'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: llmProviderWithCountResponseSchema },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const providers = await llmProviderService.findAll();
      return reply.send({ success: true, data: providers });
    }
  );

  // 获取单个供应商
  app.get<{ Params: LlmProviderParams }>(
    '/llm-providers/:id',
    {
      schema: {
        description: '根据 ID 获取单个 LLM 供应商',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['anthropic', 'openai', 'deepseek', 'custom'] },
                  apiUrl: { type: 'string', nullable: true },
                  apiKey: { type: 'string' },
                  model: { type: 'string' },
                  isActive: { type: 'boolean' },
                  isDefault: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  agents: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        avatar: { type: 'string', nullable: true },
                        avatarColor: { type: 'string', nullable: true },
                        description: { type: 'string', nullable: true },
                        isActive: { type: 'boolean' },
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
      const provider = await llmProviderService.findById(id);

      if (!provider) {
        return reply.code(404).send({ success: false, error: 'LLM 供应商不存在' });
      }

      return reply.send({ success: true, data: provider });
    }
  );

  // 创建供应商
  app.post<{ Body: CreateLlmProviderBody }>(
    '/llm-providers',
    {
      schema: {
        description: '创建新的 LLM 供应商',
        tags: ['LlmProviders'],
        body: createLlmProviderBodySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: llmProviderResponseSchema,
            },
          },
          409: {
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
      const { name, type, apiProtocol, apiUrl, apiKey, model, isActive, isDefault } = request.body;

      try {
        const provider = await llmProviderService.create({
          name,
          type,
          apiProtocol,
          apiUrl,
          apiKey,
          model,
          isActive,
          isDefault,
        });
        return reply.code(201).send({ success: true, data: provider });
      } catch (error: any) {
        if (error.code === 'P2002') {
          return reply
            .code(409)
            .send({ success: false, error: 'LLM 供应商名称已存在' });
        }
        throw error;
      }
    }
  );

  // 更新供应商
  app.put<{ Params: LlmProviderParams; Body: UpdateLlmProviderBody }>(
    '/llm-providers/:id',
    {
      schema: {
        description: '更新 LLM 供应商信息',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: updateLlmProviderBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: llmProviderResponseSchema,
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          409: {
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
      const data = request.body;

      try {
        const provider = await llmProviderService.update(id, data);
        return reply.send({ success: true, data: provider });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: 'LLM 供应商不存在' });
        }
        if (error.code === 'P2002') {
          return reply
            .code(409)
            .send({ success: false, error: 'LLM 供应商名称已存在' });
        }
        throw error;
      }
    }
  );

  // 删除供应商
  app.delete<{ Params: LlmProviderParams }>(
    '/llm-providers/:id',
    {
      schema: {
        description: '删除 LLM 供应商',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: llmProviderResponseSchema,
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

      try {
        const provider = await llmProviderService.delete(id);
        return reply.send({ success: true, data: provider });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: 'LLM 供应商不存在' });
        }
        throw error;
      }
    }
  );

  // 激活/停用供应商
  app.patch<{ Params: LlmProviderParams; Body: SetStatusBody }>(
    '/llm-providers/:id/status',
    {
      schema: {
        description: '激活或停用 LLM 供应商',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: setStatusBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: llmProviderResponseSchema,
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
      const { isActive } = request.body;

      try {
        const provider = await llmProviderService.setActive(id, isActive);
        return reply.send({ success: true, data: provider });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: 'LLM 供应商不存在' });
        }
        throw error;
      }
    }
  );

  // 设为默认供应商
  app.patch<{ Params: LlmProviderParams }>(
    '/llm-providers/:id/default',
    {
      schema: {
        description: '将 LLM 供应商设为默认',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: llmProviderResponseSchema,
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

      try {
        const provider = await llmProviderService.setDefault(id);
        return reply.send({ success: true, data: provider });
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: 'LLM 供应商不存在' });
        }
        throw error;
      }
    }
  );

  // 测试供应商连接
  app.post<{ Params: LlmProviderParams }>(
    '/llm-providers/:id/test',
    {
      schema: {
        description: '测试 LLM 供应商连接是否正常',
        tags: ['LlmProviders'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  connected: { type: 'boolean' },
                  message: { type: 'string' },
                  model: { type: 'string' },
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

      try {
        const provider = await llmProviderService.findById(id);
        if (!provider) {
          return reply.code(404).send({ success: false, error: 'LLM 供应商不存在' });
        }

        // 根据 apiProtocol 创建对应的客户端
        const apiProtocol = (provider as any).apiProtocol || 'anthropic';
        let model: ChatAnthropic | ChatOpenAI;

        if (apiProtocol === 'anthropic') {
          model = new ChatAnthropic({
            model: provider.model,
            apiKey: provider.apiKey,
            maxTokens: 10,
            ...(provider.apiUrl && { anthropicApiUrl: provider.apiUrl }),
          });
        } else {
          model = new ChatOpenAI({
            model: provider.model,
            apiKey: provider.apiKey,
            maxTokens: 10,
            ...(provider.apiUrl && { configuration: { baseURL: provider.apiUrl } }),
          });
        }

        // 发送简单的测试请求
        const response = await model.invoke('Hi');

        return reply.send({
          success: true,
          data: {
            connected: true,
            message: '连接成功',
            model: provider.model,
          },
        });
      } catch (error: any) {
        console.error('LLM connection test error:', error);

        // 解析错误信息
        let errorMessage = '连接失败';
        if (error.message) {
          if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            errorMessage = 'API Key 无效或已过期';
          } else if (error.message.includes('403') || error.message.includes('PermissionDenied')) {
            errorMessage = 'API Key 权限不足或模型不可用';
          } else if (error.message.includes('404') || error.message.includes('not found')) {
            errorMessage = '模型不存在或 API URL 错误';
          } else if (error.message.includes('429') || error.message.includes('rate limit')) {
            errorMessage = '请求频率超限，请稍后再试';
          } else if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
            errorMessage = '网络连接失败，请检查 API URL';
          } else {
            errorMessage = error.message.slice(0, 100);
          }
        }

        return reply.send({
          success: true,
          data: {
            connected: false,
            message: errorMessage,
            model: request.params?.id || '',
          },
        });
      }
    }
  );

  // AI 解析模型配置描述
  app.post<{ Body: { description: string } }>(
    '/llm-providers/parse-config',
    {
      schema: {
        description: '使用 AI 解析用户输入的模型配置描述，返回结构化配置信息',
        tags: ['LlmProviders'],
        body: {
          type: 'object',
          required: ['description'],
          properties: {
            description: { type: 'string', description: '用户的模型配置描述' },
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
                  name: { type: 'string', nullable: true },
                  apiUrl: { type: 'string', nullable: true },
                  apiKey: { type: 'string', nullable: true },
                  model: { type: 'string', nullable: true },
                  apiProtocol: { type: 'string', enum: ['anthropic', 'openai'], nullable: true },
                },
              },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { description } = request.body;

      if (!description || description.trim().length < 10) {
        return reply.send({
          success: false,
          error: '请提供更详细的配置描述',
        });
      }

      const result = await llmProviderService.parseConfigDescription(description);

      if ('error' in result) {
        return reply.send({
          success: false,
          error: result.error,
        });
      }

      return reply.send({
        success: true,
        data: result,
      });
    }
  );
}