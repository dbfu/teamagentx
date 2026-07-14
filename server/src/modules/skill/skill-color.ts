export const SKILL_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
] as const;

export type SkillColor = (typeof SKILL_COLORS)[number];

const DEFAULT_SKILL_COLORS: SkillColor[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
];

export function isSkillColor(value: unknown): value is SkillColor {
  return typeof value === 'string' && SKILL_COLORS.includes(value as SkillColor);
}

export function getDefaultSkillColor(slug: string): SkillColor {
  let hash = 0;
  for (const character of slug) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return DEFAULT_SKILL_COLORS[hash % DEFAULT_SKILL_COLORS.length];
}

export function parseSkillColorTags(value: string | null): Record<string, SkillColor> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, SkillColor] => (
        isSkillColor(entry[1])
      )),
    );
  } catch {
    return {};
  }
}
