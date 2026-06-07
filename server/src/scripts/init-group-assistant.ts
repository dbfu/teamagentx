import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Agent } from '@prisma/client';
import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import {
  getSharedSkillsDir,
  PREINSTALLED_SKILL_NAMES,
  SKILL_MANAGER_DEFAULT_SKILLS,
} from '../modules/skill/preinstalled-skills.js';
import { skillInstallService } from '../modules/skill/skill-install.service.js';
import { createSkillDirectoryLink } from '../modules/skill/skill-link.js';
import { getGroupAssistantDefinition, getGroupCoordinatorDefinition } from './system-agent-definitions.js';
import { cleanupLegacySystemAgents, syncSystemAgent, syncSystemAgents } from './system-agent-sync.js';

async function copyPreinstalledSkills(): Promise<void> {
  console.log('[init-group-assistant] 复制预置技能到共享目录...');

  const sharedSkillsDir = getSharedSkillsDir();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const serverDir = path.resolve(currentDir, '..', '..');
  const preinstalledSkillsDir = path.join(serverDir, 'preinstalled-skills');

  fs.mkdirSync(sharedSkillsDir, { recursive: true });

  for (const skillName of PREINSTALLED_SKILL_NAMES) {
    const sourceDir = path.join(preinstalledSkillsDir, skillName);
    const targetDir = path.join(sharedSkillsDir, skillName);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[init-group-assistant] 预置技能目录不存在: ${sourceDir}`);
      continue;
    }

    // 预置技能以内置打包内容为准，每次启动直接覆盖共享目录，保证升级后内容同步。
    // 先删目标再拷，避免源中已删除的文件残留。助手目录里的 symlink 指向本路径，覆盖后会自动解析到新内容。
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`[init-group-assistant] 已覆盖预置技能: ${skillName}`);
  }
}

async function installDefaultSkillsToGroupAssistant(
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'workDir'>,
): Promise<void> {
  console.log('[init-group-assistant] 为群助手安装默认技能...');

  const sharedSkillsDir = getSharedSkillsDir();
  const skillsDir = skillInstallService.getAgentSkillsDir(agent);

  fs.mkdirSync(skillsDir, { recursive: true });

  for (const skillName of SKILL_MANAGER_DEFAULT_SKILLS) {
    const sourceDir = path.join(sharedSkillsDir, skillName);
    const targetSymlink = path.join(skillsDir, skillName);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[init-group-assistant] 技能源目录不存在: ${sourceDir}`);
      continue;
    }

    if (fs.existsSync(targetSymlink)) continue;

    try {
      const result = createSkillDirectoryLink(sourceDir, targetSymlink);
      console.log(`[init-group-assistant] 已安装技能: ${skillName} (${result.method})`);
    } catch (error) {
      console.error(`[init-group-assistant] 安装技能失败: ${skillName}`, error);
    }
  }
}

export async function ensureGroupAssistantExists(): Promise<void> {
  console.log('[init-group-assistant] 检查群助手是否存在...');

  await copyPreinstalledSkills();

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-group-assistant] 没有默认 LLM Provider，群助手将沿用本地 Agent 配置');
  }

  const agent = await syncSystemAgent(getGroupAssistantDefinition(defaultProvider?.id));
  await syncSystemAgents([
    getGroupCoordinatorDefinition(defaultProvider?.id),
  ]);
  await installDefaultSkillsToGroupAssistant(agent);
  await cleanupLegacySystemAgents();

  console.log(`[init-group-assistant] 群助手已同步: ID=${agent.id}, name=${agent.name}`);
}
