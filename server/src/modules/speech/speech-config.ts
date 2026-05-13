import type { SpeechProfile } from './domain/types.js';

function normalizeSpeechProviderId(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === 'remote-tts') return 'openai-compatible-tts';
  return provider;
}

export type AgentSpeechBehaviorConfig = {
  enabled: boolean;
  outputMode: 'off' | 'manual' | 'auto_final_only';
  autoPlay: boolean;
};

export type AgentSpeechConfig = {
  behavior: AgentSpeechBehaviorConfig;
  profile: SpeechProfile;
};

type PartialAgentSpeechConfig = {
  behavior?: Partial<AgentSpeechBehaviorConfig>;
  profile?: Partial<SpeechProfile>;
};

export function createDefaultAgentSpeechConfig(): AgentSpeechConfig {
  return {
    behavior: {
      enabled: false,
      outputMode: 'off',
      autoPlay: false,
    },
    profile: {
      provider: 'browser-local',
      model: null,
      voice: null,
      fallbackProvider: null,
      speed: 1.3,
      volume: 1,
      pitch: null,
      emotion: null,
      style: null,
      format: null,
      sampleRate: null,
      temperature: null,
      prompt: null,
      vendorOptions: null,
    },
  };
}

export function normalizeAgentSpeechConfig(config?: PartialAgentSpeechConfig | null): AgentSpeechConfig {
  const defaults = createDefaultAgentSpeechConfig();
  return {
    behavior: {
      enabled: config?.behavior?.enabled ?? defaults.behavior.enabled,
      outputMode: config?.behavior?.outputMode ?? defaults.behavior.outputMode,
      autoPlay: config?.behavior?.autoPlay ?? defaults.behavior.autoPlay,
    },
    profile: {
      provider: normalizeSpeechProviderId(config?.profile?.provider) ?? defaults.profile.provider,
      model: config?.profile?.model ?? defaults.profile.model,
      voice: config?.profile?.voice ?? defaults.profile.voice,
      fallbackProvider: normalizeSpeechProviderId(config?.profile?.fallbackProvider) ?? defaults.profile.fallbackProvider,
      speed: config?.profile?.speed ?? defaults.profile.speed,
      volume: config?.profile?.volume ?? defaults.profile.volume,
      pitch: config?.profile?.pitch ?? defaults.profile.pitch,
      emotion: config?.profile?.emotion ?? defaults.profile.emotion,
      style: config?.profile?.style ?? defaults.profile.style,
      format: config?.profile?.format ?? defaults.profile.format,
      sampleRate: config?.profile?.sampleRate ?? defaults.profile.sampleRate,
      temperature: config?.profile?.temperature ?? defaults.profile.temperature,
      prompt: config?.profile?.prompt ?? defaults.profile.prompt,
      vendorOptions: config?.profile?.vendorOptions ?? defaults.profile.vendorOptions,
    },
  };
}

export function serializeAgentSpeechConfig(config?: AgentSpeechConfig | null): string | null | undefined {
  if (config === undefined) return undefined;
  if (config === null) return null;
  return JSON.stringify(normalizeAgentSpeechConfig(config));
}

export function deserializeAgentSpeechConfig(config?: string | null): AgentSpeechConfig | null {
  if (!config) return null;
  try {
    return normalizeAgentSpeechConfig(JSON.parse(config) as AgentSpeechConfig);
  } catch {
    return null;
  }
}
