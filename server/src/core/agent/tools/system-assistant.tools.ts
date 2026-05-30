import { GROUP_ASSISTANT_ID } from '../system-assistant.constants.js';
import { createAgentCreatorTools } from './agent-creator.tools.js';
import { createChatRoomHelperTools } from './chatroom-helper.tools.js';
import { createChatHistorySearchTools } from './chat-history-search.tools.js';
import { cronTaskHelperTools } from './cron-task-helper.tools.js';
import { createExternalPlatformHelperTools } from './external-platform-helper.tools.js';
import { skillManagerTools } from './skill-manager.tools.js';
import { createExecutionContextTools } from './execution-context.tools.js';

type SystemTool = {
  name?: string;
  description?: string;
  schema?: unknown;
  invoke: (args: any) => Promise<unknown> | unknown;
};

function dedupeTools(tools: SystemTool[]): SystemTool[] {
  const seen = new Set<string>();
  const result: SystemTool[] = [];

  for (const tool of tools) {
    if (!tool.name || seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push(tool);
  }

  return result;
}

export function getSystemAssistantTools(
  agentId: string | undefined | null,
  chatRoomId: string,
  options?: { includeRoomContextTools?: boolean },
): SystemTool[] {
  const roomContextTools = options?.includeRoomContextTools === false
    ? []
    : createChatHistorySearchTools(chatRoomId);

  if (agentId !== GROUP_ASSISTANT_ID) return dedupeTools(roomContextTools);

  return dedupeTools([
    ...roomContextTools,
    ...createAgentCreatorTools(chatRoomId),
    ...skillManagerTools,
    ...cronTaskHelperTools,
    ...createChatRoomHelperTools(chatRoomId),
    ...createExternalPlatformHelperTools(chatRoomId),
    ...createExecutionContextTools(chatRoomId),
  ]);
}
