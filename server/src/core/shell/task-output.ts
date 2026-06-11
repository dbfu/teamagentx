import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 全局输出目录，放在用户 home 目录下，避免污染项目目录
const GLOBAL_OUTPUT_DIR = path.join(os.homedir(), '.teamagentx', 'output');

/**
 * TaskOutput - 管理命令输出文件
 *
 * 设计参考 Claude Code 的 TaskOutput 类：
 * - stdout/stderr 直接写入文件 fd（不经过 JS 层）
 * - 支持尾部读取（polling）获取进度
 * - 跟踪文件大小用于阻塞检测
 * - 输出文件放在全局目录，不污染项目工作目录
 */
export class TaskOutput {
  readonly taskId: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly outputDir: string;

  private stdoutFd: number | null = null;
  private stderrFd: number | null = null;
  private stdoutSize: number = 0;
  private stderrSize: number = 0;
  private cleanedUp = false;

  constructor(taskId: string, _workDir: string) {
    this.taskId = taskId;

    // 使用全局输出目录，不再在工作目录下创建
    this.outputDir = GLOBAL_OUTPUT_DIR;
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // 初始化输出文件路径
    this.stdoutPath = path.join(this.outputDir, `${taskId}.stdout`);
    this.stderrPath = path.join(this.outputDir, `${taskId}.stderr`);

    // 创建空文件
    fs.writeFileSync(this.stdoutPath, '');
    fs.writeFileSync(this.stderrPath, '');

    // 打开文件描述符用于追加写入
    this.stdoutFd = fs.openSync(this.stdoutPath, 'a');
    this.stderrFd = fs.openSync(this.stderrPath, 'a');
  }

  /**
   * 获取 stdout 文件描述符（供 spawn stdio 使用）
   */
  getStdoutFd(): number {
    if (this.stdoutFd === null) {
      throw new Error('TaskOutput has been cleaned up');
    }
    return this.stdoutFd;
  }

  /**
   * 获取 stderr 文件描述符（供 spawn stdio 使用）
   */
  getStderrFd(): number {
    if (this.stderrFd === null) {
      throw new Error('TaskOutput has been cleaned up');
    }
    return this.stderrFd;
  }

  /**
   * 读取文件尾部内容（用于进度轮询）
   */
  async readTail(filePath: string, bytes: number): Promise<{ content: string; bytesRead: number; bytesTotal: number }> {
    return new Promise((resolve, reject) => {
      fs.stat(filePath, (err, stats) => {
        if (err) {
          resolve({ content: '', bytesRead: 0, bytesTotal: 0 });
          return;
        }

        const bytesTotal = stats.size;
        const start = Math.max(0, bytesTotal - bytes);
        const bytesRead = bytesTotal - start;

        if (bytesRead === 0) {
          resolve({ content: '', bytesRead: 0, bytesTotal });
          return;
        }

        fs.open(filePath, 'r', (err, fd) => {
          if (err) {
            resolve({ content: '', bytesRead: 0, bytesTotal });
            return;
          }

          const buffer = Buffer.alloc(bytesRead);
          fs.read(fd, buffer, 0, bytesRead, start, (err) => {
            fs.closeSync(fd);
            if (err) {
              resolve({ content: '', bytesRead: 0, bytesTotal });
              return;
            }
            resolve({ content: buffer.toString('utf-8'), bytesRead, bytesTotal });
          });
        });
      });
    });
  }

  /**
   * 读取 stdout 尾部
   */
  async readStdoutTail(bytes: number): Promise<{ content: string; bytesRead: number; bytesTotal: number }> {
    return this.readTail(this.stdoutPath, bytes);
  }

  /**
   * 读取 stderr 尾部
   */
  async readStderrTail(bytes: number): Promise<{ content: string; bytesRead: number; bytesTotal: number }> {
    return this.readTail(this.stderrPath, bytes);
  }

  /**
   * 获取文件大小（用于阻塞检测）
   */
  async getSize(): Promise<{ stdout: number; stderr: number }> {
    return new Promise((resolve) => {
      fs.stat(this.stdoutPath, (err, stdoutStats) => {
        const stdoutSize = err ? 0 : stdoutStats.size;
        fs.stat(this.stderrPath, (err, stderrStats) => {
          const stderrSize = err ? 0 : stderrStats.size;
          resolve({ stdout: stdoutSize, stderr: stderrSize });
        });
      });
    });
  }

  /**
   * 获取最后修改时间（用于阻塞检测）
   */
  async getLastModifiedTime(): Promise<Date> {
    return new Promise((resolve) => {
      fs.stat(this.stdoutPath, (err, stats) => {
        if (err) {
          resolve(new Date());
          return;
        }
        resolve(stats.mtime);
      });
    });
  }

  /**
   * 读取完整输出
   */
  async getOutput(): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      fs.readFile(this.stdoutPath, 'utf-8', (err, stdout) => {
        const stdoutContent = err ? '' : stdout;
        fs.readFile(this.stderrPath, 'utf-8', (err, stderr) => {
          const stderrContent = err ? '' : stderr;
          resolve({ stdout: stdoutContent, stderr: stderrContent });
        });
      });
    });
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.stdoutFd !== null) {
      try {
        fs.closeSync(this.stdoutFd);
      } catch (e) {
        // 忽略关闭错误
      }
      this.stdoutFd = null;
    }

    if (this.stderrFd !== null) {
      try {
        fs.closeSync(this.stderrFd);
      } catch (e) {
        // 忽略关闭错误
      }
      this.stderrFd = null;
    }
  }

  /**
   * 删除输出文件
   */
  async deleteFiles(): Promise<void> {
    this.cleanup();

    return new Promise((resolve) => {
      fs.unlink(this.stdoutPath, (err) => {
        // 忽略删除错误
        fs.unlink(this.stderrPath, (err) => {
          // 忽略删除错误
          resolve();
        });
      });
    });
  }
}
