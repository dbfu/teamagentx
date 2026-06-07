import * as os from 'os';
import * as path from 'path';
import type { ChatRoomAgentInfo } from './executor.interface.js';

export function getDefaultChatRoomWorkDir(chatRoomId: string): string {
  return path.join(os.homedir(), '.teamagentx', 'workspace', chatRoomId);
}

/**
 * 展开以 ~ 开头的路径并归一化为绝对路径。
 * 必须在 resolveAgentWorkDir 里统一处理：否则 executor 会把字面量 `~/...`
 * 当作相对路径传给 Claude/Codex SDK 进程的 cwd，被解析到服务进程工作目录下，
 * 而 sanitizeClaudeProjectPath 又用字面量字符串去定位会话 jsonl，两者指向不同目录，
 * 导致每轮对话都找不到上次的会话文件、session 被重置、上下文丢失。
 */
function expandWorkDir(dir: string): string {
  const expanded = dir.startsWith('~')
    ? path.join(os.homedir(), dir.slice(1))
    : dir;
  return path.resolve(expanded);
}

export function resolveAgentWorkDir({
  chatRoomId,
  sessionDir,
  customWorkDir,
}: {
  chatRoomId: string;
  sessionDir?: string | null;
  customWorkDir?: string | null;
  agentWorkDir?: string | null;
}): string {
  const explicitDir = sessionDir?.trim()
    || customWorkDir?.trim();

  return explicitDir
    ? expandWorkDir(explicitDir)
    : getDefaultChatRoomWorkDir(chatRoomId);
}

export function resolveChatRoomAgentInfoWorkDir(
  chatRoomId: string,
  agent: ChatRoomAgentInfo,
): string {
  return resolveAgentWorkDir({
    chatRoomId,
    customWorkDir: agent.customWorkDir,
    agentWorkDir: agent.workDir,
  });
}
