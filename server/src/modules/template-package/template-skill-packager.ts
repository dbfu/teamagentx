import fs from 'node:fs';
import path from 'node:path';

export interface TemplateSkillFile {
  path: string;
  content: Uint8Array;
}

export interface TemplateSkillPackage {
  slug: string;
  name: string;
  description: string;
  files: TemplateSkillFile[];
  origin: Record<string, unknown> | null;
}

export interface TemplateSkillUsage {
  agentId: string;
  slug: string;
}

export interface DegradedTemplateSkill {
  slug: string;
  reason: string;
}

function parseSkillFrontmatter(skillMd: string): { name: string; description: string } {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: '', description: '' };
  }

  let name = '';
  let description = '';
  for (const line of match[1].split('\n')) {
    const parsed = line.match(/^(\w+):\s*(.*)$/);
    if (!parsed) continue;
    const [, key, raw] = parsed;
    const value = raw.replace(/^["']|["']$/g, '').trim();
    if (key === 'name') name = value;
    if (key === 'description') description = value;
  }

  return { name, description };
}

function collectFilesRecursively(
  rootDir: string,
  currentDir: string,
  results: TemplateSkillFile[],
  visitedRealPaths = new Set<string>(),
) {
  const currentRealPath = fs.realpathSync(currentDir);
  if (visitedRealPaths.has(currentRealPath)) {
    return;
  }
  visitedRealPaths.add(currentRealPath);

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);
    const stat = entry.isSymbolicLink() ? fs.statSync(fullPath) : null;
    if (entry.isDirectory() || stat?.isDirectory()) {
      collectFilesRecursively(rootDir, fullPath, results, visitedRealPaths);
      continue;
    }
    if (entry.isFile() || stat?.isFile()) {
      results.push({
        path: relativePath,
        content: fs.readFileSync(fullPath),
      });
    }
  }

  visitedRealPaths.delete(currentRealPath);
}

export function collectSkillsForTemplate(agentSkillDirs: Array<{ agentId: string; skillsDir: string }>) {
  const skills = new Map<string, TemplateSkillPackage>();
  const usages: TemplateSkillUsage[] = [];
  const degraded: DegradedTemplateSkill[] = [];

  for (const { agentId, skillsDir } of agentSkillDirs) {
    if (!fs.existsSync(skillsDir)) continue;

    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        continue;
      }

      if (!skills.has(entry.name)) {
        const files: TemplateSkillFile[] = [];
        collectFilesRecursively(skillDir, skillDir, files);
        const skillMd = fs.readFileSync(skillMdPath, 'utf8');
        const { name, description } = parseSkillFrontmatter(skillMd);
        const originPath = path.join(skillDir, '.skills', 'origin.json');
        let origin: Record<string, unknown> | null = null;
        if (fs.existsSync(originPath)) {
          try {
            origin = JSON.parse(fs.readFileSync(originPath, 'utf8'));
          } catch {
            origin = null;
          }
        }

        skills.set(entry.name, {
          slug: entry.name,
          name: name || entry.name,
          description,
          files,
          origin,
        });
      }

      usages.push({
        agentId,
        slug: entry.name,
      });
    }
  }

  return {
    skills: Array.from(skills.values()),
    usages,
    degraded,
  };
}

export function materializeTemplateSkills(input: {
  sharedSkillsDir: string;
  skills: TemplateSkillPackage[];
  usages: TemplateSkillUsage[];
  agentSkillsDirs: Map<string, string>;
}) {
  const createdSharedSkillDirs: string[] = [];
  const createdAgentSkillDirs: string[] = [];

  try {
    fs.mkdirSync(input.sharedSkillsDir, { recursive: true });

    for (const skill of input.skills) {
      const targetSkillDir = path.join(input.sharedSkillsDir, skill.slug);
      if (!fs.existsSync(targetSkillDir)) {
        createdSharedSkillDirs.push(targetSkillDir);
      }
      fs.mkdirSync(targetSkillDir, { recursive: true });

      for (const file of skill.files) {
        const targetPath = path.join(targetSkillDir, file.path);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, Buffer.from(file.content));
      }
    }

    for (const usage of input.usages) {
      const agentSkillsDir = input.agentSkillsDirs.get(usage.agentId);
      if (!agentSkillsDir) continue;

      const sourceSkillDir = path.join(input.sharedSkillsDir, usage.slug);
      const targetSkillDir = path.join(agentSkillsDir, usage.slug);
      if (!fs.existsSync(targetSkillDir)) {
        createdAgentSkillDirs.push(targetSkillDir);
      }
      fs.mkdirSync(agentSkillsDir, { recursive: true });
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true });
    }
  } catch (error) {
    for (const createdDir of createdAgentSkillDirs.reverse()) {
      fs.rmSync(createdDir, { recursive: true, force: true });
    }
    for (const createdDir of createdSharedSkillDirs.reverse()) {
      fs.rmSync(createdDir, { recursive: true, force: true });
    }
    throw error;
  }
}
