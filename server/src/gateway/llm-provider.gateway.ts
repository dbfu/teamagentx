import { FastifyInstance } from 'fastify';
import { createLlmClient } from '../lib/llm-client.js';
import { isMaskedApiKey, llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { clearExecutorCache } from '../core/agent/agent-handler/index.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authService } from '../modules/auth/auth.service.js';

// 所有支持的 LLM 供应商类型 - 仅支持自定义
const LLM_PROVIDER_TYPES = ['custom'] as const;
const LLM_MODEL_TYPES = ['text', 'image', 'video', 'audio'] as const;
const IMAGE_GEN_API_TYPES = ['sync', 'async', 'auto'] as const;

function clearProviderDependentExecutors() {
  clearExecutorCache();
}

// JSON Schema for response
const llmProviderResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES },
    modelType: { type: 'string', enum: LLM_MODEL_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    codexWireApi: { type: 'string', enum: ['responses', 'chat'] },
    apiUrl: { type: 'string', nullable: true },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    sttModel: { type: 'string', nullable: true },
    audioUsage: { type: 'string', nullable: true },
    imageProvider: { type: 'string', nullable: true },
    imageApiType: { type: 'string', enum: [...IMAGE_GEN_API_TYPES, null], nullable: true },
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
    modelType: { type: 'string', enum: LLM_MODEL_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    codexWireApi: { type: 'string', enum: ['responses', 'chat'] },
    apiUrl: { type: 'string', nullable: true },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    sttModel: { type: 'string', nullable: true },
    audioUsage: { type: 'string', nullable: true },
    imageProvider: { type: 'string', nullable: true },
    imageApiType: { type: 'string', enum: [...IMAGE_GEN_API_TYPES, null], nullable: true },
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
    modelType: { type: 'string', enum: LLM_MODEL_TYPES, description: '模型类型：文本、图片、视频或语音' },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'], description: 'API 协议类型' },
    codexWireApi: { type: 'string', enum: ['responses', 'chat'], description: 'Codex wire API：chat 表示该 openai 供应商仅支持 Chat Completions，启用路由转换' },
    apiUrl: { type: 'string', description: 'API URL（可选，用于自定义供应商）' },
    apiKey: { type: 'string', description: 'API Key' },
    model: { type: 'string', description: '模型名称（TTS 朗读模型）' },
    sttModel: { type: 'string', nullable: true, description: '语音识别模型（留空则与 model 共用）' },
    audioUsage: { type: 'string', nullable: true, description: '语音用途：tts | stt | both' },
    imageProvider: { type: 'string', nullable: true, description: '图片模型供应商类型，例如 openai、apimart、openrouter、gemini' },
    imageApiType: { type: 'string', enum: [...IMAGE_GEN_API_TYPES, null], nullable: true, description: '图片模型调用方式' },
    isActive: { type: 'boolean', description: '是否激活' },
    isDefault: { type: 'boolean', description: '是否为默认供应商' },
  },
};

const updateLlmProviderBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    type: { type: 'string', enum: LLM_PROVIDER_TYPES },
    modelType: { type: 'string', enum: LLM_MODEL_TYPES },
    apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
    codexWireApi: { type: 'string', enum: ['responses', 'chat'] },
    apiUrl: { type: 'string' },
    apiKey: { type: 'string' },
    model: { type: 'string' },
    sttModel: { type: 'string', nullable: true },
    audioUsage: { type: 'string', nullable: true },
    imageProvider: { type: 'string', nullable: true },
    imageApiType: { type: 'string', enum: [...IMAGE_GEN_API_TYPES, null], nullable: true },
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
export type LlmModelType = typeof LLM_MODEL_TYPES[number];
export type ImageGenApiType = typeof IMAGE_GEN_API_TYPES[number];

interface CreateLlmProviderBody {
  name: string;
  type?: LlmProviderType;
  modelType?: LlmModelType;
  apiProtocol?: 'anthropic' | 'openai';
  codexWireApi?: 'responses' | 'chat';
  apiUrl?: string;
  apiKey: string;
  model: string;
  sttModel?: string | null;
  audioUsage?: string | null;
  imageProvider?: string | null;
  imageApiType?: ImageGenApiType | null;
  isActive?: boolean;
  isDefault?: boolean;
}

