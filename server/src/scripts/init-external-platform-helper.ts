import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { getExternalPlatformHelperDefinition } from './system-agent-definitions.js';
import { syncSystemAgent } from './system-agent-sync.js';

export async function ensureExternalPlatformHelperExists(): Promise<void> {
  console.log('[init-external-platform-helper] 检查外部平台接入助手是否存在...');

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-external-platform-helper] 没有默认 LLM Provider，外部平台接入助手将无法正常工作');
  }

  const agent = await syncSystemAgent(getExternalPlatformHelperDefinition(defaultProvider?.id));
  console.log(`[init-external-platform-helper] 外部平台接入助手已同步: ID=${agent.id}, name=${agent.name}`);
}
