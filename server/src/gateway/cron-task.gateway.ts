import { FastifyInstance } from 'fastify';
import { cronTaskService } from '../modules/cron-task/cron-task.service.js';
import { cronSchedulerService } from '../core/cron/cron-scheduler.service.js';
import { ScheduleType } from '@prisma/client';

const cronTaskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    chatRoomId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    scheduleType: { type: 'string', enum: ['cron', 'interval', 'once'] },
    cronExpression: { type: 'string', nullable: true },
    intervalMinutes: { type: 'integer', nullable: true },
    scheduledAt: { type: 'string', nullable: true },
    payload: { type: 'string' },
    agentIds: { type: 'array', items: { type: 'string' }, nullable: true }, // 助手 ID 数组，["*"] 表示所有助手；执行时逐个发送
    enabled: { type: 'boolean' },
    maxRetries: { type: 'integer' },
    retryCount: { type: 'integer' },
    state: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
    lastRunAt: { type: 'string', nullable: true },
    nextRunAt: { type: 'string', nullable: true },
    lastError: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    createdBy: { type: 'string', nullable: true },
    chatRoom: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
};

const executionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    cronTaskId: { type: 'string' },
    triggeredAt: { type: 'string' },
    startedAt: { type: 'string', nullable: true },
    completedAt: { type: 'string', nullable: true },
    state: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'skipped'] },
    executionRecordId: { type: 'string', nullable: true },
    errorMessage: { type: 'string', nullable: true },
    duration: { type: 'integer', nullable: true },
    payloadSnapshot: { type: 'string' },
  },
};

interface CreateCronTaskBody {
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: string;
  payload: string;
  agentIds?: string[]; // 选中的助手 ID 列表
  enabled?: boolean;
  maxRetries?: number;
}

interface UpdateCronTaskBody {
  name?: string;
  description?: string;
  scheduleType?: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: string;
  payload?: string;
  agentIds?: string[];
  enabled?: boolean;
  maxRetries?: number;
}

interface EnableBody {
  enabled: boolean;
}

function parseAgentIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function serializeTask<T extends { agentIds: string | null }>(task: T): Omit<T, 'agentIds'> & { agentIds: string[] } {
  return { ...task, agentIds: parseAgentIds(task.agentIds) };
}

