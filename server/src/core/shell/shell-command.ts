import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import treeKill from 'tree-kill';
import { detectBlocking, BLOCK_DETECTION_CONFIG, type BlockDetectionResult } from './block-detector.js';
import { TaskOutput } from './task-output.js';
import { getDefaultShell } from './default-shell.js';

/**
 * Shell 命令状态
 */
export type ShellCommandState = 'pending' | 'running' | 'backgrounded' | 'completed' | 'killed' | 'error';

/**
 * 命令执行结果
 */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  interrupted: boolean;
  backgroundTaskId?: string;
}

/**
 * Shell 命令配置
 */
export interface ShellCommandOptions {
  timeout?: number;           // 前台超时时间（毫秒）
  shell?: string;             // 使用的 shell
  env?: NodeJS.ProcessEnv;    // 环境变量
  autoBackground?: boolean;   // 超时时是否自动切换到后台
}

/**
 * 阻塞回调类型
 */
export type BlockCallback = (result: BlockDetectionResult, tailContent: string) => void;

/**
 * ShellCommand - 封装 child_process，支持前台/后台切换
 *
 * 设计参考 Claude Code 的 ShellCommand 类：
 * - 状态机管理：pending -> running -> backgrounded/completed/killed
 * - 前台超时切换到后台（不终止）
 * - 阻塞检测集成
 * - 输出直接写入文件
 */
export class ShellCommand {
  readonly id: string;
  readonly command: string;
  readonly workDir: string;

  private process: ChildProcess | null = null;
  private taskOutput: TaskOutput;
  private state: ShellCommandState = 'pending';
  private options: ShellCommandOptions;

  // 超时管理
  private foregroundTimeout: NodeJS.Timeout | null = null;
  private maxTimeout: NodeJS.Timeout | null = null;
  private blockCheckInterval: NodeJS.Timeout | null = null;

  // 阻塞检测状态
  private lastOutputTime: Date = new Date();
  private previousSize: number = 0;
  private blockedNotified: boolean = false;
  private blockCallback: BlockCallback | null = null;

  // 结果 Promise
  private resultResolver: ((result: CommandResult) => void) | null = null;
  private exitCodeResolver: ((code: number) => void) | null = null;

  // 默认配置
  // 15 秒后自动切换后台（让 agent 保持响应）
  private readonly DEFAULT_TIMEOUT = 15 * 1000;
  // 30 分钟后强制终止进程
  private readonly MAX_TIMEOUT = 30 * 60 * 1000;

  constructor(
    id: string | undefined,
    command: string,
    workDir: string,
    options: ShellCommandOptions = {}
  ) {
    this.id = id || randomUUID();
    this.command = command;
    this.workDir = workDir;
    this.options = {
      timeout: options.timeout ?? this.DEFAULT_TIMEOUT,
      shell: options.shell ?? getDefaultShell(),
      env: options.env ?? process.env,
      autoBackground: options.autoBackground ?? true,
    };

    this.taskOutput = new TaskOutput(this.id, workDir);
  }

  /**
   * 获取当前状态
   */
  getState(): ShellCommandState {
    return this.state;
  }

  /**
   * 获取 TaskOutput 实例
   */
  getTaskOutput(): TaskOutput {
    return this.taskOutput;
  }

  /**
   * 设置阻塞回调
   */
  onBlock(callback: BlockCallback): void {
    this.blockCallback = callback;
  }

  /**
   * 执行命令（前台模式）
   */
  async run(signal?: AbortSignal): Promise<CommandResult> {
    if (this.state !== 'pending') {
      throw new Error(`Cannot run command in state: ${this.state}`);
    }

    this.state = 'running';

    // 创建结果 Promise
    const resultPromise = new Promise<CommandResult>((resolve) => {
      this.resultResolver = resolve;
    });

    // 创建退出码 Promise
    const exitPromise = new Promise<number>((resolve) => {
      this.exitCodeResolver = resolve;
    });

    // 启动进程
    this.process = spawn(this.command, [], {
      cwd: this.workDir,
      shell: this.options.shell,
      env: this.options.env,
      // stdout/stderr 直接写入文件 fd
      stdio: ['ignore', this.taskOutput.getStdoutFd(), this.taskOutput.getStderrFd()],
      detached: false,
    });

    // 设置前台超时
    this.startForegroundTimeout();

    // 设置最大超时（后台运行的最长时间）
    this.startMaxTimeout();

    // 启动阻塞检测
    this.startBlockDetection();

    // 监听 abort 信号
    if (signal) {
      signal.addEventListener('abort', () => {
        if (signal.reason === 'interrupt') {
          // 用户中断，切换到后台
          this.background();
        } else {
          // 其他原因，终止进程
          this.kill();
        }
      });
    }

    // 监听进程退出
    this.process.once('exit', (code, signal) => {
      const exitCode = code ?? (signal === 'SIGTERM' ? 143 : 1);
      // 先解析退出码，让 exitPromise resolve
      this.resolveExitCode(exitCode);
      // 然后处理退出（异步，不阻塞）
      this.handleExit(exitCode).catch(err => {
        console.error(`[ShellCommand] ${this.id}: handleExit error:`, err);
      });
    });

    this.process.once('error', (err) => {
      console.error(`[ShellCommand] ${this.id}: process error:`, err);
      this.resolveExitCode(1);
      this.handleExit(1).catch(err => {
        console.error(`[ShellCommand] ${this.id}: handleExit error:`, err);
      });
    });

    // 等待退出
    await exitPromise;

    // 返回结果
    return resultPromise;
  }

