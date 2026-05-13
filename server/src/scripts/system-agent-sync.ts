import type { Agent, AgentType } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { normalizeAgentSpeechConfig, type AgentSpeechConfig } from '../modules/speech/speech-config.js';

// 系统分类 ID（固定值，便于启动同步和前端分组）
export const SYSTEM_CATEGORY_ID =
  'system-category-00000000-0000-0000-0000-000000000001';

export interface SystemAgentDefinition {
  id: string;
  name: string;
  avatar?: string | null;
  avatarColor?: string | null;
  description?: string | null;
  prompt: string;
  type?: AgentType;
  acpTool?: string | null;
  workDir?: string | null;
  llmProviderId?: string | null;
  speechConfig?: AgentSpeechConfig | null;
}

export async function ensureSystemCategory() {
  return prisma.agentCategory.upsert({
    where: { id: SYSTEM_CATEGORY_ID },
    update: {
      name: '系统',
      description: '系统内置助手，不可删除',
      sortOrder: -1000,
    },
    create: {
      id: SYSTEM_CATEGORY_ID,
      name: '系统',
      description: '系统内置助手，不可删除',
      sortOrder: -1000,
    },
  });
}

async function getAvailableAgentName(baseName: string): Promise<string> {
  let candidate = baseName;
  let index = 2;

  while (await prisma.agent.findUnique({ where: { name: candidate } })) {
    candidate = `${baseName}${index}`;
    index += 1;
  }

  return candidate;
}

async function reserveSystemAgentName(
  definition: SystemAgentDefinition,
): Promise<void> {
  const conflict = await prisma.agent.findUnique({
    where: { name: definition.name },
    select: { id: true, agentLevel: true },
  });

  if (!conflict || conflict.id === definition.id) return;

  const suffix = conflict.agentLevel === 'system' ? '旧系统' : '用户';
  const renamedTo = await getAvailableAgentName(`${definition.name}（${suffix}）`);

  await prisma.agent.update({
    where: { id: conflict.id },
    data: {
      name: renamedTo,
      updatedAt: new Date(),
    },
  });

  console.warn(
    `[system-agent-sync] 系统助手名称冲突: ${definition.name}，已将冲突助手 ${conflict.id} 重命名为 ${renamedTo}`,
  );
}

/**
 * 用内置定义同步系统助手。
 *
 * 系统助手是产品内置能力，用户不能修改。这里每次启动都覆盖系统托管字段；
 * 但 llmProviderId 与本机模型配置有关，只在创建或缺失时填入默认值。
 */
export async function syncSystemAgent(
  definition: SystemAgentDefinition,
): Promise<Agent> {
  await ensureSystemCategory();
  await reserveSystemAgentName(definition);

  const existing = await prisma.agent.findUnique({
    where: { id: definition.id },
  });

  const managedData = {
    name: definition.name,
    avatar: definition.avatar ?? null,
    avatarColor: definition.avatarColor ?? null,
    description: definition.description ?? null,
    prompt: definition.prompt,
    type: definition.type ?? 'builtin',
    agentLevel: 'system' as const,
    acpTool: definition.acpTool ?? null,
    workDir: definition.workDir ?? null,
    categoryId: SYSTEM_CATEGORY_ID,
    isActive: true,
    updatedAt: new Date(),
    // 只在 definition 明确提供时才同步 speechConfig，不覆盖用户已配置的值
    ...(definition.speechConfig !== undefined && {
      speechConfig: definition.speechConfig ? JSON.stringify(normalizeAgentSpeechConfig(definition.speechConfig)) : null,
    }),
  };

  if (!existing) {
    const agent = await prisma.agent.create({
      data: {
        id: definition.id,
        ...managedData,
        llmProviderId: definition.llmProviderId ?? null,
      },
    });
    console.log(`[system-agent-sync] 已创建系统助手: ${agent.name}`);
    return agent;
  }

  const agent = await prisma.agent.update({
    where: { id: definition.id },
    data: {
      ...managedData,
      ...(!existing.llmProviderId && definition.llmProviderId
        ? { llmProviderId: definition.llmProviderId }
        : {}),
    },
  });
  console.log(`[system-agent-sync] 已同步系统助手: ${agent.name}`);
  return agent;
}

export async function syncSystemAgents(
  definitions: SystemAgentDefinition[],
): Promise<Agent[]> {
  const agents: Agent[] = [];
  for (const definition of definitions) {
    agents.push(await syncSystemAgent(definition));
  }
  return agents;
}
