import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import { getCronTaskHelperDefinition } from './system-agent-definitions.js';
import { syncSystemAgent } from './system-agent-sync.js';

/**
 * 确保定时任务助手存在
 * 在系统启动时调用，如果不存在则自动创建，如果存在但 prompt 有更新则更新 prompt
 */
export async function ensureCronTaskHelperExists(): Promise<void> {
  console.log('[init-cron-task-helper] 检查定时任务助手是否存在...');

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-cron-task-helper] 没有默认 LLM Provider，定时任务助手将无法正常工作');
  }

  const agent = await syncSystemAgent(getCronTaskHelperDefinition(defaultProvider?.id));

  console.log(`[init-cron-task-helper] 定时任务助手已同步: ID=${agent.id}, name=${agent.name}`);
}
