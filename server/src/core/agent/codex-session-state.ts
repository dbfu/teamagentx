import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAgentWorkDir } from './work-dir.js';

// 与 CodexSdkExecutor 内的会话状态版本保持一致，改动需同步
export const CODEX_THREAD_STATE_VERSION = 2;

/** Codex executor 的专属 CODEX_HOME（与实例方法 getCodexHome 保持一致）。 */
export function getCodexExecutorHome(agentId: string): string {
  return path.join(os.homedir(), '.teamagentx', 'acp-config', agentId || 'default', 'codex');
}

/** Codex executor resume 时查找 rollout 的 sessions 根目录。 */
export function getCodexExecutorSessionsDir(agentId: string): string {
  return path.join(getCodexExecutorHome(agentId), 'sessions');
}

/**
 * 计算某个 chatRoom-agent-workDir 对应的 Codex 会话状态文件路径。
 * scope 必须与 CodexSdkExecutor.getSessionStatePath 完全一致，否则切换的 threadId 不会被 executor 读取。
 */
export function getCodexSessionStatePath(params: {
  agentId: string;
  chatRoomId: string;
  workDir: string;
}): string {
  const resolvedWorkDir = resolveAgentWorkDir({
    chatRoomId: params.chatRoomId,
    sessionDir: params.workDir,
  });
  const scope = createHash('sha256')
    .update(`${params.chatRoomId}:${resolvedWorkDir}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(getCodexExecutorHome(params.agentId), `teamagentx-codex-sdk-session-${scope}.json`);
}

/** 将选中的本地 Codex 会话绑定为该快速对话下次执行要 resume 的 thread。 */
export function bindCodexLocalThread(params: {
  agentId: string;
  chatRoomId: string;
  workDir: string;
  threadId: string | null;
}): void {
  const statePath = getCodexSessionStatePath(params);
  if (!params.threadId) {
    fs.rmSync(statePath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        version: CODEX_THREAD_STATE_VERSION,
        threadId: params.threadId,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
