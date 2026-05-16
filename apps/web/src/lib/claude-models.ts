export const CLAUDE_MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B (local)' },
  { value: 'gpt-oss:20b', label: 'gpt-oss 20B (local)' },
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
