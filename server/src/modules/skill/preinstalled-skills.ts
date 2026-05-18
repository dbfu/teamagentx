import type { Agent } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { skillInstallService } from './skill-install.service.js';

export const PREINSTALLED_SKILL_NAMES = [
  'find-skills',
  'skill-creator',
  'browser-use',
  'image-generation-sdk',
] as const;

export const SKILL_MANAGER_DEFAULT_SKILLS = [
  'find-skills',
  'skill-creator',
] as const;

export const NEW_AGENT_DEFAULT_SKILLS = [
  'browser-use',
] as const;

export function getSharedSkillsDir(): string {
  return path.join(os.homedir(), '.teamagentx', 'skills');
}

export async function installDefaultSkillsForNewAgent(
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'workDir'>,
): Promise<string[]> {
  const sharedSkillsDir = getSharedSkillsDir();
  const targetSkillsDir = skillInstallService.getAgentSkillsDir(agent);
  const installedSkills: string[] = [];

  try {
    fs.mkdirSync(targetSkillsDir, { recursive: true });
  } catch (error) {
    console.warn(
      `[preinstalled-skills] 无法创建助手技能目录，跳过默认技能安装: ${targetSkillsDir}`,
      error,
    );
    return installedSkills;
  }

  for (const skillName of NEW_AGENT_DEFAULT_SKILLS) {
    const sourceDir = path.join(sharedSkillsDir, skillName);
    const targetSymlink = path.join(targetSkillsDir, skillName);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[preinstalled-skills] 默认技能不存在，跳过安装: ${sourceDir}`);
      continue;
    }

    if (fs.existsSync(targetSymlink)) {
      console.log(`[preinstalled-skills] 助手「${agent.name}」已安装技能「${skillName}」，跳过`);
      installedSkills.push(skillName);
      continue;
    }

    try {
      fs.symlinkSync(sourceDir, targetSymlink, 'dir');
      installedSkills.push(skillName);
      console.log(`[preinstalled-skills] 已为助手「${agent.name}」安装默认技能: ${skillName}`);
    } catch (error) {
      console.warn(
        `[preinstalled-skills] 为助手「${agent.name}」安装默认技能失败: ${skillName}`,
        error,
      );
    }
  }

  return installedSkills;
}
