import { GROUP_ASSISTANT_ID } from '../system-assistant.constants.js';
import { agentCreatorTools } from './agent-creator.tools.js';
import { chatroomHelperTools } from './chatroom-helper.tools.js';
import { createChatHistorySearchTools } from './chat-history-search.tools.js';
import { cronTaskHelperTools } from './cron-task-helper.tools.js';
import { createExternalPlatformHelperTools } from './external-platform-helper.tools.js';
import { skillManagerTools } from './skill-manager.tools.js';

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
): SystemTool[] {
  const roomContextTools = createChatHistorySearchTools(chatRoomId);

  if (agentId !== GROUP_ASSISTANT_ID) return dedupeTools(roomContextTools);

  return dedupeTools([
    ...roomContextTools,
    ...agentCreatorTools,
    ...skillManagerTools,
    ...cronTaskHelperTools,
    ...chatroomHelperTools,
    ...createExternalPlatformHelperTools(chatRoomId),
  ]);
}
