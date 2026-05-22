/**
 * 系统助手种子数据。
 *
 * 开发环境手动执行 seed 时，也复用生产启动时的系统助手同步逻辑，
 * 避免 seed 与 DMG 升级初始化出现两套定义。
 */
import prisma from '../src/lib/prisma.js';
import { llmProviderService } from '../src/modules/llm-provider/llm-provider.service.js';
import { getGroupAssistantDefinition } from '../src/scripts/system-agent-definitions.js';
import { cleanupLegacySystemAgents, syncSystemAgents } from '../src/scripts/system-agent-sync.js';

async function seed() {
  console.log('开始系统助手种子数据同步...');

  try {
    const defaultProvider = await llmProviderService.findDefault();
    await syncSystemAgents([
      getGroupAssistantDefinition(defaultProvider?.id),
    ]);
    await cleanupLegacySystemAgents();
    console.log('\n系统助手种子数据同步完成！');
  } catch (error) {
    console.error('系统助手种子数据同步失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seed();
