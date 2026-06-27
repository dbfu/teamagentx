import * as fs from 'fs';
import * as path from 'path';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import { readSkillMetadata } from '../../modules/skill/skill-metadata.js';

function resolveSkillsDir(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string | null {
  if (!agentId) {
    return null;
  }

  return skillsDirOverride || skillInstallService.getGlobalAgentSkillsDir(agentId);
}

/**
 * 判断目录项是否为「可进入的目录」。
 *
 * Windows 上 junction（mklink /J，无需管理员，最常用）在 readdir 的 Dirent 里
 * isDirectory() 与 isSymbolicLink() 都为 false（类型 UV_DIRENT_UNKNOWN），会被漏判跳过；
 * 因此种别不明确时统一用 statSync（跟随链接/junction）兜底，跨平台识别真实目录、
 * 目录软链与 junction。指向文件的软链会被判为非目录而正确跳过。
 */
function isDirectoryEntry(parentDir: string, entry: fs.Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) return true;
  try {
    return fs.statSync(path.join(parentDir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function readSkillEntries(skillsDir: string): Array<{ slug: string; skillMdPath: string }> | null {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const skills: Array<{ slug: string; skillMdPath: string }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!isDirectoryEntry(skillsDir, entry)) continue;

    const skillPath = path.join(skillsDir, entry.name);
    const skillMdPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    skills.push({ slug: entry.name, skillMdPath });
  }

  return skills.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function buildInstalledSkillsSignature(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string {
  const skillsDir = resolveSkillsDir(agentId, skillsDirOverride);
  if (!skillsDir) return 'unbound';

  const entries = readSkillEntries(skillsDir);
  if (entries === null) return 'unreadable';

  return entries.map((entry) => entry.slug).join('|');
}

export function buildInstalledSkillNames(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string[] {
  const skillsDir = resolveSkillsDir(agentId, skillsDirOverride);
  if (!skillsDir) return [];

  const entries = readSkillEntries(skillsDir);
  if (entries === null) return [];

  return entries.map((entry) => entry.slug);
}

export function buildInstalledSkillsInstructions(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string {
  if (!agentId) {
    return `## Installed Skills
The current assistant is not bound to a skills directory. If the user asks what skills are available, only say that no skills are installed. Do not list built-in system skills, global skills, or skills from other assistants.`;
  }

  const skillsDir = resolveSkillsDir(agentId, skillsDirOverride);
  if (!skillsDir) {
    return `## Installed Skills
The current assistant is not bound to a skills directory. If the user asks what skills are available, only say that no skills are installed. Do not list built-in system skills, global skills, or skills from other assistants.`;
  }

  if (!fs.existsSync(skillsDir)) {
    return `## Installed Skills
The current assistant has no installed skills. If the user asks what skills are available, only say that no skills are installed. Do not list built-in system skills, global skills, or skills from other assistants.`;
  }

  const skillEntries = readSkillEntries(skillsDir);
  if (skillEntries === null) {
    return `## Installed Skills
The current assistant's skills directory cannot be read. If the user asks what skills are available, only say that installed skills cannot be read right now. Do not list built-in system skills, global skills, or skills from other assistants.`;
  }

  const skills: Array<{ slug: string; name: string; description?: string }> = [];
  for (const entry of skillEntries) {
    const metadata = readSkillMetadata(entry.skillMdPath);
    skills.push({
      slug: entry.slug,
      name: metadata.name || entry.slug,
      description: metadata.description,
    });
  }

  if (skills.length === 0) {
    return `## Installed Skills
The current assistant has no installed skills. If the user asks what skills are available, only say that no skills are installed. Do not list built-in system skills, global skills, or skills from other assistants.`;
  }

  const availableSkills = skills
    .map((skill) => {
      const description = skill.description ? `: ${skill.description}` : '';
      return `- ${skill.name}${description} (file: teamagentx/${skill.slug}/SKILL.md)`;
    })
    .join('\n');

  return `## Installed Skills
The following are all skills TeamAgentX has installed for the current assistant. If the user asks what skills are available, only list these skills. Do not list built-in system skills, global skills, skills from other directories, or skills from other assistants.

### Skill roots
- \`teamagentx\` = \`${skillsDir}\`

### Available skills
${availableSkills}

### How to use skills
- When the user explicitly names an installed skill, or the task clearly matches a skill description, read the corresponding \`SKILL.md\` first and then follow its instructions.
- Do not proactively use skills that are not listed above.`;
}
