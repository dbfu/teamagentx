export type TemplateSourceType = 'local' | 'market';

export interface TemplateManifest {
  schemaVersion: '1.0';
  templateId: string;
  version: string;
  title: string;
  summary: string | null;
  source: {
    type: TemplateSourceType;
    author?: string | null;
    channel?: string | null;
  };
  contents: {
    group: boolean;
    agents: number;
    categories: number;
    skills: number;
    cronTasks: number;
  };
}

export class TemplateManifestError extends Error {}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TemplateManifestError(`${fieldName} is required`);
  }

  return value.trim();
}

function normalizeNonNegativeInt(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TemplateManifestError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

export function parseTemplateManifest(input: unknown): TemplateManifest {
  if (!input || typeof input !== 'object') {
    throw new TemplateManifestError('manifest must be an object');
  }

  const record = input as Record<string, unknown>;
  const schemaVersion = normalizeRequiredString(record.schemaVersion, 'schemaVersion');
  if (schemaVersion !== '1.0') {
    throw new TemplateManifestError(`Unsupported template schemaVersion: ${schemaVersion}`);
  }

  const source = record.source;
  if (!source || typeof source !== 'object') {
    throw new TemplateManifestError('source is required');
  }
  const sourceRecord = source as Record<string, unknown>;
  const sourceType = normalizeRequiredString(sourceRecord.type, 'source.type');
  if (sourceType !== 'local' && sourceType !== 'market') {
    throw new TemplateManifestError(`Unsupported source.type: ${sourceType}`);
  }

  const contents = record.contents;
  if (!contents || typeof contents !== 'object') {
    throw new TemplateManifestError('contents is required');
  }
  const contentsRecord = contents as Record<string, unknown>;

  if (typeof contentsRecord.group !== 'boolean') {
    throw new TemplateManifestError('contents.group must be a boolean');
  }

  const summary =
    typeof record.summary === 'string' && record.summary.trim()
      ? record.summary.trim()
      : null;

  return {
    schemaVersion: '1.0',
    templateId: normalizeRequiredString(record.templateId, 'templateId'),
    version: normalizeRequiredString(record.version, 'version'),
    title: normalizeRequiredString(record.title, 'title'),
    summary,
    source: {
      type: sourceType,
      author: typeof sourceRecord.author === 'string' && sourceRecord.author.trim()
        ? sourceRecord.author.trim()
        : null,
      channel: typeof sourceRecord.channel === 'string' && sourceRecord.channel.trim()
        ? sourceRecord.channel.trim()
        : null,
    },
    contents: {
      group: contentsRecord.group,
      agents: normalizeNonNegativeInt(contentsRecord.agents, 'contents.agents'),
      categories: normalizeNonNegativeInt(contentsRecord.categories, 'contents.categories'),
      skills: normalizeNonNegativeInt(contentsRecord.skills, 'contents.skills'),
      cronTasks: normalizeNonNegativeInt(contentsRecord.cronTasks, 'contents.cronTasks'),
    },
  };
}
