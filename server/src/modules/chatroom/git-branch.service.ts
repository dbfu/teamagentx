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

async function getCurrentBranch(workDir: string): Promise<string | null> {
  const branch = await runGit(workDir, ['branch', '--show-current']);
  if (branch) return branch;

  const shortHash = await runGit(workDir, ['rev-parse', '--short', 'HEAD']).catch(() => '');
  return shortHash ? `detached:${shortHash}` : null;
}

export const gitBranchService = {
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
};
