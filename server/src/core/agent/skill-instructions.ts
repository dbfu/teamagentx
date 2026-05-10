import * as fs from 'fs';
import * as path from 'path';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';

function extractSkillMetadata(skillMdPath: string): { name?: string; description?: string } {
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) return {};

    const metadata: { name?: string; description?: string } = {};
    const lines = frontmatter[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      const rawValue = match[2].trim();
      if (key !== 'name' && key !== 'description') continue;

      if (rawValue === '|' || rawValue === '>' || rawValue === '|-' || rawValue === '>-') {
        const parts: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].match(/^\s/) && lines[j].trim() !== '') {
            parts.push(lines[j].trim());
          } else {
            break;
          }
        }
        metadata[key] = parts.join(' ').trim();
      } else {
        metadata[key] = rawValue.replace(/^['"]|['"]$/g, '');
      }
    }
    return metadata;
  } catch {
    return {};
  }
}

function resolveSkillsDir(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string | null {
  if (!agentId) {
    return null;
  }

  return skillsDirOverride || skillInstallService.getGlobalAgentSkillsDir(agentId);
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
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

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

export function buildInstalledSkillsInstructions(
  agentId: string | null | undefined,
  skillsDirOverride?: string,
): string {
  if (!agentId) {
    return `## 已安装技能
当前助手未绑定技能目录。用户询问有哪些技能时，只能回答未安装技能，不要列出系统内置技能、全局技能或其他助手的技能。`;
  }

  const skillsDir = resolveSkillsDir(agentId, skillsDirOverride);
  if (!skillsDir) {
    return `## 已安装技能
当前助手未绑定技能目录。用户询问有哪些技能时，只能回答未安装技能，不要列出系统内置技能、全局技能或其他助手的技能。`;
  }

  if (!fs.existsSync(skillsDir)) {
    return `## 已安装技能
当前助手未安装技能。用户询问有哪些技能时，只能回答未安装技能，不要列出系统内置技能、全局技能或其他助手的技能。`;
  }

  const skillEntries = readSkillEntries(skillsDir);
  if (skillEntries === null) {
    return `## 已安装技能
当前助手的技能目录不可读取。用户询问有哪些技能时，只能回答当前无法读取已安装技能，不要列出系统内置技能、全局技能或其他助手的技能。`;
  }

  const skills: Array<{ slug: string; name: string; description?: string }> = [];
  for (const entry of skillEntries) {
    const metadata = extractSkillMetadata(entry.skillMdPath);
    skills.push({
      slug: entry.slug,
      name: metadata.name || entry.slug,
      description: metadata.description,
    });
  }

  if (skills.length === 0) {
    return `## 已安装技能
当前助手未安装技能。用户询问有哪些技能时，只能回答未安装技能，不要列出系统内置技能、全局技能或其他助手的技能。`;
  }

  const availableSkills = skills
    .map((skill) => {
      const description = skill.description ? `: ${skill.description}` : '';
      return `- ${skill.name}${description} (file: teamagentx/${skill.slug}/SKILL.md)`;
    })
    .join('\n');

  return `## 已安装技能
以下是 TeamAgentX 为当前助手安装的全部技能。用户询问有哪些技能时，只能列出这里的技能；不要列出系统内置技能、全局技能、其他目录中的技能或其他助手的技能。

### Skill roots
- \`teamagentx\` = \`${skillsDir}\`

### Available skills
${availableSkills}

### How to use skills
- 当用户明确点名某个已安装技能，或任务明显匹配该技能描述时，先读取对应的 \`SKILL.md\`，再按其中说明执行。
- 不要主动使用未列在上方的技能。`;
}
