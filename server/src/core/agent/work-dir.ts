import * as os from 'os';
import * as path from 'path';
import type { ChatRoomAgentInfo } from './executor.interface.js';

export function getDefaultChatRoomWorkDir(chatRoomId: string): string {
  return path.join(os.homedir(), '.teamagentx', 'workspace', chatRoomId);
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

  return explicitDir || getDefaultChatRoomWorkDir(chatRoomId);
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
