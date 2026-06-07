import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { getAgentCreatorDefinition } from './system-agent-definitions.js';
import { syncSystemAgent } from './system-agent-sync.js';

/**
 * 确保助手生成器 Agent 存在
 * 在系统启动时调用，如果不存在则自动创建
 */
export async function ensureAgentCreatorExists(): Promise<void> {
  console.log('[init-agent-creator] 检查助手生成器是否存在...');

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-agent-creator] 没有默认 LLM Provider，助手生成器将无法正常工作');
  }

  const agent = await syncSystemAgent(getAgentCreatorDefinition(defaultProvider?.id));
  console.log(`[init-agent-creator] 助手生成器已同步: ID=${agent.id}, name=${agent.name}`);
}
