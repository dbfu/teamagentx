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
    const metadata = extractSkillMetadata(entry.skillMdPath);
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
