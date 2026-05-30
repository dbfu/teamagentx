import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import treeKill from 'tree-kill';
import type { BackgroundTask } from '@prisma/client';
import prisma from '../../lib/prisma.js';

type ManagedProcess = {
  child: ChildProcess;
  stdoutFd: number;
  stderrFd: number;
};

export type BackgroundCommandSnapshot = BackgroundTask & {
  stdoutTail?: string;
  stderrTail?: string;
};

export interface StartBackgroundCommandInput {
  chatRoomId: string;
  agentId: string;
  agentName: string;
  command: string;
  workDir: string;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TAIL_BYTES = 12 * 1024;
const MAX_TAIL_BYTES = 128 * 1024;
const TERMINAL_STATES = new Set(['completed', 'killed', 'error']);

function normalizeTailBytes(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TAIL_BYTES;
  return Math.min(parsed, MAX_TAIL_BYTES);
}

async function readTail(filePath: string, bytes: number): Promise<string> {
  try {
    const stat = await fsp.stat(filePath);
    const start = Math.max(0, stat.size - bytes);
    const handle = await fsp.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString('utf-8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}

function closeFd(fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore close races after process exit.
  }
}

class BackgroundCommandService {
  private processes = new Map<string, ManagedProcess>();

  async start(input: StartBackgroundCommandInput): Promise<BackgroundCommandSnapshot> {
    const command = input.command.trim();
    if (!command) {
      throw new Error('command is required');
    }

    const workDir = path.resolve(input.workDir);
    const stat = fs.existsSync(workDir) ? fs.statSync(workDir) : null;
    if (!stat?.isDirectory()) {
      throw new Error(`workDir does not exist: ${workDir}`);
    }

    const taskId = randomUUID();
    const outputDir = path.join(workDir, '.teamagentx-output');
    fs.mkdirSync(outputDir, {recursive: true});
    const stdoutPath = path.join(outputDir, `${taskId}.stdout`);
    const stderrPath = path.join(outputDir, `${taskId}.stderr`);
    const stdoutFd = fs.openSync(stdoutPath, 'a');
    const stderrFd = fs.openSync(stderrPath, 'a');

    await prisma.backgroundTask.create({
      data: {
        id: taskId,
        chatRoomId: input.chatRoomId,
        agentId: input.agentId,
        agentName: input.agentName,
        command,
        workDir,
        state: 'pending',
        stdoutPath,
        stderrPath,
      },
    });

    let child: ChildProcess;
    try {
      child = spawn(command, [], {
        cwd: workDir,
        shell: process.env.SHELL || '/bin/bash',
        env: input.env ?? process.env,
        stdio: ['ignore', stdoutFd, stderrFd],
        detached: false,
      });
    } catch (error) {
      closeFd(stdoutFd);
      closeFd(stderrFd);
      await this.markTerminal(taskId, 'error', 1);
      throw error;
    }

    this.processes.set(taskId, {child, stdoutFd, stderrFd});

    await prisma.backgroundTask.updateMany({
      where: {id: taskId, state: 'pending'},
      data: {
        pid: child.pid,
        state: 'backgrounded',
      },
    });

    child.once('error', async () => {
      this.closeProcess(taskId);
      await this.markTerminal(taskId, 'error', 1);
    });

    child.once('exit', async (code, signal) => {
      this.closeProcess(taskId);
      const exitCode = code ?? (signal === 'SIGTERM' ? 143 : 1);
      await this.markTerminal(taskId, exitCode === 0 ? 'completed' : 'error', exitCode);
    });

    return this.read(taskId, input.chatRoomId, input.agentId);
  }

  async list(chatRoomId: string, agentId: string): Promise<BackgroundTask[]> {
    return prisma.backgroundTask.findMany({
      where: {chatRoomId, agentId},
      orderBy: {startedAt: 'desc'},
      take: 20,
    });
  }

  async read(
    taskId: string,
    chatRoomId: string,
    agentId: string,
    tailBytes: unknown = DEFAULT_TAIL_BYTES,
  ): Promise<BackgroundCommandSnapshot> {
    const task = await this.getScopedTask(taskId, chatRoomId, agentId);
    const bytes = normalizeTailBytes(tailBytes);
    return {
      ...task,
      stdoutTail: await readTail(task.stdoutPath, bytes),
      stderrTail: await readTail(task.stderrPath, bytes),
    };
  }

  async stop(taskId: string, chatRoomId: string, agentId: string): Promise<BackgroundCommandSnapshot> {
    const task = await this.getScopedTask(taskId, chatRoomId, agentId);
    if (TERMINAL_STATES.has(task.state)) {
      return this.read(taskId, chatRoomId, agentId);
    }

    const managed = this.processes.get(taskId);
    if (managed?.child.pid) {
      await new Promise<void>((resolve) => {
        treeKill(managed.child.pid!, 'SIGKILL', () => resolve());
      });
    } else if (task.pid) {
      await new Promise<void>((resolve) => {
        treeKill(task.pid!, 'SIGKILL', () => resolve());
      });
    }

    this.closeProcess(taskId);
    await this.markTerminal(taskId, 'killed', 137);
    return this.read(taskId, chatRoomId, agentId);
  }

  private async getScopedTask(
    taskId: string,
    chatRoomId: string,
    agentId: string,
  ): Promise<BackgroundTask> {
    const task = await prisma.backgroundTask.findUnique({where: {id: taskId}});
    if (!task || task.chatRoomId !== chatRoomId || task.agentId !== agentId) {
      throw new Error('background task not found');
    }
    return task;
  }

  private closeProcess(taskId: string): void {
    const managed = this.processes.get(taskId);
    if (!managed) return;
    closeFd(managed.stdoutFd);
    closeFd(managed.stderrFd);
    this.processes.delete(taskId);
  }

  private async markTerminal(taskId: string, state: 'completed' | 'killed' | 'error', exitCode: number): Promise<void> {
    const current = await prisma.backgroundTask.findUnique({where: {id: taskId}});
    if (!current || TERMINAL_STATES.has(current.state)) return;

    await prisma.backgroundTask.update({
      where: {id: taskId},
      data: {
        state,
        exitCode,
        completedAt: new Date(),
      },
    });

    // 任务结束后清理输出文件，目录为空时一并删除
    for (const filePath of [current.stdoutPath, current.stderrPath]) {
      try { await fsp.unlink(filePath); } catch { /* 文件可能已不存在 */ }
    }
    try {
      const outputDir = path.dirname(current.stdoutPath);
      const remaining = await fsp.readdir(outputDir);
      if (remaining.length === 0) await fsp.rmdir(outputDir);
    } catch { /* 目录不存在或非空时忽略 */ }
  }
}

export const backgroundCommandService = new BackgroundCommandService();
