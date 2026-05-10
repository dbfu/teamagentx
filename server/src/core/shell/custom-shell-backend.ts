import { LocalShellBackend } from 'deepagents';
import { ShellCommand, type CommandResult } from './shell-command.js';

/**
 * CustomShellBackend - 自定义 Shell 后端
 *
 * 继承 deepagents 的 LocalShellBackend，只重写 execute 方法：
 * - 使用 ShellCommand 进行命令执行
 * - 支持前台/后台切换
 * - 后台命令（使用 &）不会阻塞
 * - 超时自动切换后台
 *
 * 其他所有 BackendProtocol 方法（read, write, edit, lsInfo 等）
 * 都由 LocalShellBackend 实现，无需重复。
 */
export class CustomShellBackend extends LocalShellBackend {
  readonly #timeout: number;
  readonly #maxOutputBytes: number;
  readonly #env: Record<string, string>;

  constructor(options: {
    rootDir?: string;
    timeout?: number;
    maxOutputBytes?: number;
    env?: Record<string, string>;
    inheritEnv?: boolean;
  } = {}) {
    const {
      rootDir,
      timeout = 60,
      maxOutputBytes = 100000,
      env = {},
      inheritEnv = false
    } = options;

    // 调用父类构造函数
    super({ rootDir });

    this.#timeout = timeout;
    this.#maxOutputBytes = maxOutputBytes;

    if (inheritEnv) {
      this.#env = { ...process.env as Record<string, string>, ...env };
    } else {
      this.#env = env;
    }
  }

  /**
   * 执行 shell 命令
   *
   * 重写父类的 execute 方法，使用 ShellCommand 实现：
   * - 前台超时自动切换后台
   * - 后台命令（&）不阻塞
   * - 阻塞检测
   */
  override async execute(command: string) {
    if (!command || typeof command !== 'string') {
      return {
        output: 'Error: Command must be a non-empty string.',
        exitCode: 1,
        truncated: false,
      };
    }

    // 检测是否是后台命令（以 & 结尾）
    const isBackgroundCommand = command.trim().endsWith('&');

    try {
      const shellCommand = new ShellCommand(
        undefined,
        command,
        this.cwd,
        {
          timeout: this.#timeout * 1000, // 转换为毫秒
          autoBackground: true, // 超时自动切换后台
          env: this.#env,
        }
      );

      const result = await shellCommand.run();

      // 清理资源
      shellCommand.cleanup();

      // 格式化输出
      return this.formatOutput(result, isBackgroundCommand);

    } catch (error) {
      return {
        output: `Error executing command: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
        truncated: false,
      };
    }
  }

  /**
   * 格式化输出
   */
  private formatOutput(result: CommandResult, isBackgroundCommand: boolean) {
    const outputParts: string[] = [];

    // 处理 stdout
    if (result.stdout) {
      outputParts.push(result.stdout);
    }

    // 处理 stderr
    if (result.stderr) {
      const stderrLines = result.stderr.trim().split('\n');
      outputParts.push(...stderrLines.map(line => `[stderr] ${line}`));
    }

    // 后台命令特殊处理
    if (isBackgroundCommand && result.backgroundTaskId) {
      outputParts.push(`\n命令已在后台运行 (ID: ${result.backgroundTaskId})`);
    }

    let output = outputParts.length > 0 ? outputParts.join('\n') : '<no output>';
    let truncated = false;

    // 截断处理
    if (output.length > this.#maxOutputBytes) {
      output = output.slice(0, this.#maxOutputBytes);
      output += `\n\n... Output truncated at ${this.#maxOutputBytes} bytes.`;
      truncated = true;
    }

    // 添加退出码（非零时）
    if (result.code !== 0 && !result.interrupted) {
      output = `${output.trimEnd()}\n\nExit code: ${result.code}`;
    }

    // 中断处理
    if (result.interrupted) {
      output = `${output.trimEnd()}\n\nCommand was interrupted (killed).`;
    }

    return {
      output,
      exitCode: result.code,
      truncated,
    };
  }

  /**
   * 工厂方法：创建并初始化
   */
  static override async create(options: {
    rootDir?: string;
    timeout?: number;
    maxOutputBytes?: number;
    env?: Record<string, string>;
    inheritEnv?: boolean;
  } = {}): Promise<CustomShellBackend> {
    const backend = new CustomShellBackend(options);
    await backend.initialize();
    return backend;
  }
}