interface UpdateLlmProviderBody {
  name?: string;
  type?: LlmProviderType;
  modelType?: LlmModelType;
  apiProtocol?: 'anthropic' | 'openai';
  codexWireApi?: 'responses' | 'chat';
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  sttModel?: string | null;
  audioUsage?: string | null;
  imageProvider?: string | null;
  imageApiType?: ImageGenApiType | null;
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

  // #3: 鉴权检查（参考 speech.gateway.ts 模式）
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
      return false;
    }
    const user = await authService.getUserFromToken(token);
    if (!user) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // #4: API Key 掩码（返回给客户端时使用）
  function maskApiKey(apiKey: string): string {
    if (apiKey.length > 8) {
      return `${apiKey.slice(0, 3)}***${apiKey.slice(-4)}`;
    }
    return '****';
  }

  // #2: apiUrl 格式校验（写入时调用）
  function validateApiUrl(apiUrl: string | null | undefined): void {
    if (!apiUrl) return; // 允许为空
    let parsed: URL;
    try {
      parsed = new URL(apiUrl);
    } catch {
      throw new Error('apiUrl 格式无效，请输入合法的 HTTP/HTTPS 地址');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('apiUrl 协议不支持，仅允许 http 或 https');
    }
  }

  function createSilentWavBlob(durationMs = 300): Blob {
    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const frameCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
    const dataSize = frameCount * channels * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataSize, true);

    return new Blob([buffer], { type: 'audio/wav' });
  }

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
    async (request, reply) => {
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const providers = await llmProviderService.findAll();
      // #4: API Key 掩码
      const masked = providers.map((p: any) => ({ ...p, apiKey: maskApiKey(p.apiKey) }));
      return reply.send({ success: true, data: masked });
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
                  type: { type: 'string', enum: LLM_PROVIDER_TYPES },
                  modelType: { type: 'string', enum: LLM_MODEL_TYPES },
                  apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
                  apiUrl: { type: 'string', nullable: true },
                  apiKey: { type: 'string' },
                  model: { type: 'string' },
                  imageProvider: { type: 'string', nullable: true },
                  imageApiType: { type: 'string', enum: [...IMAGE_GEN_API_TYPES, null], nullable: true },
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;
      const provider = await llmProviderService.findById(id);

      if (!provider) {
        return reply.code(404).send({ success: false, error: 'LLM 供应商不存在' });
      }

      // #4: API Key 掩码
      return reply.send({ success: true, data: { ...(provider as any), apiKey: maskApiKey((provider as any).apiKey) } });
    }
  );

  // 导出供应商（返回完整 API Key，前端需用户确认知晓风险后调用）
  app.post<{ Body: { ids?: string[] } }>(
    '/llm-providers/export',
    {
      schema: {
        description: '导出 LLM 供应商配置（含完整 API Key）',
        tags: ['LlmProviders'],
        body: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' } },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: llmProviderResponseSchema },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const ids = Array.isArray(request.body?.ids) ? request.body.ids : undefined;
      const providers = await llmProviderService.findForExport(ids);
      // 注意：此处返回完整未脱敏的 apiKey，仅用于配置导出
      return reply.send({ success: true, data: providers });
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { name, type, modelType, apiProtocol, codexWireApi, apiUrl, apiKey, model, sttModel, audioUsage, imageProvider, imageApiType, isActive, isDefault } = request.body;

      // #2: apiUrl 格式校验
      try {
        validateApiUrl(apiUrl);
      } catch (err: any) {
        return reply.code(400).send({ success: false, error: err.message });
      }
      if (isMaskedApiKey(apiKey)) {
        return reply.code(400).send({ success: false, error: '请填写完整 API Key，不能使用已遮罩的密钥' });
      }

      try {
        const provider = await llmProviderService.create({
          name,
          type,
          modelType,
          apiProtocol,
          codexWireApi,
          apiUrl,
          apiKey,
          model,
          sttModel,
          audioUsage,
          imageProvider,
          imageApiType,
          isActive,
          isDefault,
        });
        clearProviderDependentExecutors();
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;
      const data = request.body;

      // #2: apiUrl 格式校验
      if ('apiUrl' in data) {
        try {
          validateApiUrl(data.apiUrl as string | null | undefined);
        } catch (err: any) {
          return reply.code(400).send({ success: false, error: err.message });
        }
      }

      try {
        const provider = await llmProviderService.update(id, data);
        clearProviderDependentExecutors();
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;

      try {
        const provider = await llmProviderService.delete(id);
        clearProviderDependentExecutors();
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;
      const { isActive } = request.body;

      try {
        const provider = await llmProviderService.setActive(id, isActive);
        clearProviderDependentExecutors();
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;

      try {
        const provider = await llmProviderService.setDefault(id);
        clearProviderDependentExecutors();
        return reply.send({ success: true, data: provider });
      } catch (error: any) {
        if (error instanceof Error && error.message.includes('默认 STT')) {
          return reply
            .code(400)
            .send({ success: false, error: error.message });
        }
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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
      const { id } = request.params;

      try {
        const provider = await llmProviderService.findById(id);
        if (!provider) {
          return reply.code(404).send({ success: false, error: 'LLM 供应商不存在' });
        }

        // #2: test 端点也校验 apiUrl
        try {
          validateApiUrl((provider as any).apiUrl);
        } catch (err: any) {
          return reply.send({ success: true, data: { connected: false, message: err.message, model: (provider as any).model } });
        }

        if ((provider as any).modelType === 'image') {
          return reply.send({
            success: true,
            data: {
              connected: true,
              message: '图片模型配置已保存，实际生成时将验证接口',
              model: provider.model,
            },
          });
        }

        if ((provider as any).modelType === 'audio') {
          const base = ((provider.apiUrl as string) || 'https://api.openai.com/v1').replace(/\/+$/, '');
          const ttsModel = provider.model;
          const sttModel = (provider as any).sttModel || provider.model;
          const ttsVoice = base.toLowerCase().includes('siliconflow') && ttsModel === 'FunAudioLLM/CosyVoice2-0.5B'
            ? `${ttsModel}:anna`
            : 'alloy';

          async function testAudioEndpoint(
            endpoint: string,
            body: BodyInit,
            headers: Record<string, string>,
            options: { acceptBadRequestAsReachable?: boolean } = {},
          ): Promise<{ ok: boolean; message: string }> {
            try {
              const resp = await fetch(endpoint, {
                method: 'POST',
                headers,
                body,
                signal: AbortSignal.timeout(10_000),
              });
              if (resp.ok) return { ok: true, message: '连接成功' };
              const status = resp.status;
              const text = await resp.text().catch(() => '');
              if (status === 401) return { ok: false, message: 'API Key 无效或已过期' };
              if (status === 403) return { ok: false, message: 'API Key 权限不足或模型不可用' };
              if (status === 404) return { ok: false, message: '模型不存在或 API URL 错误' };
              if (status === 429) return { ok: false, message: '请求频率超限' };
              if ((status === 400 || status === 422) && options.acceptBadRequestAsReachable) {
                return { ok: true, message: '接口可达，样例参数未通过供应商校验' };
              }
              return { ok: false, message: text ? `请求失败 (${status}): ${text.slice(0, 120)}` : `请求失败 (${status})` };
            } catch (err: any) {
              return { ok: false, message: err?.message?.includes('timeout') ? '连接超时' : '网络请求失败' };
            }
          }

          const ttsResult = await testAudioEndpoint(
            base.endsWith('/audio/speech') ? base : `${base}/audio/speech`,
            JSON.stringify({ model: ttsModel, input: '你好', voice: ttsVoice }),
            { 'Authorization': `Bearer ${provider!.apiKey}`, 'Content-Type': 'application/json' },
            { acceptBadRequestAsReachable: true },
          );
          const sttForm = new FormData();
          sttForm.append('file', createSilentWavBlob(), 'test.wav');
          sttForm.append('model', sttModel);
          sttForm.append('response_format', 'json');
          const sttResult = await testAudioEndpoint(
            base.endsWith('/audio/transcriptions') ? base : `${base}/audio/transcriptions`,
            sttForm,
            { 'Authorization': `Bearer ${provider!.apiKey}` },
            { acceptBadRequestAsReachable: true },
          );

          const connected = ttsResult.ok || sttResult.ok;
          const parts: string[] = [];
          parts.push(`TTS: ${ttsResult.ok ? '✓' : '✗ ' + ttsResult.message}`);
          parts.push(`STT: ${sttResult.ok ? '✓' : '✗ ' + sttResult.message}`);
          return reply.send({
            success: true,
            data: { connected, message: parts.join(' | '), model: provider.model },
          });
        }

        const model = createLlmClient(provider, { maxTokens: 10 });

        // 发送简单的测试请求
        await model.invoke('Hi');

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
      const ok = await requireAuth(request, reply);
      if (!ok) return;
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
