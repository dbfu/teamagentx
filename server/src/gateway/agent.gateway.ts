import {FastifyInstance} from 'fastify';
import {Server} from 'socket.io';
import {clearExecutorCache, getAgentDebugInfo} from '../core/agent/agent-handler/index.js';
import {agentService, UpdateAgentInput, UpdateSortOrderInput} from '../core/agent/agent.service.js';
import {executionRecordService} from '../modules/execution-record/execution-record.service.js';
import {checkAllAcpTools} from '../core/agent/acp-tools.service.js';
import {chatRoomService} from '../modules/chatroom/chatroom.service.js';
import {quickChatSessionService} from '../modules/quick-chat-session/quick-chat-session.service.js';
import {checkpointService} from '../modules/checkpoint/checkpoint.service.js';
import {promptOptimizeService} from '../modules/prompt-optimize/prompt-optimize.service.js';

// 所有支持的 LLM 供应商类型（与 Prisma 保持一致）
const LLM_PROVIDER_TYPES = [
  'anthropic', 'openai', 'deepseek', 'zhipu', 'zhipu_en', 'bailian',
  'bailian_coding', 'kimi', 'kimi_coding', 'stepfun', 'minimax', 'minimax_en',
  'doubao', 'bailing', 'modelscope', 'siliconflow', 'siliconflow_en',
  'katcoder', 'longcat', 'xiaomi_mimo', 'openrouter', 'novita', 'nvidia',
  'aihubmix', 'dmxapi', 'packycode', 'cubence', 'aigocode', 'rightcode',
  'aicodemirror', 'aicoding', 'crazyrouter', 'sssaicode', 'micu', 'xcode',
  'ctok', 'compshare', 'newapi', 'custom',
] as const;

function isSystemAgentMutationError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith('系统助手不允许');
}

function serializeAgentForResponse<T extends { voiceConfig?: string | null }>(agent: T): Omit<T, 'voiceConfig'> & { voiceConfig: unknown | null } {
  if (!agent.voiceConfig) {
    return {
      ...agent,
      voiceConfig: null,
    };
  }

  try {
    return {
      ...agent,
      voiceConfig: JSON.parse(agent.voiceConfig),
    };
  } catch {
    return {
      ...agent,
      voiceConfig: null,
    };
  }
}

// JSON Schema for response
const agentResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    avatar: { type: 'string', nullable: true },
    avatarColor: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    prompt: { type: 'string' },
    type: { type: 'string', enum: ['builtin', 'acp'] },
    agentLevel: { type: 'string', enum: ['normal', 'system'] },
    acpTool: { type: 'string', nullable: true },
    workDir: { type: 'string', nullable: true },
    voiceConfig: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      properties: {
        enabled: { type: 'boolean' },
        outputMode: { type: 'string', enum: ['off', 'manual', 'auto_final_only'] },
        voiceId: { type: 'string', nullable: true },
        speed: { type: 'number' },
        volume: { type: 'number' },
        autoPlay: { type: 'boolean' },
        provider: { type: 'string', nullable: true },
      },
    },
    isActive: { type: 'boolean' },
    categoryId: { type: 'string', nullable: true },
    category: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string', nullable: true },
        sortOrder: { type: 'integer' },
      },
    },
    llmProviderId: { type: 'string', nullable: true },
    llmProvider: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        type: { type: 'string', enum: LLM_PROVIDER_TYPES },
        apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
        apiUrl: { type: 'string', nullable: true },
        model: { type: 'string' },
        isActive: { type: 'boolean' },
        isDefault: { type: 'boolean' },
      },
    },
    sortOrder: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
};

const createAgentBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'Agent 名称（唯一）' },
    avatar: { type: 'string', description: '头像图标（emoji 或 URL）' },
    avatarColor: { type: 'string', description: '头像背景颜色（如 #1890ff）' },
    description: { type: 'string', description: 'Agent 描述' },
    prompt: { type: 'string', description: '系统提示词' },
    type: { type: 'string', enum: ['builtin', 'acp'], description: '助手类型' },
    acpTool: { type: 'string', description: 'ACP 工具名称（仅 type=acp 时有效，如 claude, codex）' },
    workDir: { type: 'string', description: '工作目录（适用于所有类型）' },
    voiceConfig: {
      type: 'object',
      description: '助手语音配置',
      properties: {
        enabled: { type: 'boolean' },
        outputMode: { type: 'string', enum: ['off', 'manual', 'auto_final_only'] },
        voiceId: { type: 'string', nullable: true },
        speed: { type: 'number' },
        volume: { type: 'number' },
        autoPlay: { type: 'boolean' },
        provider: { type: 'string' },
      },
    },
    categoryId: { type: 'string', description: '分类 ID' },
    llmProviderId: { type: 'string', description: 'LLM 供应商 ID（builtin 直接使用；acp 目前仅支持 claude/codex 最小闭环）' },
  },
};

const updateAgentBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    avatar: { type: 'string' },
    avatarColor: { type: 'string' },
    description: { type: 'string' },
    prompt: { type: 'string' },
    type: { type: 'string', enum: ['builtin', 'acp'] },
    acpTool: { type: 'string' },
    workDir: { type: 'string' },
    voiceConfig: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        outputMode: { type: 'string', enum: ['off', 'manual', 'auto_final_only'] },
        voiceId: { type: 'string', nullable: true },
        speed: { type: 'number' },
        volume: { type: 'number' },
        autoPlay: { type: 'boolean' },
        provider: { type: 'string' },
      },
    },
    isActive: { type: 'boolean' },
    categoryId: { type: 'string', description: '分类 ID，设为 null 移除分类' },
    llmProviderId: { type: 'string', description: 'LLM 供应商 ID，设为 null 移除供应商' },
  },
};

interface CreateAgentBody {
  name: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  prompt?: string;
  type?: 'builtin' | 'acp';
  acpTool?: string;
  workDir?: string;
  voiceConfig?: UpdateAgentInput['voiceConfig'];
  categoryId?: string;
  llmProviderId?: string;
}

interface UpdateAgentBody {
  name?: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  prompt?: string;
  type?: 'builtin' | 'acp';
  acpTool?: string;
  workDir?: string;
  voiceConfig?: UpdateAgentInput['voiceConfig'];
  isActive?: boolean;
  categoryId?: string | null;
  llmProviderId?: string | null;
}

interface AgentParams {
  id: string;
}

