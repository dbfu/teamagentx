import {
  createDefaultAgentSpeechConfig,
  normalizeAgentSpeechConfig,
  type AgentSpeechConfig,
} from './speech-config.js';

export type SpeechPresetId =
  | 'system-default'
  | 'gentle-guide'
  | 'steady-pro'
  | 'bright-host';

export type SpeechPresetDefinition = {
  id: SpeechPresetId;
  name: string;
  description: string;
  recommendedFor: string[];
  speechConfig: AgentSpeechConfig;
};

export const SPEECH_PRESETS: SpeechPresetDefinition[] = [
  {
    id: 'system-default',
    name: '自然默认',
    description: '最稳妥，适合日常对话和普通助手。',
    recommendedFor: ['通用', '日常对话', '默认助手'],
    speechConfig: normalizeAgentSpeechConfig({
      behavior: {
        enabled: true,
        outputMode: 'manual',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        speed: 1.3,
        volume: 1,
        pitch: null,
        emotion: null,
        style: null,
        prompt: null,
      },
    }),
  },
  {
    id: 'gentle-guide',
    name: '温和讲解',
    description: '适合客服、教学、引导类助手。',
    recommendedFor: ['客服', '教学', '引导'],
    speechConfig: normalizeAgentSpeechConfig({
      behavior: {
        enabled: true,
        outputMode: 'manual',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        speed: 1.3,
        volume: 1,
        pitch: 1.1,
        emotion: 'warm',
        style: 'gentle',
        prompt: '语气温和、停顿自然，像耐心讲解一样说话。',
      },
    }),
  },
  {
    id: 'steady-pro',
    name: '沉稳专业',
    description: '适合法律、分析、咨询类助手。',
    recommendedFor: ['法律', '分析', '咨询'],
    speechConfig: normalizeAgentSpeechConfig({
      behavior: {
        enabled: true,
        outputMode: 'manual',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        speed: 1.3,
        volume: 0.95,
        pitch: 0.9,
        emotion: 'serious',
        style: 'professional',
        prompt: '语气沉稳、表达清晰，避免夸张情绪。',
      },
    }),
  },
  {
    id: 'bright-host',
    name: '活力播报',
    description: '适合主持、热点播报、活跃氛围的助手。',
    recommendedFor: ['主持', '热点播报', '娱乐'],
    speechConfig: normalizeAgentSpeechConfig({
      behavior: {
        enabled: true,
        outputMode: 'manual',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        speed: 1.3,
        volume: 1,
        pitch: 1.15,
        emotion: 'cheerful',
        style: 'energetic',
        prompt: '语气轻快、有节奏感，像在做自然播报。',
      },
    }),
  },
];

function mergeSpeechConfig(
  base: AgentSpeechConfig,
  override?: AgentSpeechConfig | null,
): AgentSpeechConfig {
  if (!override) return base;

  return normalizeAgentSpeechConfig({
    behavior: {
      ...base.behavior,
      ...override.behavior,
    },
    profile: {
      ...base.profile,
      ...override.profile,
    },
  });
}

export function getSpeechPresetById(presetId?: string | null): SpeechPresetDefinition | null {
  if (!presetId) return null;
  return SPEECH_PRESETS.find((item) => item.id === presetId) ?? null;
}

export function resolveSpeechConfigInput(options: {
  speechPresetId?: string | null;
  speechConfig?: AgentSpeechConfig | null;
  currentSpeechConfig?: AgentSpeechConfig | null;
}): AgentSpeechConfig | null {
  const preset = getSpeechPresetById(options.speechPresetId);
  const current = options.currentSpeechConfig
    ? normalizeAgentSpeechConfig(options.currentSpeechConfig)
    : null;
  const override = options.speechConfig ?? null;

  if (!preset && !override && !current) {
    return null;
  }

  if (preset) {
    return mergeSpeechConfig(preset.speechConfig, override);
  }

  if (current) {
    return mergeSpeechConfig(current, override);
  }

  return override ? normalizeAgentSpeechConfig(override) : null;
}

export function inferSpeechPresetId(config?: AgentSpeechConfig | null): SpeechPresetId | null {
  if (!config) return null;
  const normalized = normalizeAgentSpeechConfig(config);

  for (const preset of SPEECH_PRESETS) {
    if (JSON.stringify(preset.speechConfig) === JSON.stringify(normalized)) {
      return preset.id;
    }
  }

  return null;
}

export function getDefaultSpeechPresetConfig(): AgentSpeechConfig {
  return createDefaultAgentSpeechConfig();
}
