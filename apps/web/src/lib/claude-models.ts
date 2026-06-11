export const CLAUDE_MODEL_OPTIONS = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6 Legacy' },
] as const;

export function getClaudeModelOptions(selectedModel?: string | null): Array<{ value: string; label: string }> {
  const model = selectedModel?.trim();
  if (!model || CLAUDE_MODEL_OPTIONS.some((option) => option.value === model)) {
    return [...CLAUDE_MODEL_OPTIONS];
  }

  return [
    { value: model, label: model },
    ...CLAUDE_MODEL_OPTIONS,
  ];
}