  /**
   * 切换到后台模式
   */
  background(): boolean {
    if (this.state !== 'running') {
      return false;
    }

    console.log(`[ShellCommand] ${this.id}: 切换到后台模式`);

    this.state = 'backgrounded';

    // 清理前台超时
    this.clearForegroundTimeout();

    // 立即 resolve 退出码，让 run() 方法返回
    this.resolveExitCode(0);

    // 立即返回结果，让调用者知道已切换到后台
    if (this.resultResolver) {
      this.resultResolver({
        code: 0,
        stdout: '',
        stderr: '',
        interrupted: false,
        backgroundTaskId: this.id,
      });
      this.resultResolver = null;
    }

    return true;
  }

  /**
   * 终止进程
   */
  kill(): void {
    if (this.state === 'completed' || this.state === 'killed') {
      return;
    }

    console.log(`[ShellCommand] ${this.id}: 终止进程`);

    this.state = 'killed';
    this.clearForegroundTimeout();
    this.stopBlockDetection();

    if (this.process?.pid) {
      treeKill(this.process.pid, 'SIGKILL');
    }

    this.resolveExitCode(137); // SIGKILL
  }

  /**
   * 获取当前输出
   */
  async getOutput(): Promise<{ stdout: string; stderr: string }> {
    return this.taskOutput.getOutput();
  }

  /**
   * 处理进程退出
   */
  private async handleExit(code: number): Promise<void> {
    this.clearForegroundTimeout();
    this.stopBlockDetection();

    // 记录是否是后台任务
    const wasBackgrounded = this.state === 'backgrounded';

    if (this.state === 'running' || this.state === 'backgrounded') {
      this.state = code === 0 ? 'completed' : 'error';
    }

    const { stdout, stderr } = await this.taskOutput.getOutput();

    const result: CommandResult = {
      code,
      stdout,
      stderr,
      interrupted: code === 137,
      backgroundTaskId: wasBackgrounded ? this.id : undefined,
    };

    if (this.resultResolver) {
      this.resultResolver(result);
      this.resultResolver = null;
    }
  }

  /**
   * 解析退出码
   */
  private resolveExitCode(code: number): void {
    if (this.exitCodeResolver) {
      this.exitCodeResolver(code);
      this.exitCodeResolver = null;
    }
  }

  /**
   * 启动前台超时
   */
  private startForegroundTimeout(): void {
    const timeout = this.options.timeout ?? this.DEFAULT_TIMEOUT;

    this.foregroundTimeout = setTimeout(() => {
      if (this.state !== 'running') return;

      console.log(`[ShellCommand] ${this.id}: 前台超时 (${timeout}ms)`);

      if (this.options.autoBackground) {
        // 自动切换到后台
        this.background();
      } else {
        // 终止进程
        this.kill();
      }
    }, timeout);
  }

  /**
   * 清理前台超时
   */
  private clearForegroundTimeout(): void {
    if (this.foregroundTimeout) {
      clearTimeout(this.foregroundTimeout);
      this.foregroundTimeout = null;
    }
  }

  /**
   * 启动最大超时（后台运行的最长时间）
   */
  private startMaxTimeout(): void {
    this.maxTimeout = setTimeout(() => {
      if (this.state === 'completed' || this.state === 'killed') return;

      console.log(`[ShellCommand] ${this.id}: 达到最大超时 (${this.MAX_TIMEOUT}ms)，强制终止进程`);

      // 强制终止进程
      this.kill();
    }, this.MAX_TIMEOUT);

    // 允许事件循环退出
    if (this.maxTimeout.unref) {
      this.maxTimeout.unref();
    }
  }

  /**
   * 清理最大超时
   */
  private clearMaxTimeout(): void {
    if (this.maxTimeout) {
      clearTimeout(this.maxTimeout);
      this.maxTimeout = null;
    }
  }

  /**
   * 启动阻塞检测
   */
  private startBlockDetection(): void {
    this.blockCheckInterval = setInterval(async () => {
      if (this.state !== 'running' && this.state !== 'backgrounded') {
        return;
      }

      try {
        const { stdout } = await this.taskOutput.getSize();
        const tailResult = await this.taskOutput.readStdoutTail(BLOCK_DETECTION_CONFIG.TAIL_BYTES);

        const result = detectBlocking(
          this.lastOutputTime,
          stdout,
          this.previousSize,
          tailResult.content
        );

        // 更新状态
        if (stdout !== this.previousSize) {
          this.lastOutputTime = new Date();
          this.previousSize = stdout;
          this.blockedNotified = false;
        }

        // 检测到阻塞且未通知过
        if (result.blocked && !this.blockedNotified && this.blockCallback) {
          this.blockedNotified = true;
          this.blockCallback(result, tailResult.content);
        }
      } catch (err) {
        console.error(`[ShellCommand] ${this.id}: 阻塞检测错误:`, err);
      }
    }, BLOCK_DETECTION_CONFIG.CHECK_INTERVAL_MS);

    // 允许事件循环退出
    if (this.blockCheckInterval.unref) {
      this.blockCheckInterval.unref();
    }
  }

  /**
   * 停止阻塞检测
   */
  private stopBlockDetection(): void {
    if (this.blockCheckInterval) {
      clearInterval(this.blockCheckInterval);
      this.blockCheckInterval = null;
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.clearForegroundTimeout();
    this.clearMaxTimeout();
    this.stopBlockDetection();
    this.taskOutput.cleanup();
    this.process = null;
  }
}

/**
 * 前台超时错误
 */
export class ForegroundTimeoutError extends Error {
  constructor(message: string = 'Command timed out in foreground mode') {
    super(message);
    this.name = 'ForegroundTimeoutError';
  }
}
