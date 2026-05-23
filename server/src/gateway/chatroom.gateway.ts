import fs from 'fs';
import { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { chatRoomService } from '../modules/chatroom/chatroom.service.js';
import { checkpointService } from '../modules/checkpoint/checkpoint.service.js';
import { quickChatSessionService } from '../modules/quick-chat-session/quick-chat-session.service.js';
import {
  abortControllers,
  broadcastAgentStatus,
  broadcastAgentTaskQueue,
  clearExecutorCache,
  discardExecutionResultKeys,
  executorCache,
  getAgentDebugInfo,
  getCacheKey,
  processingMap,
  broadcastAgentJoinedMessage,
} from '../core/agent/agent-handler/index.js';
import { agentService } from '../core/agent/agent.service.js';
import { executionRecordService } from '../modules/execution-record/execution-record.service.js';
import { taskQueueService } from '../modules/task-queue/task-queue.service.js';
import { messageService } from '../modules/message/message.service.js';
import { agentMemoryService } from '../modules/agent-memory/agent-memory.service.js';
import { deserializeAgentSpeechConfig } from '../modules/speech/speech-config.js';
import { gitBranchService, type GitCommandAction } from '../modules/chatroom/git-branch.service.js';

// Schema definitions
const lastMessageSchema = {
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    content: { type: 'string' },
    time: { type: 'string' },
    isHuman: { type: 'boolean' },
    userId: { type: 'string', nullable: true },
    agentId: { type: 'string', nullable: true },
    user: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
      },
    },
    agent: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
};

const chatRoomSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    avatar: { type: 'string', nullable: true },
    avatarColor: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    rules: { type: 'string', nullable: true },
    workDir: { type: 'string', nullable: true },
    ownerId: { type: 'string', nullable: true },
    isQuickChatRoom: { type: 'boolean' },
    quickChatAgentId: { type: 'string', nullable: true },
    defaultAgentId: { type: 'string', nullable: true },
    agentTriggerMode: { type: 'string' },
    isPinned: { type: 'boolean' },
    pinnedAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    lastMessage: lastMessageSchema,
    owner: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
        avatar: { type: 'string', nullable: true },
        avatarColor: { type: 'string', nullable: true },
      },
    },
    chatRoomAgents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string', nullable: true },
          agentId: { type: 'string', nullable: true },
          role: { type: 'string' },
          injectGroupHistory: { type: 'boolean' },
          joinedAt: { type: 'string' },
          user: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              avatar: { type: 'string', nullable: true },
              avatarColor: { type: 'string', nullable: true },
            },
          },
          agent: {
            type: 'object',
            nullable: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              avatar: { type: 'string', nullable: true },
              avatarColor: { type: 'string', nullable: true },
              description: { type: 'string', nullable: true },
              type: { type: 'string', enum: ['builtin', 'acp'] },
              agentLevel: { type: 'string', enum: ['normal', 'system'] },
              speechConfig: {
                type: 'object',
                nullable: true,
                properties: {
                  behavior: {
                    type: 'object',
                    properties: {
                      enabled: { type: 'boolean' },
                      outputMode: { type: 'string', enum: ['off', 'manual', 'auto_final_only'] },
                      autoPlay: { type: 'boolean' },
                    },
                  },
                  profile: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      provider: { type: 'string', nullable: true },
                      model: { type: 'string', nullable: true },
                      voice: { type: 'string', nullable: true },
                      fallbackProvider: { type: 'string', nullable: true },
                      speed: { type: 'number', nullable: true },
                      volume: { type: 'number', nullable: true },
                      pitch: { type: 'number', nullable: true },
                      emotion: { type: 'string', nullable: true },
                      style: { type: 'string', nullable: true },
                      format: { type: 'string', nullable: true },
                      sampleRate: { type: 'number', nullable: true },
                      temperature: { type: 'number', nullable: true },
                      prompt: { type: 'string', nullable: true },
                      vendorOptions: { type: 'object', nullable: true, additionalProperties: true },
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
};

function serializeChatRoomForResponse<T extends { chatRoomAgents?: Array<{ agent?: { speechConfig?: string | null } | null }> }>(chatRoom: T): T {
  if (!chatRoom.chatRoomAgents?.length) {
    return chatRoom;
  }

  return {
    ...chatRoom,
    chatRoomAgents: chatRoom.chatRoomAgents.map((item) => {
      if (!item.agent) return item;
      return {
        ...item,
        agent: {
          ...item.agent,
          speechConfig: item.agent.speechConfig
            ? deserializeAgentSpeechConfig(item.agent.speechConfig)
            : null,
        },
      };
    }),
  };
}

const createChatRoomBodySchema = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: '群聊名称' },
    avatar: { type: 'string', description: '头像图标（emoji 或 URL）' },
    avatarColor: { type: 'string', description: '头像背景颜色（如 #1890ff）' },
    description: { type: 'string', description: '群聊描述' },
    rules: { type: 'string', description: '群规则/指南，注入到群内所有 Agent 的上下文' },
    workDir: { type: 'string', nullable: true, description: '群聊工作目录，留空使用默认目录' },
    ownerId: { type: 'string', description: 'Owner user ID' },
  },
};

const addAgentBodySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string', description: '要添加的用户 ID' },
    agentId: { type: 'string', description: '要添加的助手 ID' },
    role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'], description: '成员角色' },
    injectGroupHistory: { type: 'boolean', description: '是否注入群历史消息作为上下文' },
  },
};

interface CreateChatRoomBody {
  name: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  rules?: string;
  workDir?: string | null;
  ownerId?: string;
}

interface DuplicateChatRoomBody {
  name?: string;
}

interface UpdateChatRoomBody {
  name?: string;
  avatar?: string;
  avatarColor?: string;
  description?: string;
  rules?: string;
  workDir?: string | null;
  defaultAgentId?: string | null;
  agentTriggerMode?: 'auto' | 'manual';
}

interface UpdateGitBranchBody {
  branch: string;
}

interface ExecuteGitCommandBody {
  action: GitCommandAction;
  message?: string;
}

interface AddAgentBody {
  userId?: string;
  agentId?: string;
  role?: string;
  injectGroupHistory?: boolean;
}

interface ChatRoomParams {
  id: string;
}

interface AgentParams {
  id: string;
  agentId: string;
}

export async function chatRoomGateway(app: FastifyInstance) {
  // Get all chatRooms
  app.get('/chatrooms', {
    schema: {
      description: '获取所有群聊列表',
      tags: ['ChatRooms'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: chatRoomSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const chatRooms = await chatRoomService.findAll();
    return reply.send({ success: true, data: chatRooms.map(serializeChatRoomForResponse) });
  });

  // Get chatRoom by ID
  app.get<{ Params: ChatRoomParams }>('/chatrooms/:id', {
    schema: {
      description: '根据 ID 获取群聊',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
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
  }, async (request, reply) => {
    const { id } = request.params;
    const chatRoom = await chatRoomService.findById(id);

    if (!chatRoom) {
      return reply.code(404).send({ success: false, error: '群聊不存在' });
    }

    return reply.send({ success: true, data: serializeChatRoomForResponse(chatRoom) });
  });

  app.get<{ Params: ChatRoomParams }>('/chatrooms/:id/git-status', {
    schema: {
      description: '获取群聊工作目录 git 分支状态',
      tags: ['ChatRooms'],
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
                isGitRepo: { type: 'boolean' },
                workDir: { type: 'string' },
                currentBranch: { type: 'string', nullable: true },
                branches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      current: { type: 'boolean' },
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
  }, async (request, reply) => {
    const { id } = request.params;
    const chatRoom = await chatRoomService.findById(id);

    if (!chatRoom) {
      return reply.code(404).send({ success: false, error: '群聊不存在' });
    }

    const status = await gitBranchService.getStatus(chatRoom.id, chatRoom.workDir);
    return reply.send({ success: true, data: status });
  });

  app.post<{ Params: ChatRoomParams; Body: UpdateGitBranchBody }>('/chatrooms/:id/git-branch', {
    schema: {
      description: '切换群聊工作目录 git 分支',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['branch'],
        properties: {
          branch: { type: 'string' },
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
                isGitRepo: { type: 'boolean' },
                workDir: { type: 'string' },
                currentBranch: { type: 'string', nullable: true },
                branches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      current: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
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
  }, async (request, reply) => {
    const { id } = request.params;
    const chatRoom = await chatRoomService.findById(id);

    if (!chatRoom) {
      return reply.code(404).send({ success: false, error: '群聊不存在' });
    }

    try {
      const status = await gitBranchService.switchBranch(chatRoom.id, chatRoom.workDir, request.body.branch);
      return reply.send({ success: true, data: status });
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: error.message || '切换分支失败' });
    }
  });

  app.post<{ Params: ChatRoomParams; Body: ExecuteGitCommandBody }>('/chatrooms/:id/git-command', {
    schema: {
      description: '执行群聊工作目录的白名单 Git 快捷指令',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['init', 'status', 'diff', 'add_all', 'commit', 'log', 'branch'],
          },
          message: { type: 'string' },
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
                action: { type: 'string' },
                command: { type: 'string' },
                workDir: { type: 'string' },
                exitCode: { type: 'number' },
                stdout: { type: 'string' },
                stderr: { type: 'string' },
                output: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
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
  }, async (request, reply) => {
    const { id } = request.params;
    const chatRoom = await chatRoomService.findById(id);

    if (!chatRoom) {
      return reply.code(404).send({ success: false, error: '群聊不存在' });
    }

    try {
      const result = await gitBranchService.executeCommand(
        chatRoom.id,
        chatRoom.workDir,
        request.body.action,
        request.body.message,
      );
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: error.message || 'Git 命令执行失败' });
    }
  });

  // Create chatRoom
  app.post<{ Body: CreateChatRoomBody }>('/chatrooms', {
    schema: {
      description: '创建新群聊',
      tags: ['ChatRooms'],
      body: createChatRoomBodySchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    const { name, avatar, avatarColor, description, rules, workDir, ownerId } = request.body;

    // If ownerId is provided, use createWithOwner to auto-add OWNER agent
    const chatRoom = ownerId
      ? await chatRoomService.createWithOwner({
          name,
          avatar,
          avatarColor,
          description,
          rules,
          workDir,
          ownerId,
        })
      : await chatRoomService.create({
          name,
          avatar,
          avatarColor,
          description,
          rules,
          workDir,
        });

    // 广播给所有已连接客户端（通知其他端有新群聊创建）
    const io = (app as any).io as Server;
    if (io) {
      io.emit('chatroom:created', { chatRoom });
    }

    return reply.code(201).send({ success: true, data: chatRoom ? serializeChatRoomForResponse(chatRoom) : chatRoom });
  });

  // Duplicate chatRoom
  app.post<{ Params: ChatRoomParams; Body: DuplicateChatRoomBody }>('/chatrooms/:id/duplicate', {
    schema: {
      description: '复制群聊配置（不复制消息和运行上下文）',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '复制后的群聊名称；不传则使用“原名称 副本”' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
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
  }, async (request, reply) => {
    const { id } = request.params;
    const { name } = request.body ?? {};

    const chatRoom = await chatRoomService.duplicate({
      sourceChatRoomId: id,
      name,
    });

    if (!chatRoom) {
      return reply.code(404).send({ success: false, error: '群聊不存在' });
    }

    const io = (app as any).io as Server | undefined;
    io?.emit('chatroom:created', { chatRoom });

    return reply.code(201).send({ success: true, data: serializeChatRoomForResponse(chatRoom) });
  });

  // Add agent to chatRoom
  app.post<{ Params: ChatRoomParams; Body: AddAgentBody }>('/chatrooms/:id/agents', {
    schema: {
      description: '添加助手到群聊',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: addAgentBodySchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                chatRoomId: { type: 'string' },
                userId: { type: 'string', nullable: true },
                agentId: { type: 'string', nullable: true },
                role: { type: 'string' },
                joinedAt: { type: 'string' },
              },
            },
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
  }, async (request, reply) => {
    const { id } = request.params;
    const { userId, agentId, role, injectGroupHistory } = request.body;

    try {
      const chatRoomAgent = await chatRoomService.addAgent({
        chatRoomId: id,
        userId,
        agentId,
        role,
        injectGroupHistory,
      });

      // 如果添加的是助手，发送通知消息到群聊
      if (agentId && chatRoomAgent.agent) {
        const io = (app as any).io as Server;
        // 广播助手加入通知消息
        await broadcastAgentJoinedMessage(
          id,
          chatRoomAgent.agent.name,
          chatRoomAgent.agent.description,
        );
        // 广播群聊成员更新事件
        if (io) {
          io.to(id).emit('chatroom:agents-updated', { chatRoomId: id });
        }
      }

      return reply.code(201).send({ success: true, data: chatRoomAgent });
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: error.message });
    }
  });

  // Remove agent from chatRoom
  app.delete<{ Params: AgentParams }>('/chatrooms/:id/agents/:agentId', {
    schema: {
      description: '从群聊移除助手',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          agentId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
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
  }, async (request, reply) => {
    const { agentId } = request.params;

    try {
      await chatRoomService.removeAgent(agentId);
      return reply.send({ success: true });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      throw error;
    }
  });

  // Update agent settings in chatRoom
  app.patch<{ Params: AgentParams; Body: { injectGroupHistory?: boolean } }>('/chatrooms/:id/agents/:agentId/settings', {
    schema: {
      description: '更新群聊中助手的设置（注入群历史）',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          agentId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          injectGroupHistory: { type: 'boolean', description: '是否注入群历史' },
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
                id: { type: 'string' },
                chatRoomId: { type: 'string' },
                agentId: { type: 'string', nullable: true },
                injectGroupHistory: { type: 'boolean' },
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
  }, async (request, reply) => {
    const { id, agentId } = request.params;
    const data = request.body;

    try {
      const result = await chatRoomService.updateAgentSettings(id, agentId, data);
      if (result.agent?.name) {
        clearExecutorCache(result.agent.name, id);
      }
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return reply.code(404).send({ success: false, error: error.message });
      }
      throw error;
    }
  });

  // Clear agent context in chatRoom
  app.post<{ Params: AgentParams }>('/chatrooms/:id/agents/:agentId/clear-context', {
    schema: {
      description: '清空群聊中助手的对话上下文',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '群聊 ID' },
          agentId: { type: 'string', description: '群聊助手关系 ID (ChatRoomAgent.id)' },
        },
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
  }, async (request, reply) => {
    const { id, agentId } = request.params;

    try {
      // 获取 ChatRoomAgent 信息
      const chatRoomAgent = await chatRoomService.findAgentById(agentId);
      if (!chatRoomAgent) {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }

      // 获取 Agent 信息
      const agent = await agentService.findById(chatRoomAgent.agentId ?? '');
      if (!agent) {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }

      // 根据助手类型清空上下文
      await agentMemoryService.clear(id, agent.id);
      const executionKey = `${id}_${agent.id}`;
      const abortController = abortControllers.get(executionKey);
      if (abortController) {
        discardExecutionResultKeys.add(executionKey);
        abortController.abort();
        abortControllers.delete(executionKey);
      } else {
        discardExecutionResultKeys.delete(executionKey);
      }
      processingMap.delete(executionKey);
      const [deletedTasks, deletedExecutions] = await Promise.all([
        taskQueueService.deleteByChatRoomAndAgent(id, agent.id),
        executionRecordService.deleteByChatRoomAndAgent(id, agent.id),
      ]);

      if (agent.type === 'builtin') {
        await checkpointService.clearChatRoomAgentContext(id, agent.name);
        // 清空执行器缓存（传入 chatRoomId 精确删除）
        clearExecutorCache(agent.name, id);
      } else if (agent.type === 'acp') {
        // ACP 助手：使用软关闭方案清除上下文
        // 1. 找到并关闭缓存的 executor 实例
        for (const [cacheKey, executor] of executorCache.entries()) {
          // 匹配：{chatRoomId}_{agentName} 或 {chatRoomId}_{agentName}_{sessionDir}
          if (cacheKey.startsWith(`${id}_`) && cacheKey.includes(`_${agent.name}`)) {
            console.log(`[ClearContext] 找到 executor: ${cacheKey}`);

            // 调用 cleanup 方法正确关闭会话（如果存在）
            if (executor.cleanup) {
              try {
                console.log(`[ClearContext] 调用 cleanup() 关闭 ACP 会话...`);
                await executor.cleanup();
                console.log(`[ClearContext] ACP 会话已软关闭`);
              } catch (cleanupError) {
                console.warn(`[ClearContext] cleanup() 失败（可能会话已结束）:`, cleanupError);
              }
            }
          }
        }

        // 2. 清空执行器缓存（传入 chatRoomId 精确删除，包括快速对话的缓存）
        clearExecutorCache(agent.name, id);

        // 3. 将历史注入位置推进到当前最新消息，避免清空上下文后再次全量注入旧群聊历史
        const latestMessages = await messageService.findByChatRoomId(id, { take: 1, order: 'desc' });
        await chatRoomService.updateLastInjectedMessageId(
          id,
          agent.id ?? '',
          latestMessages[0]?.id ?? null,
        );
      }

      broadcastAgentTaskQueue(id, agent.id, []);
      const inactiveTasks = await taskQueueService.getInactiveTasks(id);
      const inactiveTaskList = inactiveTasks.map(task => ({
        id: task.id,
        agentId: task.agentId,
        agentName: task.agentName,
        messageId: task.messageId,
        messageContent: task.messageContent,
        status: task.status,
        createdAt: task.createdAt,
      }));
      const io = (app as any).io as Server | undefined;
      io?.to(id).emit('agent:inactive-tasks', { chatRoomId: id, tasks: inactiveTaskList });
      await broadcastAgentStatus(id);

      console.log(
        `[ClearContext] 已清理群聊 ${id} 助手 ${agent.name} 的任务 ${deletedTasks.count} 条、执行记录 ${deletedExecutions.count} 条`
      );

      return reply.send({
        success: true,
        message: `已清空群聊中助手 ${agent.name} 的对话上下文`,
      });
    } catch (error: any) {
      console.error('[ClearContext] 清空上下文失败:', error);
      return reply.code(500).send({
        success: false,
        error: '清空上下文失败',
      });
    }
  });

  // Get agent context in chatRoom
  app.get<{ Params: AgentParams }>('/chatrooms/:id/agents/:agentId/context', {
    schema: {
      description: '获取群聊中助手的对话上下文信息',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '群聊 ID' },
          agentId: { type: 'string', description: '群聊助手关系 ID (ChatRoomAgent.id)' },
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
                agentName: { type: 'string' },
                agentType: { type: 'string' },
                latestExecution: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    context: { type: 'string', nullable: true },
                    systemPrompt: { type: 'string' },
                    thinking: { type: 'string', nullable: true },
                    toolCalls: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string' },
                          input: { type: 'object' },
                          toolCallId: { type: 'string', nullable: true },
                          status: { type: 'string', nullable: true },
                          output: { type: 'string', nullable: true },
                        },
                      },
                    },
                    triggerMessage: { type: 'string' },
                    triggerUser: { type: 'string', nullable: true },
                    duration: { type: 'integer', nullable: true },
                    createdAt: { type: 'string' },
                  },
                },
                checkpointStats: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    threadId: { type: 'string' },
                  },
                },
                realtimeInfo: {
                  type: 'object',
                  nullable: true,
                  properties: {
                    threadId: { type: 'string' },
                    injectGroupHistory: { type: 'boolean' },
                    chatRoomAgents: {
                      type: 'array',
                      items: { type: 'string' },
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
  }, async (request, reply) => {
    const { id, agentId } = request.params;

    try {
      // 获取 ChatRoomAgent 信息
      const chatRoomAgent = await chatRoomService.findAgentById(agentId);
      if (!chatRoomAgent) {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }

      // 获取 Agent 信息
      const agent = await agentService.findById(chatRoomAgent.agentId ?? '');
      if (!agent) {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }

      // 获取最近一次执行记录（持久化数据）
      const latestExecution = await executionRecordService.findLatest(id, agent.id);

      const threadId = getCacheKey(id, agent.name);

      // 获取 checkpoint 统计
      const checkpointStats = await checkpointService.getCheckpointStats(threadId);

      // 获取 checkpoint 消息历史
      const checkpointMessages = await checkpointService.getCheckpointMessages(threadId);

      // 尝试获取实时信息（如果内存中有 executor）
      const realtimeDebugInfo = getAgentDebugInfo(id, agent.name);

      const result = {
        agentName: agent.name,
        agentType: agent.type,
        latestExecution: latestExecution ? {
          context: latestExecution.context,
          systemPrompt: latestExecution.systemPrompt,
          thinking: latestExecution.thinking,
          toolCalls: latestExecution.toolCalls,
          triggerMessage: latestExecution.triggerMessage,
          triggerUser: latestExecution.triggerUser,
          duration: latestExecution.duration,
          createdAt: latestExecution.createdAt,
        } : null,
        checkpointStats: {
          count: checkpointStats.count,
          threadId: checkpointStats.threadId,
        },
        checkpointMessages,
        realtimeInfo: realtimeDebugInfo ? {
          threadId: realtimeDebugInfo.threadId,
          injectGroupHistory: realtimeDebugInfo.injectGroupHistory,
          chatRoomAgents: realtimeDebugInfo.chatRoomAgents,
        } : null,
      };

      return reply.send({ success: true, data: result });
    } catch (error: any) {
      console.error('[GetContext] 获取上下文失败:', error);
      return reply.code(500).send({
        success: false,
        error: '获取上下文失败',
      });
    }
  });

  // Get agent task queue in chatRoom
  app.get<{ Params: { id: string; agentId: string } }>('/chatrooms/:id/agents/:agentId/tasks', {
    schema: {
      description: '获取群聊中助手的任务队列',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '群聊 ID' },
          agentId: { type: 'string', description: '助手 ID' },
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
                  messageId: { type: 'string' },
                  messageContent: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id, agentId } = request.params;

    try {
      const tasks = await taskQueueService.getAgentQueue(id, agentId);

      // 只返回必要的信息
      const result = tasks.map(task => ({
        id: task.id,
        messageId: task.messageId,
        messageContent: task.messageContent,
        createdAt: task.createdAt,
      }));

      return reply.send({ success: true, data: result });
    } catch (error: any) {
      console.error('[GetTasks] 获取任务队列失败:', error);
      return reply.code(500).send({
        success: false,
        error: '获取任务队列失败',
      });
    }
  });

  // Get all assistant tasks in chatRoom as a board
  app.get<{ Params: { id: string }; Querystring: { take?: number } }>('/chatrooms/:id/tasks/board', {
    schema: {
      description: '获取群聊中所有助手的任务看板',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '群聊 ID' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          take: { type: 'integer', default: 50, description: '已完成任务返回数量' },
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
                completed: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      agentId: { type: 'string' },
                      agentName: { type: 'string' },
                      messageId: { type: 'string', nullable: true },
                      messageContent: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                      duration: { type: 'integer', nullable: true },
                      errorMessage: { type: 'string', nullable: true },
                      executionRecordId: { type: 'string', nullable: true },
                    },
                  },
                },
                failed: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      agentId: { type: 'string' },
                      agentName: { type: 'string' },
                      messageId: { type: 'string', nullable: true },
                      messageContent: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                      duration: { type: 'integer', nullable: true },
                      errorMessage: { type: 'string', nullable: true },
                      executionRecordId: { type: 'string', nullable: true },
                    },
                  },
                },
                executing: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      agentId: { type: 'string' },
                      agentName: { type: 'string' },
                      messageId: { type: 'string', nullable: true },
                      messageContent: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                    },
                  },
                },
                pending: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      agentId: { type: 'string' },
                      agentName: { type: 'string' },
                      messageId: { type: 'string', nullable: true },
                      messageContent: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'string' },
                    },
                  },
                },
                cancelled: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      kind: { type: 'string' },
                      agentId: { type: 'string' },
                      agentName: { type: 'string' },
                      messageId: { type: 'string', nullable: true },
                      messageContent: { type: 'string' },
                      status: { type: 'string' },
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
  }, async (request, reply) => {
    const { id } = request.params;
    const take = Math.min(Math.max(request.query.take ?? 50, 1), 100);

    try {
      const [queueTasks, completedRecords] = await Promise.all([
        taskQueueService.getChatRoomBoardTasks(id),
        executionRecordService.findByChatRoom(id, { take }),
      ]);

      const queueItems = queueTasks.map(task => ({
        id: task.id,
        kind: 'task',
        agentId: task.agentId,
        agentName: task.agentName,
        messageId: task.messageId,
        messageContent: task.messageContent,
        status: task.status,
        createdAt: task.createdAt.toISOString(),
      }));

      const completed = completedRecords.map(record => ({
        id: record.id,
        kind: 'execution',
        agentId: record.agentId,
        agentName: record.agentName,
        messageId: null,
        messageContent: record.triggerMessage,
        status: record.status,
        createdAt: record.createdAt,
        duration: record.duration,
        errorMessage: record.errorMessage,
        executionRecordId: record.id,
      }));

      return reply.send({
        success: true,
        data: {
          completed: completed.filter(record => record.status === 'completed'),
          failed: completed.filter(record => record.status === 'failed'),
          executing: queueItems.filter(task => task.status === 'executing'),
          pending: queueItems.filter(task => task.status === 'pending'),
          cancelled: [
            ...completed.filter(record => record.status === 'cancelled'),
            ...queueItems.filter(task => task.status === 'cancelled' || task.status === 'interrupted'),
          ],
        },
      });
    } catch (error: any) {
      console.error('[GetTaskBoard] 获取任务看板失败:', error);
      return reply.code(500).send({
        success: false,
        error: '获取任务看板失败',
      });
    }
  });

  // Delete chatRoom
  app.delete<{ Params: ChatRoomParams }>('/chatrooms/:id', {
    schema: {
      description: '删除群聊',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
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
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      await chatRoomService.delete(id);
      return reply.send({ success: true });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '群聊不存在' });
      }
      throw error;
    }
  });

  // Update chatRoom
  app.put<{ Params: ChatRoomParams; Body: UpdateChatRoomBody }>('/chatrooms/:id', {
    schema: {
      description: '更新群聊信息',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          avatar: { type: 'string' },
          avatarColor: { type: 'string' },
          description: { type: 'string' },
          rules: { type: 'string' },
          workDir: { type: 'string', nullable: true },
          defaultAgentId: { type: 'string', nullable: true },
          agentTriggerMode: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
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
  }, async (request, reply) => {
    const { id } = request.params;
    const data = request.body;

    try {
      const chatRoom = await chatRoomService.update(id, data);
      if (data.workDir !== undefined || data.rules !== undefined) {
        clearExecutorCache(undefined, id);
      }
      return reply.send({ success: true, data: chatRoom });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '群聊不存在' });
      }
      if (error.message === '默认助手不存在或未启用' || error.message === '默认助手必须是群聊成员') {
        return reply.code(400).send({ success: false, error: error.message });
      }
      throw error;
    }
  });

  // Pin chatroom
  app.patch<{ Params: ChatRoomParams }>('/chatrooms/:id/pin', {
    schema: {
      description: '置顶群聊',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
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
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const chatRoom = await chatRoomService.pin(id);
      return reply.send({ success: true, data: chatRoom });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '群聊不存在' });
      }
      throw error;
    }
  });

  // Unpin chatroom
  app.patch<{ Params: ChatRoomParams }>('/chatrooms/:id/unpin', {
    schema: {
      description: '取消置顶群聊',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: chatRoomSchema,
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
  }, async (request, reply) => {
    const { id } = request.params;

    try {
      const chatRoom = await chatRoomService.unpin(id);
      return reply.send({ success: true, data: chatRoom });
    } catch (error: any) {
      if (error.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '群聊不存在' });
      }
      throw error;
    }
  });
}
