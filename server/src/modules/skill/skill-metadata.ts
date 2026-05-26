import * as fs from 'fs';

export interface SkillFrontmatter {
  [key: string]: string;
}

export interface SkillMetadata {
  name?: string;
  description?: string;
}

const MULTILINE_SCALAR_MARKERS = new Set(['|', '>', '|-', '>-']);

function cleanScalarValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return {};
  }

  const frontmatter: SkillFrontmatter = {};
  const lines = frontmatterMatch[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (MULTILINE_SCALAR_MARKERS.has(value)) {
      const parts: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^\s/) && lines[j].trim() !== '') {
          parts.push(lines[j].trim());
          continue;
        }
        break;
      }
      frontmatter[key] = parts.join(' ').trim();
      continue;
    }

    frontmatter[key] = cleanScalarValue(value);
  }

  return frontmatter;
}

export function parseSkillMetadata(content: string): SkillMetadata {
  const frontmatter = parseSkillFrontmatter(content);
  return {
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

export function readSkillMetadata(skillMdPath: string): SkillMetadata {
  try {
    return parseSkillMetadata(fs.readFileSync(skillMdPath, 'utf-8'));
  } catch {
    return {};
  }
}