export async function cronTaskGateway(app: FastifyInstance) {
  // 获取群聊的定时任务列表
  app.get<{ Params: { chatRoomId: string } }>('/chatrooms/:chatRoomId/cron-tasks', {
    schema: {
      description: '获取群聊的定时任务列表',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: {
          chatRoomId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: cronTaskSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId } = request.params;
    const tasks = await cronTaskService.findByChatRoom(chatRoomId);
    return reply.send({ success: true, data: tasks.map(serializeTask) });
  });

  // 创建定时任务
  app.post<{ Params: { chatRoomId: string }; Body: CreateCronTaskBody }>('/chatrooms/:chatRoomId/cron-tasks', {
    schema: {
      description: '为群聊创建定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: {
          chatRoomId: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['name', 'scheduleType', 'payload'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          scheduleType: { type: 'string', enum: ['cron', 'interval', 'once'] },
          cronExpression: { type: 'string' },
          intervalMinutes: { type: 'integer' },
          scheduledAt: { type: 'string', format: 'date-time' },
          payload: { type: 'string' },
          agentIds: { type: 'array', items: { type: 'string' }, description: '选中的助手 ID 列表，["*"] 表示所有助手；多个助手会在执行时拆成多条消息逐个触发' },
          enabled: { type: 'boolean' },
          maxRetries: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: cronTaskSchema,
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
    const { chatRoomId } = request.params;
    const body = request.body;

    // 验证调度参数
    if (body.scheduleType === 'cron' && !body.cronExpression) {
      return reply.code(400).send({ success: false, error: 'cron 类型需要提供 cronExpression' });
    }
    if (body.scheduleType === 'interval' && !body.intervalMinutes) {
      return reply.code(400).send({ success: false, error: 'interval 类型需要提供 intervalMinutes' });
    }
    if (body.scheduleType === 'once' && !body.scheduledAt) {
      return reply.code(400).send({ success: false, error: 'once 类型需要提供 scheduledAt' });
    }

    const task = await cronTaskService.create({
      chatRoomId,
      name: body.name,
      description: body.description,
      scheduleType: body.scheduleType as ScheduleType,
      cronExpression: body.cronExpression,
      intervalMinutes: body.intervalMinutes,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      payload: body.payload,
      agentIds: body.agentIds,
      enabled: body.enabled ?? true,
      maxRetries: body.maxRetries ?? 3,
    });

    // 调度任务
    if (task.enabled) {
      await cronSchedulerService.reloadTask(task.id);
    }

    return reply.send({ success: true, data: serializeTask(task) });
  });

  // 获取单个定时任务
  app.get<{ Params: { taskId: string } }>('/cron-tasks/:taskId', {
    schema: {
      description: '根据 ID 获取单个定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: cronTaskSchema,
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
    const { taskId } = request.params;
    const task = await cronTaskService.findById(taskId);

    if (!task) {
      return reply.code(404).send({ success: false, error: '定时任务不存在' });
    }

    return reply.send({ success: true, data: serializeTask(task) });
  });

  // 更新定时任务
  app.put<{ Params: { taskId: string }; Body: UpdateCronTaskBody }>('/cron-tasks/:taskId', {
    schema: {
      description: '更新定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          scheduleType: { type: 'string', enum: ['cron', 'interval', 'once'] },
          cronExpression: { type: 'string' },
          intervalMinutes: { type: 'integer' },
          scheduledAt: { type: 'string', format: 'date-time' },
          payload: { type: 'string' },
          agentIds: { type: 'array', items: { type: 'string' }, description: '选中的助手 ID 列表，多个助手会在执行时拆成多条消息逐个触发' },
          enabled: { type: 'boolean' },
          maxRetries: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: cronTaskSchema,
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
    const { taskId } = request.params;
    const body = request.body;

    const task = await cronTaskService.update(taskId, {
      ...body,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      scheduleType: body.scheduleType as ScheduleType,
    });

    // 重新调度任务
    await cronSchedulerService.reloadTask(taskId);

    return reply.send({ success: true, data: serializeTask(task) });
  });

  // 启用/禁用定时任务
  app.patch<{ Params: { taskId: string }; Body: EnableBody }>('/cron-tasks/:taskId/enable', {
    schema: {
      description: '启用或禁用定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: cronTaskSchema,
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
    const { taskId } = request.params;
    const { enabled } = request.body;

    const task = await cronTaskService.setEnabled(taskId, enabled);

    // 重新调度任务
    await cronSchedulerService.reloadTask(taskId);

    return reply.send({ success: true, data: serializeTask(task) });
  });

  // 删除定时任务
  app.delete<{ Params: { taskId: string } }>('/cron-tasks/:taskId', {
    schema: {
      description: '删除定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
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
    const { taskId } = request.params;

    // 取消调度
    await cronSchedulerService.unscheduleTask(taskId);

    // 删除任务
    await cronTaskService.delete(taskId);

    return reply.send({ success: true });
  });

  // 获取执行历史
  app.get<{ Params: { taskId: string }; Querystring: { limit?: number } }>('/cron-tasks/:taskId/executions', {
    schema: {
      description: '获取定时任务的执行历史',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: executionSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { taskId } = request.params;
    const { limit = 50 } = request.query;

    const executions = await cronTaskService.getExecutions(taskId, limit);
    return reply.send({ success: true, data: executions });
  });

  // 测试执行任务
  app.post<{ Params: { taskId: string } }>('/cron-tasks/:taskId/test', {
    schema: {
      description: '立即测试执行定时任务',
      tags: ['CronTasks'],
      params: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string', nullable: true },
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
    const { taskId } = request.params;

    const task = await cronTaskService.findById(taskId);
    if (!task) {
      return reply.code(404).send({ success: false, error: '定时任务不存在' });
    }

    const result = await cronSchedulerService.testExecute(taskId);
    return reply.send(result);
  });
}
