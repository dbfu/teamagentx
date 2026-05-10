import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { getChatroomHelperDefinition } from './system-agent-definitions.js';
import { syncSystemAgent } from './system-agent-sync.js';

/**
 * 确保群聊管理助手存在
 * 在系统启动时调用，如果不存在则自动创建
 */
export async function ensureChatroomHelperExists(): Promise<void> {
  console.log('[init-chatroom-helper] 检查群聊管理助手是否存在...');

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-chatroom-helper] 没有默认 LLM Provider，群聊管理助手将无法正常工作');
  }

  const agent = await syncSystemAgent(getChatroomHelperDefinition(defaultProvider?.id));

  console.log(`[init-chatroom-helper] 群聊管理助手已同步: ID=${agent.id}, name=${agent.name}`);
}
