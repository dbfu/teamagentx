import * as fs from 'fs';
import * as path from 'path';
import type { Agent } from '@prisma/client';
import { llmProviderService } from '../modules/llm-provider/llm-provider.service.js';
import {
  getSharedSkillsDir,
  PREINSTALLED_SKILL_NAMES,
  SKILL_MANAGER_DEFAULT_SKILLS,
} from '../modules/skill/preinstalled-skills.js';
import { skillInstallService } from '../modules/skill/skill-install.service.js';
import { createSkillDirectoryLink } from '../modules/skill/skill-link.js';
import { getSkillsHelperDefinition } from './system-agent-definitions.js';
import { syncSystemAgent } from './system-agent-sync.js';

/**
 * 复制预置技能到共享目录
 */
async function copyPreinstalledSkills(): Promise<void> {
  console.log('[init-skills-helper] 复制预置技能到共享目录...');

  const sharedSkillsDir = getSharedSkillsDir();
  const currentDir = path.dirname(new URL(import.meta.url).pathname);
  const serverDir = path.resolve(currentDir, '..', '..');
  const preinstalledSkillsDir = path.join(serverDir, 'preinstalled-skills');

  console.log(`[init-skills-helper] 预置技能目录: ${preinstalledSkillsDir}`);

  fs.mkdirSync(sharedSkillsDir, { recursive: true });

  for (const skillName of PREINSTALLED_SKILL_NAMES) {
    const sourceDir = path.join(preinstalledSkillsDir, skillName);
    const targetDir = path.join(sharedSkillsDir, skillName);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[init-skills-helper] 预置技能目录不存在: ${sourceDir}`);
      continue;
    }

    if (fs.existsSync(targetDir)) {
      console.log(`[init-skills-helper] 技能「${skillName}」已存在，跳过复制`);
      continue;
    }

    fs.cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`[init-skills-helper] 已复制预置技能: ${skillName}`);
  }
}

/**
 * 为技能管理助手默认安装预置技能（symlink 方式）
 */
async function installDefaultSkillsToManager(
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'workDir'>,
): Promise<void> {
  console.log('[init-skills-helper] 为技能管理助手安装默认技能...');

  const sharedSkillsDir = getSharedSkillsDir();
  const managerSkillsDir = skillInstallService.getAgentSkillsDir(agent);

  fs.mkdirSync(managerSkillsDir, { recursive: true });

  for (const skillName of SKILL_MANAGER_DEFAULT_SKILLS) {
    const sourceDir = path.join(sharedSkillsDir, skillName);
    const targetSymlink = path.join(managerSkillsDir, skillName);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[init-skills-helper] 技能源目录不存在: ${sourceDir}`);
      continue;
    }

    if (fs.existsSync(targetSymlink)) {
      console.log(`[init-skills-helper] 技能「${skillName}」已安装，跳过`);
      continue;
    }

    try {
      const result = createSkillDirectoryLink(sourceDir, targetSymlink);
      console.log(`[init-skills-helper] 已安装技能: ${skillName} (${result.method})`);
    } catch (error) {
      console.error(`[init-skills-helper] 安装技能失败: ${skillName}`, error);
    }
  }
}

/**
 * 确保技能管理助手存在并保持最新
 * 在系统启动时调用，如果不存在则自动创建，如果 prompt 过时则更新
 */
export async function ensureSkillsHelperExists(): Promise<void> {
  console.log('[init-skills-helper] 检查技能管理助手是否存在...');

  await copyPreinstalledSkills();

  const defaultProvider = await llmProviderService.findDefault();
  if (!defaultProvider) {
    console.warn('[init-skills-helper] 没有默认 LLM Provider，技能管理助手将无法正常工作');
  }

  const agent = await syncSystemAgent(getSkillsHelperDefinition(defaultProvider?.id));
  console.log(`[init-skills-helper] 技能管理助手已同步: ID=${agent.id}, name=${agent.name}`);

  await installDefaultSkillsToManager(agent);
}