export async function agentGateway(app: FastifyInstance) {
  // 获取所有 Agent 列表
  app.get(
    '/agents',
    {
      schema: {
        description: '获取所有 Agent 列表',
        tags: ['Agents'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: agentResponseSchema },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const agents = await agentService.findAll();
      return reply.send({ success: true, data: agents.map(serializeAgentForResponse) });
    },
  );

  // 获取活跃的 Agent 列表
  app.get(
    '/agents/active',
    {
      schema: {
        description: '获取所有活跃的 Agent 列表',
        tags: ['Agents'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'array', items: agentResponseSchema },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const agents = await agentService.findActive();
      return reply.send({ success: true, data: agents.map(serializeAgentForResponse) });
    },
  );

  // 获取按分类分组的 Agent 列表
  app.get(
    '/agents/grouped',
    {
      schema: {
        description: '获取按分类分组的 Agent 列表',
        tags: ['Agents'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  categories: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        category: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            description: { type: 'string', nullable: true },
                            sortOrder: { type: 'integer' },
                          },
                        },
                        agents: { type: 'array', items: agentResponseSchema },
                      },
                    },
                  },
                  uncategorized: { type: 'array', items: agentResponseSchema },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const { categorized, uncategorized } = await agentService.findAllGroupedByCategory();
      const categories = Array.from(categorized.values()).map((group) => ({
        ...group,
        agents: group.agents.map(serializeAgentForResponse),
      }));
      return reply.send({ success: true, data: { categories, uncategorized: uncategorized.map(serializeAgentForResponse) } });
    },
  );

  // 获取 ACP/SDK 工具列表及安装状态
  app.get(
    '/acp-tools',
    {
      schema: {
        description: '获取支持的 ACP/SDK 工具列表及安装状态',
        tags: ['Agents'],
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
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    installed: { type: 'boolean' },
                    version: { type: 'string', nullable: true },
                    localConfigAvailable: { type: 'boolean', nullable: true },
                    localConfigPath: { type: 'string', nullable: true },
                    localConfigLabel: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const tools = checkAllAcpTools();
      return reply.send({ success: true, data: tools });
    },
  );

  // 获取单个 Agent
  app.get<{Params: AgentParams}>(
    '/agents/:id',
    {
      schema: {
        description: '根据 ID 获取单个 Agent',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: agentResponseSchema,
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
      const {id} = request.params;
      const agent = await agentService.findById(id);

      if (!agent) {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }

      return reply.send({ success: true, data: serializeAgentForResponse(agent) });
    },
  );

  // 创建 Agent
  app.post<{Body: CreateAgentBody}>(
    '/agents',
    {
      schema: {
        description: '创建新的 Agent',
        tags: ['Agents'],
        body: createAgentBodySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: agentResponseSchema,
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
      const {name, avatar, avatarColor, description, prompt, type, acpTool, workDir, voiceConfig, categoryId, llmProviderId} = request.body;

      try {
        const agent = await agentService.create({
          name,
          avatar,
          avatarColor,
          description,
          prompt: prompt ?? '',
          type,
          acpTool,
          workDir,
          voiceConfig,
          categoryId,
          llmProviderId,
        });
        return reply.code(201).send({ success: true, data: serializeAgentForResponse(agent) });
      } catch (error: any) {
        if (error.code === 'P2002') {
          return reply
            .code(409)
            .send({ success: false, error: '助手名称已存在' });
        }
        throw error;
      }
    },
  );

  // 更新 Agent
  app.put<{Params: AgentParams; Body: UpdateAgentBody}>(
    '/agents/:id',
    {
      schema: {
        description: '更新 Agent 信息',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: updateAgentBodySchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: agentResponseSchema,
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
      const {id} = request.params;
      const data = request.body as UpdateAgentInput;

      try {
        // 先获取旧的 agent 信息，用于清除缓存
        const oldAgent = await agentService.findById(id);
        const agent = await agentService.update(id, data);
        // 清除旧名字的缓存（如果名字改变了）
        if (oldAgent && oldAgent.name !== agent.name) {
          console.log(`[AgentUpdate] 助手名称改变: ${oldAgent.name} -> ${agent.name}，清除旧缓存`);
          clearExecutorCache(oldAgent.name);
        }
        // 也清除新名字的缓存（以防万一）
        console.log(`[AgentUpdate] 清除助手 ${agent.name} 的缓存`);
        clearExecutorCache(agent.name);
        return reply.send({ success: true, data: serializeAgentForResponse(agent) });
      } catch (error: any) {
        if (isSystemAgentMutationError(error)) {
          return reply
            .code(403)
            .send({ success: false, error: error.message });
        }
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: '助手不存在' });
        }
        throw error;
      }
    },
  );

  // 删除 Agent
  app.delete<{Params: AgentParams}>(
    '/agents/:id',
    {
      schema: {
        description: '删除 Agent',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: agentResponseSchema,
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
      const {id} = request.params;

      try {
        const agent = await agentService.delete(id);
        clearExecutorCache(agent.name);
        return reply.send({ success: true, data: serializeAgentForResponse(agent) });
      } catch (error: any) {
        if (isSystemAgentMutationError(error)) {
          return reply
            .code(403)
            .send({ success: false, error: error.message });
        }
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: '助手不存在' });
        }
        throw error;
      }
    },
  );

  // 激活/停用 Agent
  app.patch<{Params: AgentParams; Body: {isActive: boolean}}>(
    '/agents/:id/status',
    {
      schema: {
        description: '激活或停用 Agent',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          properties: { isActive: { type: 'boolean' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: agentResponseSchema,
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
      const {id} = request.params;
      const {isActive} = request.body;

      try {
        const agent = await agentService.setActive(id, isActive);
        clearExecutorCache(agent.name);
        return reply.send({ success: true, data: serializeAgentForResponse(agent) });
      } catch (error: any) {
        if (isSystemAgentMutationError(error)) {
          return reply
            .code(403)
            .send({ success: false, error: error.message });
        }
        if (error.code === 'P2025') {
          return reply
            .code(404)
            .send({ success: false, error: '助手不存在' });
        }
        throw error;
      }
    },
  );

  // 获取 Agent 调试信息
  app.get<{Params: {chatRoomId: string; agentName: string}}>(
    '/chatrooms/:chatRoomId/agents/:agentName/debug',
    {
      schema: {
        description: '获取 Agent 在指定群聊中的调试信息',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: {
            chatRoomId: { type: 'string' },
            agentName: { type: 'string' },
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
                  name: { type: 'string' },
                  systemPrompt: { type: 'string' },
                  lastContext: { type: 'string', nullable: true },
                  lastInvokeResult: { type: 'string', nullable: true },
                  lastHistory: {
                    type: 'array',
                    nullable: true,
                    items: {
                      type: 'object',
                      properties: {
                        content: { type: 'string' },
                        senderName: { type: 'string' },
                        isHuman: { type: 'boolean' },
                      },
                    },
                  },
                  threadId: { type: 'string' },
                  chatRoomId: { type: 'string' },
                  injectGroupHistory: { type: 'boolean' },
                  chatRoomAgents: { type: 'array', items: { type: 'string' } },
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
      const {chatRoomId, agentName} = request.params;
      const debugInfo = getAgentDebugInfo(chatRoomId, agentName);

      if (!debugInfo) {
        return reply
          .code(404)
          .send({ success: false, error: '未找到助手调试信息，助手可能尚未被调用' });
      }

      return reply.send({ success: true, data: debugInfo });
    },
  );

  // 获取 Agent 执行记录列表
  app.get<{Params: {chatRoomId: string; agentId: string}; Querystring: {take?: number}}>(
    '/chatrooms/:chatRoomId/agents/:agentId/executions',
    {
      schema: {
        description: '获取 Agent 在指定群聊中的执行记录',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: {
            chatRoomId: { type: 'string' },
            agentId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            take: { type: 'integer', default: 20 },
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
                    id: { type: 'string' },
                    chatRoomId: { type: 'string' },
                    agentId: { type: 'string' },
                    agentName: { type: 'string' },
                    triggerMessage: { type: 'string' },
                    triggerUser: { type: 'string', nullable: true },
                    actions: { type: 'array' },
                    toolCalls: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          input: { type: 'object' },
                          toolCallId: { type: 'string' },
                          status: { type: 'string', nullable: true },
                          output: { type: 'string', nullable: true },
                        },
                      },
                    },
                    invokeResult: { type: 'object', nullable: true },
                    thinking: { type: 'string', nullable: true },
                    context: { type: 'string', nullable: true },
                    systemPrompt: { type: 'string' },
                    status: { type: 'string' },
                    errorMessage: { type: 'string', nullable: true },
                    duration: { type: 'integer', nullable: true },
                    createdAt: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { chatRoomId, agentId } = request.params;
      const take = request.query.take ?? 20;

      const records = await executionRecordService.findByChatRoomAndAgent(
        chatRoomId,
        agentId,
        { take }
      );

      return reply.send({ success: true, data: records });
    },
  );

  // 创建快速对话
  app.post<{Body: {agentId: string; userId: string; workDir?: string; customWorkDir?: string}}>(
    '/agents/quick-chat',
    {
      schema: {
        description: '创建快速对话临时群聊',
        tags: ['Agents'],
        body: {
          type: 'object',
          required: ['agentId', 'userId'],
          properties: {
            agentId: { type: 'string', description: '助手 ID' },
            userId: { type: 'string', description: '用户 ID' },
            workDir: { type: 'string', description: '快速对话群工作目录' },
            customWorkDir: { type: 'string', description: '兼容旧字段：快速对话群工作目录' },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  isQuickChatRoom: { type: 'boolean' },
                  quickChatAgentId: { type: 'string', nullable: true },
                  ownerId: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
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
      const {agentId, userId, workDir, customWorkDir} = request.body;

      try {
        const chatRoom = await chatRoomService.createQuickChatRoom(agentId, userId, workDir ?? customWorkDir);

        // 广播给所有已连接客户端（通知其他端有新群聊创建）
        const io = (app as any).io as Server;
        if (io) {
          io.emit('chatroom:created', { chatRoom });
        }

        return reply.code(201).send({ success: true, data: chatRoom });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          return reply.code(404).send({ success: false, error: error.message });
        }
        throw error;
      }
    },
  );

  // 获取用户与某助手的快速对话群聊列表
  app.get<{Params: {agentId: string}; Querystring: {userId: string}}>(
    '/agents/:agentId/quick-chat-rooms',
    {
      schema: {
        description: '获取用户与某助手的快速对话群聊列表',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { agentId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string' } },
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
                    id: { type: 'string' },
                    sessionId: { type: 'string' },
                    workDir: { type: 'string' },
                    status: { type: 'string' },
                    createdAt: { type: 'string' },
                    chatRoom: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        createdAt: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const {agentId} = request.params;
      const {userId} = request.query;

      const sessions = await quickChatSessionService.getUserQuickChatRooms(userId, agentId);
      return reply.send({ success: true, data: sessions });
    },
  );

  // 获取 chatRoom 的快速对话会话信息（包括 sessionId 和 workDir）
  app.get<{Params: {chatRoomId: string}}>(
    '/chatrooms/:chatRoomId/quick-chat-session',
    {
      schema: {
        description: '获取 chatRoom 的快速对话会话信息',
        tags: ['ChatRooms'],
        params: {
          type: 'object',
          properties: { chatRoomId: { type: 'string' } },
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
                  agentId: { type: 'string' },
                  chatRoomId: { type: 'string' },
                  sessionId: { type: 'string' },
                  workDir: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const {chatRoomId} = request.params;
      const session = await quickChatSessionService.getByChatRoomId(chatRoomId);
      return reply.send({ success: true, data: session });
    },
  );

  // 获取用户在某个助手上的快速对话群聊数量
  app.get<{Params: {agentId: string}; Querystring: {userId: string}}>(
    '/agents/:agentId/quick-chat-count',
    {
      schema: {
        description: '获取用户在某个助手上的快速对话群聊数量',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { agentId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const {agentId} = request.params;
      const {userId} = request.query;

      const count = await quickChatSessionService.getUserQuickChatCount(userId, agentId);
      return reply.send({ success: true, data: count });
    },
  );

  // 清空助手的上下文（checkpoint 数据）
  app.post<{Params: AgentParams}>(
    '/agents/:id/clear-context',
    {
      schema: {
        description: '清空助手的对话上下文（checkpoint 数据）',
        tags: ['Agents'],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
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
        // 获取助手信息
        const agent = await agentService.findById(id);
        if (!agent) {
          return reply.code(404).send({ success: false, error: '助手不存在' });
        }

        // 只对内置助手（builtin）清空上下文，ACP 类型助手不使用 checkpoint
        if (agent.type === 'builtin') {
          await checkpointService.clearAgentContext(agent.name);
          // 清空执行器缓存，让下次执行重新初始化
          clearExecutorCache(agent.name);
        }

        return reply.send({
          success: true,
          message: `已清空助手 ${agent.name} 的对话上下文`,
        });
      } catch (error: any) {
        console.error('[ClearContext] 清空上下文失败:', error);
        return reply.code(500).send({
          success: false,
          error: '清空上下文失败',
        });
      }
    },
  );

  // AI 优化提示词
  app.post<{Body: {prompt: string}}>(
    '/agents/optimize-prompt',
    {
      schema: {
        description: '使用 AI 优化提示词',
        tags: ['Agents'],
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: '需要优化的提示词' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          500: {
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
      const { prompt } = request.body;

      if (!prompt || !prompt.trim()) {
        return reply.code(400).send({ success: false, error: '提示词不能为空' });
      }

      try {
        const optimizedPrompt = await promptOptimizeService.optimize(prompt);
        return reply.send({ success: true, data: optimizedPrompt });
      } catch (error: any) {
        console.error('[OptimizePrompt] 优化提示词失败:', error);
        return reply.code(500).send({
          success: false,
          error: error.message || '优化提示词失败',
        });
      }
    },
  );

  // AI 优化提示词（流式输出）
  app.post<{Body: {prompt: string}}>(
    '/agents/optimize-prompt-stream',
    {
      schema: {
        description: '使用 AI 优化提示词（流式输出）',
        tags: ['Agents'],
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', description: '需要优化的提示词' },
          },
        },
      },
    },
    async (request, reply) => {
      const { prompt } = request.body;

      if (!prompt || !prompt.trim()) {
        return reply.code(400).send({ success: false, error: '提示词不能为空' });
      }

      await promptOptimizeService.optimizeStream(prompt, reply);
    },
  );

  // 批量更新助手排序
  app.put<{Body: {items: UpdateSortOrderInput[]}}>(
    '/agents/sort-order',
    {
      schema: {
        description: '批量更新助手排序',
        tags: ['Agents'],
        body: {
          type: 'object',
          required: ['items'],
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'sortOrder'],
                properties: {
                  id: { type: 'string', description: '助手 ID' },
                  sortOrder: { type: 'number', description: '排序值（越大越靠前）' },
                  categoryId: { type: 'string', nullable: true, description: '可选：同时更新分类' },
                },
              },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
          },
          400: {
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
      const { items } = request.body;

      if (!items || items.length === 0) {
        return reply.code(400).send({ success: false, error: '排序数据不能为空' });
      }

      try {
        await agentService.updateSortOrder(items);
        return reply.send({ success: true });
      } catch (error: any) {
        console.error('[UpdateSortOrder] 批量更新排序失败:', error);
        return reply.code(500).send({ success: false, error: error.message || '更新排序失败' });
      }
    },
  );
}
