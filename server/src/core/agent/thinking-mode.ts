export const AGENT_THINKING_MODES = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AgentThinkingMode = (typeof AGENT_THINKING_MODES)[number];

export const DEFAULT_AGENT_THINKING_MODE = 'high' satisfies AgentThinkingMode;

export function isAgentThinkingMode(value: unknown): value is AgentThinkingMode {
  return typeof value === 'string' && AGENT_THINKING_MODES.includes(value as AgentThinkingMode);
}

export function normalizeAgentThinkingMode(
  value: string | null | undefined,
): AgentThinkingMode | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return DEFAULT_AGENT_THINKING_MODE;

  const normalized = value.trim().toLowerCase();
  if (isAgentThinkingMode(normalized)) return normalized;

  throw new Error('思考模式仅支持 off、minimal、low、medium、high、xhigh、max');
}
