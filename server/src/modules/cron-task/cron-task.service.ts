import prisma from '../../lib/prisma.js';
import { ScheduleType, CronTaskState } from '@prisma/client';
import { Cron } from 'croner';

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
      case ScheduleType.cron: {
        if (!cronExpression) return null;
        // 用 croner 计算，覆盖步长(*/N)、列表(1,2)、范围(1-5)等所有 cron 语法
        try {
          const next = new Cron(cronExpression, { timezone: 'Asia/Shanghai' }).nextRun();
          if (next instanceof Date && !isNaN(next.getTime())) return next;
        } catch (err) {
          console.warn(`[cronTaskService] 无效 cron 表达式 "${cronExpression}":`, err);
        }
        return null;
      }

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
};