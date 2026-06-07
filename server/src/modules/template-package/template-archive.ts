import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { TemplateManifest } from './template-manifest.js';
import type { CapabilityDescriptor } from './capability-mapper.js';
import type {
  DegradedTemplateSkill,
  TemplateSkillPackage,
  TemplateSkillUsage,
} from './template-skill-packager.js';

const MANIFEST_PATH = 'manifest.json';
const SNAPSHOT_PATH = 'snapshot.json';
const CAPABILITY_DESCRIPTORS_PATH = 'capability-descriptors.json';
const SKILL_USAGES_PATH = 'skill-usages.json';
const DEGRADED_SKILLS_PATH = 'degraded-skills.json';
const SKILLS_DIR = 'skills';
const TEMPLATE_METADATA_DIR = '.teamagentx-template';
const SKILL_METADATA_FILE = 'skill-metadata.json';

export interface TemplateArchivePayload {
  manifest: TemplateManifest;
  snapshot: Record<string, unknown>;
  capabilityDescriptors: CapabilityDescriptor[];
  skills: TemplateSkillPackage[];
  skillUsages: TemplateSkillUsage[];
  degradedSkills: DegradedTemplateSkill[];
}

interface SkillArchiveMetadata {
  slug: string;
  name: string;
  description: string;
  origin: Record<string, unknown> | null;
  files: string[];
}

function toJsonBytes(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

function fromJsonBytes<T>(value: Uint8Array | undefined, filePath: string): T {
  if (!value) {
    throw new Error(`群组模板缺少 ${filePath}`);
  }

  try {
    return JSON.parse(strFromU8(value)) as T;
  } catch {
    throw new Error(`群组模板中的 ${filePath} 不是有效 JSON`);
  }
}

function normalizeArchiveRelativePath(relativePath: string): string {
  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || path.posix.isAbsolute(normalized) || normalized.startsWith('../')) {
    throw new Error(`群组模板包含非法文件路径: ${relativePath}`);
  }

  return normalized;
}

function getSkillMetadataPath(slug: string): string {
  return path.posix.join(SKILLS_DIR, slug, TEMPLATE_METADATA_DIR, SKILL_METADATA_FILE);
}

export function buildTemplateArchive(payload: TemplateArchivePayload): Buffer {
  const entries: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: toJsonBytes(payload.manifest),
    [SNAPSHOT_PATH]: toJsonBytes(payload.snapshot),
    [CAPABILITY_DESCRIPTORS_PATH]: toJsonBytes(payload.capabilityDescriptors),
    [SKILL_USAGES_PATH]: toJsonBytes(payload.skillUsages),
    [DEGRADED_SKILLS_PATH]: toJsonBytes(payload.degradedSkills),
  };

  for (const skill of payload.skills) {
    const filePaths = skill.files.map((file) => normalizeArchiveRelativePath(file.path));
    const metadata: SkillArchiveMetadata = {
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      files: filePaths,
    };

    entries[getSkillMetadataPath(skill.slug)] = toJsonBytes(metadata);

    for (const file of skill.files) {
      const relativePath = normalizeArchiveRelativePath(file.path);
      const archivePath = path.posix.join(SKILLS_DIR, skill.slug, relativePath);
      entries[archivePath] = file.content;
    }
  }

  return Buffer.from(zipSync(entries));
}

export function parseTemplateArchive(buffer: Uint8Array): TemplateArchivePayload {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buffer);
  } catch {
    throw new Error('群组模板文件不是有效的 ZIP 压缩包');
  }

  const manifest = fromJsonBytes<TemplateManifest>(files[MANIFEST_PATH], MANIFEST_PATH);
  const snapshot = fromJsonBytes<Record<string, unknown>>(files[SNAPSHOT_PATH], SNAPSHOT_PATH);
  const capabilityDescriptors = fromJsonBytes<CapabilityDescriptor[]>(
    files[CAPABILITY_DESCRIPTORS_PATH],
    CAPABILITY_DESCRIPTORS_PATH,
  );
  const skillUsages = fromJsonBytes<TemplateSkillUsage[]>(files[SKILL_USAGES_PATH], SKILL_USAGES_PATH);
  const degradedSkills = fromJsonBytes<DegradedTemplateSkill[]>(files[DEGRADED_SKILLS_PATH], DEGRADED_SKILLS_PATH);

  const skillMetadataPaths = Object.keys(files)
    .filter((filePath) => filePath.startsWith(`${SKILLS_DIR}/`) && filePath.endsWith(`/${SKILL_METADATA_FILE}`))
    .sort();

  const skills: TemplateSkillPackage[] = skillMetadataPaths.map((metadataPath) => {
    const metadata = fromJsonBytes<SkillArchiveMetadata>(files[metadataPath], metadataPath);

    return {
      slug: metadata.slug,
      name: metadata.name,
      description: metadata.description,
      origin: metadata.origin,
      files: metadata.files.map((relativePath) => {
        const normalizedPath = normalizeArchiveRelativePath(relativePath);
        const archivePath = path.posix.join(SKILLS_DIR, metadata.slug, normalizedPath);
        const content = files[archivePath];
        if (!content) {
          throw new Error(`群组模板缺少技能文件: ${archivePath}`);
        }

        return {
          path: normalizedPath,
          content,
        };
      }),
    };
  });

  return {
    manifest,
    snapshot,
    capabilityDescriptors,
    skills,
    skillUsages,
    degradedSkills,
  };
}
