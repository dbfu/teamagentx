import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { createAgentCreatorTools } from './agent-creator.tools.js';
import { createChatRoomHelperTools } from './chatroom-helper.tools.js';
import { createChatHistorySearchTools } from './chat-history-search.tools.js';
import { cronTaskHelperTools } from './cron-task-helper.tools.js';
import { createExternalPlatformHelperTools } from './external-platform-helper.tools.js';
import { skillManagerTools } from './skill-manager.tools.js';
import { createExecutionContextTools } from './execution-context.tools.js';
import { connectorManagerTools } from './connector-manager.tools.js';
import { createMentionTools } from './mention.tools.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';

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

/**
 * 助手 @ 派发工具：把目标助手名解析为本群活跃成员（排除内置协调器）。
 * 解析器懒加载一次群成员清单并在本次工具实例内缓存。
 */
function createMentionToolsForAgent(
  chatRoomId: string,
  agentId: string | undefined | null,
): SystemTool[] {
  if (!agentId || agentId === GROUP_COORDINATOR_ID) return [];
  let cache: Map<string, { id: string; name: string }> | null = null;
  const resolveAgent = async (name: string) => {
    if (!cache) {
      const roomAgents = await chatRoomService.getAgents(chatRoomId);
      cache = new Map();
      for (const cra of roomAgents) {
        const a = cra.agent as { id: string; name: string; isActive?: boolean } | null;
        if (a && a.isActive && a.id !== GROUP_COORDINATOR_ID) {
          cache.set(a.name, { id: a.id, name: a.name });
        }
      }
    }
    return cache.get(name.trim()) ?? null;
  };
  return createMentionTools({ chatRoomId, selfAgentId: agentId, resolveAgent }).tools;
}

export function getSystemAssistantTools(
  agentId: string | undefined | null,
  chatRoomId: string,
  options?: { includeRoomContextTools?: boolean },
): SystemTool[] {
  const roomContextTools = options?.includeRoomContextTools === false
    ? []
    : createChatHistorySearchTools(chatRoomId);

  // mention_agents 是助手互相接力的统一入口，所有业务助手都应具备（与群历史开关无关）。
  const mentionTools = createMentionToolsForAgent(chatRoomId, agentId);
  const baseTools = [...roomContextTools, ...mentionTools];

  if (agentId !== GROUP_ASSISTANT_ID) return dedupeTools(baseTools);

  return dedupeTools([
    ...baseTools,
    ...createAgentCreatorTools(chatRoomId),
    ...skillManagerTools,
    ...cronTaskHelperTools,
    ...createChatRoomHelperTools(chatRoomId),
    ...createExternalPlatformHelperTools(chatRoomId),
    ...connectorManagerTools,
    ...createExecutionContextTools(chatRoomId),
  ]);
}
