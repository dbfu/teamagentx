export const CODEX_MODEL_OPTIONS = [
  { value: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
  { value: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
  { value: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
  { value: 'gpt-5.5', label: 'gpt-5.5' },
  { value: 'gpt-5.4', label: 'gpt-5.4' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
  { value: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark' },
] as const;

export function getCodexModelOptions(
  selectedModel?: string | null,
  localModels?: readonly { name: string }[] | null,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  const add = (value: string, label = value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    options.push({ value, label });
  };

  for (const model of localModels ?? []) add(model.name);
  for (const option of CODEX_MODEL_OPTIONS) add(option.value, option.label);
  const selected = selectedModel?.trim();
  if (selected) add(selected);
  return options;
}
