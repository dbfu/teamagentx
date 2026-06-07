import { randomUUID } from 'crypto';
import type { BackgroundTask } from '@prisma/client';
import prisma from '../../lib/prisma.js';
import { ShellCommand, type ShellCommandState } from './shell-command.js';

/**
 * BackgroundTaskManager - 后台任务管理器
 *
 * 功能：
 * - 内存中追踪后台任务
 * - 持久化到 SQLite
 * - 支持查询、终止、清理
 */
class BackgroundTaskManager {
  // 内存中的任务映射
  private tasks: Map<string, BackgroundTask> = new Map();

  // ShellCommand 实例映射
  private shellCommands: Map<string, ShellCommand> = new Map();

  /**
   * 注册新的后台任务
   */
  async register(
    task: {
      chatRoomId: string;
      agentId: string;
      agentName: string;
      command: string;
      workDir: string;
      pid?: number;
      state?: string;
      exitCode?: number;
      stdoutPath: string;
      stderrPath: string;
    },
    shellCommand: ShellCommand
  ): Promise<BackgroundTask> {
    const id = randomUUID();

    const dbTask = await prisma.backgroundTask.create({
      data: {
        id,
        chatRoomId: task.chatRoomId,
        agentId: task.agentId,
        agentName: task.agentName,
        command: task.command,
        workDir: task.workDir,
        pid: task.pid,
        state: task.state || 'running',
        exitCode: task.exitCode,
        stdoutPath: task.stdoutPath,
        stderrPath: task.stderrPath,
      },
    });

    this.tasks.set(id, dbTask);
    this.shellCommands.set(id, shellCommand);

    console.log(`[BackgroundTaskManager] 注册后台任务: ${id} (${task.command})`);

    return dbTask;
  }

  /**
   * 更新任务状态
   */
  async updateState(taskId: string, state: ShellCommandState, exitCode?: number): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const updatedTask = await prisma.backgroundTask.update({
      where: { id: taskId },
      data: {
        state,
        exitCode,
        completedAt: state === 'completed' || state === 'killed' || state === 'error' ? new Date() : undefined,
      },
    });

    this.tasks.set(taskId, updatedTask);

    // 如果任务完成，清理 ShellCommand
    if (state === 'completed' || state === 'killed' || state === 'error') {
      const shellCommand = this.shellCommands.get(taskId);
      if (shellCommand) {
        shellCommand.cleanup();
        this.shellCommands.delete(taskId);
      }
    }

    console.log(`[BackgroundTaskManager] 更新任务状态: ${taskId} -> ${state}`);
  }

  /**
   * 更新最后输出时间（用于阻塞检测）
   */
  async updateLastOutputTime(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    await prisma.backgroundTask.update({
      where: { id: taskId },
      data: { lastOutputAt: new Date() },
    });
  }

  /**
   * 标记已发送阻塞通知
   */
  async markBlockedNotified(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    await prisma.backgroundTask.update({
      where: { id: taskId },
      data: { blockedNotified: true },
    });
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取 ShellCommand 实例
   */
  getShellCommand(taskId: string): ShellCommand | undefined {
    return this.shellCommands.get(taskId);
  }

  /**
   * 获取指定群聊和助手的所有后台任务
   */
  getTasksByAgent(chatRoomId: string, agentId: string): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.chatRoomId === chatRoomId && task.agentId === agentId
    );
  }

  /**
   * 获取指定群聊的所有后台任务
   */
  getTasksByChatRoom(chatRoomId: string): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.chatRoomId === chatRoomId);
  }

  /**
   * 获取所有运行中的任务
   */
  getAllRunning(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.state === 'running' || task.state === 'backgrounded'
    );
  }

  /**
   * 终止任务
   */
  async kill(taskId: string): Promise<boolean> {
    const shellCommand = this.shellCommands.get(taskId);
    if (!shellCommand) {
      // 任务可能已完成，从数据库检查
      const task = await prisma.backgroundTask.findUnique({ where: { id: taskId } });
      if (!task || task.state === 'completed' || task.state === 'killed') {
        return false;
      }
      return false;
    }

    shellCommand.kill();
    await this.updateState(taskId, 'killed');

    console.log(`[BackgroundTaskManager] 终止任务: ${taskId}`);

    return true;
  }

  /**
   * 清理已完成的任务
   */
  async cleanupCompleted(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() - maxAgeMs);

    const completedTasks = Array.from(this.tasks.values()).filter(
      (task) =>
        (task.state === 'completed' || task.state === 'killed' || task.state === 'error') &&
        task.completedAt &&
        task.completedAt < cutoff
    );

    for (const task of completedTasks) {
      this.tasks.delete(task.id);
      this.shellCommands.delete(task.id);

      // 删除输出文件
      // TODO: 实现文件删除逻辑

      // 从数据库删除
      await prisma.backgroundTask.delete({ where: { id: task.id } });
    }

    if (completedTasks.length > 0) {
      console.log(`[BackgroundTaskManager] 清理了 ${completedTasks.length} 个已完成任务`);
    }
  }

  /**
   * 从数据库加载持久化的任务
   */
  async loadPersisted(): Promise<void> {
    const runningTasks = await prisma.backgroundTask.findMany({
      where: {
        state: { in: ['running', 'backgrounded'] },
      },
    });

    for (const task of runningTasks) {
      this.tasks.set(task.id, task);
      // 注意：ShellCommand 实例需要重新创建，因为进程已经不存在
      // 这里只是加载任务记录，实际进程可能已经结束
    }

    console.log(`[BackgroundTaskManager] 加载了 ${runningTasks.length} 个持久化任务`);
  }

  /**
   * 清理所有运行中的任务（启动时调用）
   * 将所有运行中的任务标记为中断
   */
  async cleanupRunningTasks(): Promise<void> {
    const runningTasks = await prisma.backgroundTask.findMany({
      where: {
        state: { in: ['running', 'backgrounded'] },
      },
    });

    if (runningTasks.length === 0) {
      return;
    }

    // 批量更新所有运行中的任务为中断状态
    await prisma.backgroundTask.updateMany({
      where: {
        state: { in: ['running', 'backgrounded'] },
      },
      data: {
        state: 'killed',
        completedAt: new Date(),
      },
    });

    console.log(`[BackgroundTaskManager] 已将 ${runningTasks.length} 个运行中的任务标记为中断`);
  }

  /**
   * 获取任务输出
   */
  async getTaskOutput(taskId: string): Promise<{ stdout: string; stderr: string } | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const shellCommand = this.shellCommands.get(taskId);
    if (shellCommand) {
      return shellCommand.getOutput();
    }

    // 从文件读取
    const fs = await import('fs/promises');
    try {
      const stdout = await fs.readFile(task.stdoutPath, 'utf-8');
      const stderr = await fs.readFile(task.stderrPath, 'utf-8');
      return { stdout, stderr };
    } catch {
      return null;
    }
  }
}

// 单例实例
export const backgroundTaskManager = new BackgroundTaskManager();
