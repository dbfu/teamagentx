export const CODEX_MODEL_OPTIONS = [
  { value: 'gpt-5.5', label: 'gpt-5.5' },
  { value: 'gpt-5.4', label: 'gpt-5.4' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { value: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
] as const;

export function getCodexModelOptions(selectedModel?: string | null): Array<{ value: string; label: string }> {
  const model = selectedModel?.trim();
  if (!model || CODEX_MODEL_OPTIONS.some((option) => option.value === model)) {
    return [...CODEX_MODEL_OPTIONS];
  }

  return [
    { value: model, label: model },
    ...CODEX_MODEL_OPTIONS,
  ];
}
