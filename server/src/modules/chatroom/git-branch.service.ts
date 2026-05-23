import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getDefaultChatRoomWorkDir } from '../../core/agent/work-dir.js';

const execFileAsync = promisify(execFile);

export interface GitBranchInfo {
  name: string;
  current: boolean;
}

export interface GitBranchStatus {
  isGitRepo: boolean;
  workDir: string;
  currentBranch: string | null;
  branches: GitBranchInfo[];
}

export type GitCommandAction = 'init' | 'status' | 'diff' | 'add_all' | 'commit' | 'log' | 'branch';

export interface GitCommandResult {
  action: GitCommandAction;
  command: string;
  workDir: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

function expandHome(folderPath: string): string {
  return folderPath.startsWith('~')
    ? path.join(os.homedir(), folderPath.slice(1))
    : folderPath;
}

function resolveChatRoomWorkDir(chatRoomId: string, workDir?: string | null): string {
  const rawPath = workDir?.trim() || getDefaultChatRoomWorkDir(chatRoomId);
  return path.resolve(expandHome(rawPath));
}

async function runGit(workDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: workDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function runGitCommand(workDir: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      stdout: typeof error?.stdout === 'string' ? error.stdout.trim() : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr.trim() : (error?.message ?? 'Git 命令执行失败'),
      exitCode: typeof error?.code === 'number' ? error.code : 1,
    };
  }
}

async function getCurrentBranch(workDir: string): Promise<string | null> {
  const branch = await runGit(workDir, ['branch', '--show-current']);
  if (branch) return branch;

  const shortHash = await runGit(workDir, ['rev-parse', '--short', 'HEAD']).catch(() => '');
  return shortHash ? `detached:${shortHash}` : null;
}

export const gitBranchService = {
  resolveWorkDir(chatRoomId: string, workDir?: string | null): string {
    return resolveChatRoomWorkDir(chatRoomId, workDir);
  },

  async getStatus(chatRoomId: string, workDir?: string | null): Promise<GitBranchStatus> {
    const resolvedWorkDir = resolveChatRoomWorkDir(chatRoomId, workDir);
    const emptyStatus: GitBranchStatus = {
      isGitRepo: false,
      workDir: resolvedWorkDir,
      currentBranch: null,
      branches: [],
    };

    if (!fs.existsSync(resolvedWorkDir) || !fs.statSync(resolvedWorkDir).isDirectory()) {
      return emptyStatus;
    }

    const isInsideWorkTree = await runGit(resolvedWorkDir, ['rev-parse', '--is-inside-work-tree'])
      .catch(() => '');
    if (isInsideWorkTree !== 'true') {
      return emptyStatus;
    }

    const currentBranch = await getCurrentBranch(resolvedWorkDir);
    const branchOutput = await runGit(resolvedWorkDir, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
    ]);
    const branches = branchOutput
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({
        name,
        current: name === currentBranch,
      }));

    return {
      isGitRepo: true,
      workDir: resolvedWorkDir,
      currentBranch,
      branches,
    };
  },

  async switchBranch(chatRoomId: string, workDir: string | null | undefined, branch: string): Promise<GitBranchStatus> {
    const targetBranch = branch.trim();
    if (!targetBranch) {
      throw new Error('分支名称不能为空');
    }

    const status = await this.getStatus(chatRoomId, workDir);
    if (!status.isGitRepo) {
      throw new Error('当前工作目录不是 git 仓库');
    }

    if (!status.branches.some((item) => item.name === targetBranch)) {
      throw new Error('分支不存在');
    }

    try {
      await runGit(status.workDir, ['switch', '--', targetBranch]);
    } catch (error: any) {
      const message = typeof error?.stderr === 'string' && error.stderr.trim()
        ? error.stderr.trim()
        : '切换分支失败';
      throw new Error(message);
    }

    return this.getStatus(chatRoomId, workDir);
  },

  async executeCommand(
    chatRoomId: string,
    workDir: string | null | undefined,
    action: GitCommandAction,
    message?: string,
  ): Promise<GitCommandResult> {
    const resolvedWorkDir = resolveChatRoomWorkDir(chatRoomId, workDir);
    if (!fs.existsSync(resolvedWorkDir) || !fs.statSync(resolvedWorkDir).isDirectory()) {
      throw new Error('工作目录不存在');
    }

    const actionMap: Record<GitCommandAction, { args: string[]; command: string; requiresRepo: boolean }> = {
      init: { args: ['init'], command: 'git init', requiresRepo: false },
      status: { args: ['status'], command: 'git status', requiresRepo: true },
      diff: { args: ['diff'], command: 'git diff', requiresRepo: true },
      add_all: { args: ['add', '.'], command: 'git add .', requiresRepo: true },
      commit: { args: ['commit', '-m', message?.trim() ?? ''], command: `git commit -m ${JSON.stringify(message?.trim() ?? '')}`, requiresRepo: true },
      log: { args: ['log', '--oneline', '-n', '20'], command: 'git log --oneline -n 20', requiresRepo: true },
      branch: { args: ['branch'], command: 'git branch', requiresRepo: true },
    };
    const config = actionMap[action];

    if (action === 'commit' && !message?.trim()) {
      throw new Error('请输入提交信息');
    }

    if (config.requiresRepo) {
      const isInsideWorkTree = await runGit(resolvedWorkDir, ['rev-parse', '--is-inside-work-tree']).catch(() => '');
      if (isInsideWorkTree !== 'true') {
        throw new Error('当前工作目录不是 git 仓库，请先执行 /git init');
      }
    }

    const result = await runGitCommand(resolvedWorkDir, config.args);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return {
      action,
      command: config.command,
      workDir: resolvedWorkDir,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output: output || (result.exitCode === 0 ? '命令执行成功，无输出。' : '命令执行失败，无输出。'),
    };
  },
};
