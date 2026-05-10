import prisma from '../../lib/prisma.js';
import { ScheduleType, CronTaskState } from '@prisma/client';

export interface CreateCronTaskData {
  chatRoomId: string;
  name: string;
  description?: string;
  scheduleType: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: Date;
  payload: string;
  agentIds?: string[]; // 选中的助手 ID 列表，["*"] 表示所有助手
  enabled?: boolean;
  maxRetries?: number;
  createdBy?: string;
}

export interface UpdateCronTaskData {
  name?: string;
  description?: string;
  scheduleType?: ScheduleType;
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: Date;
  payload?: string;
  agentIds?: string[];
  enabled?: boolean;
  maxRetries?: number;
}

export interface CronTaskWithRelations {
  id: string;
  chatRoomId: string;
  name: string;
  description: string | null;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  intervalMinutes: number | null;
  scheduledAt: Date | null;
  payload: string;
  agentIds: string | null; // JSON 字符串存储
  enabled: boolean;
  maxRetries: number;
  retryCount: number;
  state: CronTaskState;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  chatRoom: { id: string; name: string };
}

export const cronTaskService = {
  // 创建定时任务
  async create(data: CreateCronTaskData): Promise<CronTaskWithRelations> {
    // 计算 nextRunAt
    const nextRunAt = this.calculateNextRunAt(
      data.scheduleType,
      data.cronExpression,
      data.intervalMinutes,
      data.scheduledAt
    );

    return prisma.cronTask.create({
      data: {
        ...data,
        agentIds: data.agentIds ? JSON.stringify(data.agentIds) : '[]',
        nextRunAt,
      },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });
  },

  // 获取群聊的所有定时任务
  async findByChatRoom(chatRoomId: string): Promise<CronTaskWithRelations[]> {
    return prisma.cronTask.findMany({
      where: { chatRoomId },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // 获取所有定时任务
  async findAll(): Promise<CronTaskWithRelations[]> {
    return prisma.cronTask.findMany({
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // 获取单个定时任务
  async findById(id: string): Promise<CronTaskWithRelations | null> {
    return prisma.cronTask.findUnique({
      where: { id },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });
  },

  // 更新定时任务
  async update(id: string, data: UpdateCronTaskData): Promise<CronTaskWithRelations> {
    // 如果更新了调度配置，重新计算 nextRunAt
    let nextRunAt: Date | null | undefined;
    if (data.scheduleType || data.cronExpression || data.intervalMinutes || data.scheduledAt) {
      const task = await prisma.cronTask.findUnique({ where: { id } });
      if (task) {
        nextRunAt = this.calculateNextRunAt(
          data.scheduleType ?? task.scheduleType,
          data.cronExpression ?? task.cronExpression,
          data.intervalMinutes ?? task.intervalMinutes,
          data.scheduledAt ?? task.scheduledAt
        ) ?? undefined;
      }
    }

    return prisma.cronTask.update({
      where: { id },
      data: {
        ...data,
        agentIds: data.agentIds ? JSON.stringify(data.agentIds) : undefined,
        nextRunAt,
        updatedAt: new Date(),
      },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });
  },

  // 启用/禁用定时任务
  async setEnabled(id: string, enabled: boolean): Promise<CronTaskWithRelations> {
    const updateData: any = { enabled, updatedAt: new Date() };

    // 启用时计算 nextRunAt，禁用时清空
    if (enabled) {
      const task = await prisma.cronTask.findUnique({ where: { id } });
      if (task) {
        updateData.nextRunAt = this.calculateNextRunAt(
          task.scheduleType,
          task.cronExpression,
          task.intervalMinutes,
          task.scheduledAt
        );
      }
    } else {
      updateData.nextRunAt = null;
    }

    return prisma.cronTask.update({
      where: { id },
      data: updateData,
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });
  },

  // 删除定时任务
  async delete(id: string): Promise<void> {
    await prisma.cronTask.delete({ where: { id } });
  },

  // 获取所有待执行的任务（调度器使用）
  async getPendingTasks(): Promise<CronTaskWithRelations[]> {
    const now = new Date();
    return prisma.cronTask.findMany({
      where: {
        enabled: true,
        state: { not: CronTaskState.running },
        nextRunAt: { lte: now },
      },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });
  },

  // 更新任务执行状态
  async updateExecutionState(
    id: string,
    state: CronTaskState,
    lastRunAt?: Date,
    nextRunAt?: Date,
    lastError?: string
  ): Promise<void> {
    await prisma.cronTask.update({
      where: { id },
      data: {
        state,
        lastRunAt,
        nextRunAt,
        lastError,
        retryCount: state === CronTaskState.failed ? { increment: 1 } : undefined,
        updatedAt: new Date(),
      },
    });
  },

  // 创建执行记录
  async createExecution(data: {
    cronTaskId: string;
    payloadSnapshot: string;
  }): Promise<{ id: string }> {
    return prisma.cronTaskExecution.create({
      data: {
        cronTaskId: data.cronTaskId,
        payloadSnapshot: data.payloadSnapshot,
        state: CronTaskState.pending,
      },
      select: { id: true },
    });
  },

  // 更新执行记录
  async updateExecution(
    id: string,
    data: {
      startedAt?: Date;
      completedAt?: Date;
      state?: CronTaskState;
      executionRecordId?: string;
      errorMessage?: string;
      duration?: number;
    }
  ): Promise<void> {
    await prisma.cronTaskExecution.update({
      where: { id },
      data,
    });
  },

  // 获取执行历史
  async getExecutions(cronTaskId: string, limit?: number): Promise<any[]> {
    return prisma.cronTaskExecution.findMany({
      where: { cronTaskId },
      orderBy: { triggeredAt: 'desc' },
      take: limit ?? 50,
    });
  },

  // 计算下次执行时间
  calculateNextRunAt(
    scheduleType: ScheduleType,
    cronExpression?: string | null,
    intervalMinutes?: number | null,
    scheduledAt?: Date | null
  ): Date | null {
    const now = new Date();

    switch (scheduleType) {
      case ScheduleType.cron:
        if (!cronExpression) return null;
        // 使用 croner 计算下次执行时间（简化处理，实际由调度器完成）
        // 这里返回一个估算值
        return this.estimateNextCronRun(cronExpression, now);

      case ScheduleType.interval:
        if (!intervalMinutes) return null;
        return new Date(now.getTime() + intervalMinutes * 60 * 1000);

      case ScheduleType.once:
        if (!scheduledAt) return null;
        return scheduledAt;

      default:
        return null;
    }
  },

  // 估算 cron 下次执行时间（简化版本）
  estimateNextCronRun(cronExpression: string, from: Date): Date {
    // 简化处理：解析常见 cron 表达式
    // 格式：minute hour day month weekday
    const parts = cronExpression.split(' ');
    if (parts.length !== 5) {
      // 无法解析，默认返回 1 小时后
      return new Date(from.getTime() + 60 * 60 * 1000);
    }

    const [minute, hour, day, month, weekday] = parts;

    // 处理通配符和固定值
    const targetMinute = minute === '*' ? from.getMinutes() : parseInt(minute, 10);
    let targetHour = hour === '*' ? from.getHours() : parseInt(hour, 10);

    // 如果当前时间已经过了目标时间，推到下一个周期
    const target = new Date(from);
    target.setMinutes(targetMinute);
    target.setSeconds(0);
    target.setMilliseconds(0);

    if (hour !== '*') {
      target.setHours(targetHour);
      if (target <= from) {
        // 如果是每小时执行，加一小时
        if (minute !== '*') {
          target.setHours(targetHour + 24);
        } else {
          target.setHours(targetHour + 1);
        }
      }
    } else {
      // 每小时执行
      if (target <= from) {
        target.setHours(target.getHours() + 1);
      }
    }

    return target;
  },
};