import { Cron } from 'croner';
import { cronTaskService, type CronTaskWithRelations } from '../../modules/cron-task/cron-task.service.js';
import { ScheduleType, CronTaskState } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { agentService } from '../agent/agent.service.js';

// 系统内置助手的 ID（触发所有助手时需要过滤掉）
const SYSTEM_BUILTIN_AGENT_IDS = [
  '596667f7-f901-4613-92a7-cc71d859fa22', // 技能安装助手
  '29ffb519-82d2-4c32-8bc8-0b8d814a4eee', // 助手生成器
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // 定时任务助手
];

interface ScheduledJob {
  taskId: string;
  cronJob: Cron | null;
  intervalTimer: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
}

// 广播定时任务触发消息的函数引用（由 agent.handler 通过 setBroadcastFn 设置）
let broadcastCronTriggerMessageFn: ((chatRoomId: string, taskName: string, payload: string) => Promise<string>) | null = null;

// 设置广播触发消息函数引用（由 agent.handler 在初始化时调用）
export function setBroadcastCronTriggerMessageFn(fn: (chatRoomId: string, taskName: string, payload: string) => Promise<string>) {
  broadcastCronTriggerMessageFn = fn;
}

class CronSchedulerService {
  private jobs: Map<string, ScheduledJob> = new Map();
  private intervalCheckTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // 启动调度器
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[CronScheduler] Already running');
      return;
    }

    console.log('[CronScheduler] Starting scheduler...');
    this.isRunning = true;

    // 加载所有启用的任务
    await this.loadAllTasks();

    // 启动定时检查（每分钟检查一次，处理遗漏的任务）
    this.intervalCheckTimer = setInterval(() => {
      this.checkPendingTasks();
    }, 60 * 1000);

    console.log('[CronScheduler] Scheduler started');
  }

  // 停止调度器
  async stop(): Promise<void> {
    console.log('[CronScheduler] Stopping scheduler...');
    this.isRunning = false;

    // 清除所有任务
    for (const [taskId, job] of this.jobs.entries()) {
      this.clearJob(job);
    }
    this.jobs.clear();

    // 清除定时检查
    if (this.intervalCheckTimer) {
      clearInterval(this.intervalCheckTimer);
      this.intervalCheckTimer = null;
    }

    console.log('[CronScheduler] Scheduler stopped');
  }

  // 加载所有启用的任务
  async loadAllTasks(): Promise<void> {
    const tasks = await prisma.cronTask.findMany({
      where: { enabled: true },
      include: {
        chatRoom: { select: { id: true, name: true } },
      },
    });

    console.log(`[CronScheduler] Loading ${tasks.length} tasks`);

    for (const task of tasks) {
      await this.scheduleTask(task);
    }
  }

  // 调度单个任务
  async scheduleTask(task: CronTaskWithRelations): Promise<void> {
    // 如果已有相同任务的调度，先清除
    if (this.jobs.has(task.id)) {
      await this.unscheduleTask(task.id);
    }

    let job: ScheduledJob = {
      taskId: task.id,
      cronJob: null,
      intervalTimer: null,
      timeoutTimer: null,
    };

    switch (task.scheduleType) {
      case ScheduleType.cron:
        if (task.cronExpression) {
          job.cronJob = new Cron(
            task.cronExpression,
            { timezone: 'Asia/Shanghai' },
            async () => {
              await this.executeTask(task);
            }
          );
          console.log(`[CronScheduler] Scheduled cron task: ${task.name} (${task.cronExpression})`);
        }
        break;

      case ScheduleType.interval:
        if (task.intervalMinutes) {
          job.intervalTimer = setInterval(
            async () => {
              await this.executeTask(task);
            },
            task.intervalMinutes * 60 * 1000
          );
          console.log(`[CronScheduler] Scheduled interval task: ${task.name} (every ${task.intervalMinutes} minutes)`);
        }
        break;

      case ScheduleType.once:
        if (task.scheduledAt) {
          const delay = task.scheduledAt.getTime() - Date.now();
          if (delay > 0) {
            job.timeoutTimer = setTimeout(
              async () => {
                await this.executeTask(task);
                // 一次性任务执行后自动禁用
                await cronTaskService.setEnabled(task.id, false);
                this.unscheduleTask(task.id);
              },
              delay
            );
            console.log(`[CronScheduler] Scheduled once task: ${task.name} (at ${task.scheduledAt.toISOString()})`);
          } else {
            // 已过期，立即执行
            console.log(`[CronScheduler] Task ${task.name} is overdue, executing immediately`);
            await this.executeTask(task);
            await cronTaskService.setEnabled(task.id, false);
          }
        }
        break;
    }

    this.jobs.set(task.id, job);

    // 更新 nextRunAt
    await this.updateNextRunAt(task);
  }

  // 取消调度任务
  async unscheduleTask(taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);
    if (job) {
      this.clearJob(job);
      this.jobs.delete(taskId);
      console.log(`[CronScheduler] Unscheduled task: ${taskId}`);
    }
  }

  // 清除调度作业
  clearJob(job: ScheduledJob): void {
    if (job.cronJob) {
      job.cronJob.stop();
    }
    if (job.intervalTimer) {
      clearInterval(job.intervalTimer);
    }
    if (job.timeoutTimer) {
      clearTimeout(job.timeoutTimer);
    }
  }

  // 执行任务（直接发送消息到群里）
  async executeTask(task: CronTaskWithRelations): Promise<void> {
    console.log(`[CronScheduler] Executing task: ${task.name} (${task.id})`);

    // 检查是否已经在运行
    const currentTask = await cronTaskService.findById(task.id);
    if (!currentTask || currentTask.state === CronTaskState.running) {
      console.log(`[CronScheduler] Task ${task.name} is already running or not found`);
      return;
    }

    // 更新状态为 running
    await cronTaskService.updateExecutionState(task.id, CronTaskState.running);

    // 创建执行记录
    const execution = await cronTaskService.createExecution({
      cronTaskId: task.id,
      payloadSnapshot: task.payload,
    });

    try {
      // 解析 agentIds，构建带 @助手 的消息内容
      let finalPayload = task.payload;
      const agentIdsRaw = task.agentIds || '[]';
      const agentIds: string[] = JSON.parse(agentIdsRaw);

      if (agentIds.length > 0) {
        // 获取群聊中的助手列表
        const chatRoomAgents = await prisma.chatRoomAgent.findMany({
          where: { chatRoomId: task.chatRoomId },
          include: {
            agent: { select: { id: true, name: true } },
          },
        });

        let mentionPrefix = '';

        if (agentIds.includes('*')) {
          // "所有助手" - @ 群聊中的所有助手（排除系统内置助手）
          const allAgentNames = chatRoomAgents
            .filter(a => a.agent && !SYSTEM_BUILTIN_AGENT_IDS.includes(a.agent.id))
            .map(a => a.agent!.name);
          mentionPrefix = allAgentNames.map(name => `@${name}`).join(' ') + ' ';
        } else {
          // 指定助手 - 只 @ 选中的助手
          const selectedAgents = chatRoomAgents
            .filter(a => a.agent && agentIds.includes(a.agent.id))
            .map(a => a.agent!.name);
          mentionPrefix = selectedAgents.map(name => `@${name}`).join(' ') + ' ';
        }

        // 在 payload 前面添加 @助手名
        finalPayload = mentionPrefix + task.payload;
      }

      // 广播定时任务触发消息到群里（消息内容包含 @助手 标记）
      if (broadcastCronTriggerMessageFn) {
        await broadcastCronTriggerMessageFn(task.chatRoomId, task.name, finalPayload);
      }

      // 更新执行记录
      await cronTaskService.updateExecution(execution.id, {
        startedAt: new Date(),
        completedAt: new Date(),
        state: CronTaskState.completed,
      });

      // 更新任务状态
      await cronTaskService.updateExecutionState(
        task.id,
        CronTaskState.completed,
        new Date(),
        undefined,
        undefined
      );

      // 更新下次执行时间
      await this.updateNextRunAt(task);

      console.log(`[CronScheduler] Task ${task.name} completed successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[CronScheduler] Task ${task.name} failed: ${errorMessage}`);

      // 更新执行记录
      await cronTaskService.updateExecution(execution.id, {
        startedAt: new Date(),
        completedAt: new Date(),
        state: CronTaskState.failed,
        errorMessage,
      });

      // 检查是否需要重试
      const currentTask = await cronTaskService.findById(task.id);
      if (currentTask && currentTask.retryCount < currentTask.maxRetries) {
        // 标记为 pending，等待下次执行周期重试
        await cronTaskService.updateExecutionState(
          task.id,
          CronTaskState.pending,
          new Date(),
          undefined,
          errorMessage
        );
      } else {
        // 达到最大重试次数，标记为 failed
        await cronTaskService.updateExecutionState(
          task.id,
          CronTaskState.failed,
          new Date(),
          undefined,
          errorMessage
        );
      }
    }
  }

  // 更新下次执行时间
  async updateNextRunAt(task: CronTaskWithRelations): Promise<void> {
    if (!this.isRunning) return;

    const nextRunAt = cronTaskService.calculateNextRunAt(
      task.scheduleType,
      task.cronExpression,
      task.intervalMinutes,
      task.scheduleType === ScheduleType.once ? null : null
    );

    if (nextRunAt) {
      await prisma.cronTask.update({
        where: { id: task.id },
        data: { nextRunAt },
      });
    }
  }

  // 检查待执行任务（处理遗漏的任务）
  async checkPendingTasks(): Promise<void> {
    if (!this.isRunning) return;

    const pendingTasks = await cronTaskService.getPendingTasks();

    for (const task of pendingTasks) {
      // 检查是否已调度
      if (!this.jobs.has(task.id)) {
        console.log(`[CronScheduler] Found unscheduled pending task: ${task.name}`);
        await this.scheduleTask(task);
      }

      // 如果 nextRunAt 已过期且任务不在运行，立即执行
      if (task.nextRunAt && task.nextRunAt <= new Date() && task.state !== CronTaskState.running) {
        console.log(`[CronScheduler] Found overdue task: ${task.name}`);
        await this.executeTask(task);
      }
    }
  }

  // 手动测试执行任务
  async testExecute(taskId: string): Promise<{ success: boolean; error?: string }> {
    const task = await cronTaskService.findById(taskId);
    if (!task) {
      return { success: false, error: '定时任务不存在' };
    }

    try {
      await this.executeTask(task);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 重新加载任务（用于任务更新后）
  async reloadTask(taskId: string): Promise<void> {
    const task = await cronTaskService.findById(taskId);
    if (task) {
      if (task.enabled) {
        await this.scheduleTask(task);
      } else {
        await this.unscheduleTask(taskId);
      }
    }
  }
}

export const cronSchedulerService = new CronSchedulerService();