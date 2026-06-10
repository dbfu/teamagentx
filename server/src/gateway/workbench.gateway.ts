import { FastifyInstance, FastifyRequest } from 'fastify';
import { workbenchTaskService, type WorkbenchTaskPriority, type WorkbenchTaskStatus } from '../modules/workbench/workbench.service.js';
import { coordinatorLogService } from '../modules/coordinator-log/coordinator-log.service.js';

const workbenchTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    chatRoomId: { type: 'string' },
    status: { type: 'string' },
    priority: { type: 'string' },
    dueText: { type: 'string', nullable: true },
    expectedOutput: { type: 'string', nullable: true },
    note: { type: 'string', nullable: true },
    dispatchMessageId: { type: 'string', nullable: true },
    createdBy: { type: 'string', nullable: true },
    dispatchedAt: { type: 'string', nullable: true },
    completedAt: { type: 'string', nullable: true },
    lastActivityAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    chatRoom: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        avatar: { type: 'string', nullable: true },
        avatarColor: { type: 'string', nullable: true },
      },
    },
  },
};

interface TaskParams {
  id: string;
}

interface ListQuery {
  date?: string;
}

interface CreateTaskBody {
  title: string;
  description?: string | null;
  chatRoomId: string;
  priority?: WorkbenchTaskPriority;
  dueText?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
}

interface UpdateTaskBody {
  title?: string;
  description?: string | null;
  chatRoomId?: string;
  status?: WorkbenchTaskStatus;
  priority?: WorkbenchTaskPriority;
  dueText?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
}

interface DispatchManyBody {
  ids: string[];
}

interface RecommendRoomBody {
  title: string;
  description?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
}

function getUser(request: FastifyRequest) {
  if (!request.user) {
    throw new Error('未登录');
  }
  return request.user;
}

export async function workbenchGateway(app: FastifyInstance) {
  app.post<{ Body: RecommendRoomBody }>('/workbench/recommend-room', {
    schema: {
      description: '使用 LLM 推荐工作台任务目标群聊',
      tags: ['Workbench'],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          expectedOutput: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
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
                chatRoomId: { type: 'string', nullable: true },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      const recommendation = await workbenchTaskService.recommendRoom(request.body, user.id);
      return reply.send({ success: true, data: recommendation });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '推荐目标群聊失败' });
    }
  });

  app.get<{ Querystring: ListQuery }>('/workbench/tasks', {
    schema: {
      description: '获取工作台今日任务',
      tags: ['Workbench'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: workbenchTaskSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = getUser(request);
    const tasks = await workbenchTaskService.findToday(user.id, request.query.date);
    return reply.send({ success: true, data: tasks });
  });

  app.post<{ Body: CreateTaskBody }>('/workbench/tasks', {
    schema: {
      description: '创建工作台任务',
      tags: ['Workbench'],
      body: {
        type: 'object',
        required: ['title', 'chatRoomId'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          chatRoomId: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueText: { type: 'string', nullable: true },
          expectedOutput: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: workbenchTaskSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      const task = await workbenchTaskService.create({
        ...request.body,
        createdBy: user.id,
      });
      return reply.send({ success: true, data: task });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '创建任务失败' });
    }
  });

  app.put<{ Params: TaskParams; Body: UpdateTaskBody }>('/workbench/tasks/:id', {
    schema: {
      description: '更新工作台任务',
      tags: ['Workbench'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          chatRoomId: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'dispatched', 'in_progress', 'waiting_review', 'needs_input', 'completed'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
          dueText: { type: 'string', nullable: true },
          expectedOutput: { type: 'string', nullable: true },
          note: { type: 'string', nullable: true },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: workbenchTaskSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      const task = await workbenchTaskService.update(request.params.id, request.body, user.id);
      return reply.send({ success: true, data: task });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '更新任务失败' });
    }
  });

  app.delete<{ Params: TaskParams }>('/workbench/tasks/:id', {
    schema: {
      description: '删除工作台任务',
      tags: ['Workbench'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      await workbenchTaskService.delete(request.params.id, user.id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '删除任务失败' });
    }
  });

  app.post<{ Params: TaskParams }>('/workbench/tasks/:id/dispatch', {
    schema: {
      description: '派发单个工作台任务到群聊',
      tags: ['Workbench'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: workbenchTaskSchema,
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      const task = await workbenchTaskService.dispatch(request.params.id, {
        id: user.id,
        username: user.username,
      });
      return reply.send({ success: true, data: task });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '派发任务失败' });
    }
  });

  app.post<{ Body: DispatchManyBody }>('/workbench/tasks/dispatch-batch', {
    schema: {
      description: '批量派发工作台任务到群聊',
      tags: ['Workbench'],
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: workbenchTaskSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const user = getUser(request);
      const tasks = await workbenchTaskService.dispatchMany(request.body.ids, {
        id: user.id,
        username: user.username,
      });
      return reply.send({ success: true, data: tasks });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '批量派发任务失败' });
    }
  });

  // 获取群调度助手日志（按群聊分组）
  app.get('/coordinator-logs', {
    schema: {
      description: '获取群调度助手决策日志，按群聊分组',
      tags: ['Coordinator'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    chatRoomId: { type: 'string' },
                    triggerMessageId: { type: 'string' },
                    decision: { type: 'string' },
                    targetAgentIds: { type: 'array', items: { type: 'string' }, nullable: true },
                    content: { type: 'string', nullable: true },
                    forwardVerbatim: { type: 'boolean' },
                    reason: { type: 'string', nullable: true },
                    sourceAgentId: { type: 'string', nullable: true },
                    sourceIsHuman: { type: 'boolean' },
                    sourceContent: { type: 'string', nullable: true },
                    success: { type: 'boolean' },
                    errorMessage: { type: 'string', nullable: true },
                    createdAt: { type: 'string' },
                    chatRoom: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        avatar: { type: 'string', nullable: true },
                      },
                    },
                    sourceAgent: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
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
  }, async (request, reply) => {
    try {
      const groupedLogs = await coordinatorLogService.findByChatRoomGrouped();
      // 将 Map 转换为普通对象，并将 targetAgentIds 解析为数组
      const result: Record<string, any[]> = {};
      for (const [chatRoomId, logs] of groupedLogs) {
        result[chatRoomId] = logs.map(log => ({
          ...log,
          targetAgentIds: log.targetAgentIds ? JSON.parse(log.targetAgentIds) : null,
          createdAt: log.createdAt.toISOString(),
        }));
      }
      return reply.send({ success: true, data: result });
    } catch (error) {
      return (reply as any).code(400).send({ success: false, error: error instanceof Error ? error.message : '获取调度日志失败' });
    }
  });

  // 获取单个群聊的调度日志
  app.get<{ Params: { chatRoomId: string } }>('/coordinator-logs/:chatRoomId', {
    schema: {
      description: '获取指定群聊的群调度助手决策日志',
      tags: ['Coordinator'],
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
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  chatRoomId: { type: 'string' },
                  triggerMessageId: { type: 'string' },
                  decision: { type: 'string' },
                  targetAgentIds: { type: 'array', items: { type: 'string' }, nullable: true },
                  content: { type: 'string', nullable: true },
                  forwardVerbatim: { type: 'boolean' },
                  reason: { type: 'string', nullable: true },
                  sourceAgentId: { type: 'string', nullable: true },
                  sourceIsHuman: { type: 'boolean' },
                  sourceContent: { type: 'string', nullable: true },
                  success: { type: 'boolean' },
                  errorMessage: { type: 'string', nullable: true },
                  createdAt: { type: 'string' },
                  chatRoom: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      avatar: { type: 'string', nullable: true },
                    },
                  },
                  sourceAgent: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
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
    try {
      const logs = await coordinatorLogService.findByChatRoom(request.params.chatRoomId);
      const data = logs.map(log => ({
        ...log,
        targetAgentIds: log.targetAgentIds ? JSON.parse(log.targetAgentIds) : null,
        createdAt: log.createdAt.toISOString(),
      }));
      return reply.send({ success: true, data });
    } catch (error) {
      return (reply as any).code(400).send({ success: false, error: error instanceof Error ? error.message : '获取调度日志失败' });
    }
  });
}
