import type { AgentSpeechConfig } from '@/lib/agent-api'

// 历史 provider ID 归一化：remote-tts → openai-compatible-tts，edge-tts → browser-local
function normalizeSpeechProviderId(provider?: string | null): string | null {
  if (!provider) return null
  if (provider === 'remote-tts') return 'openai-compatible-tts'
  if (provider === 'edge-tts') return 'browser-local'
  return provider
}

export type AgentVoicePanelConfig = {
  enabled: boolean
  outputMode: 'off' | 'manual' | 'auto_final_only'
  autoPlay: boolean
  // TTS 配置（助手级别，控制助手回复如何朗读）
  provider: string | null           // 'browser-local' | 'openai-compatible-tts'
  ttsProviderId: string | null      // 指定使用哪个 LlmProvider（audio 类型），null = 系统默认
  model: string | null              // 读显示用，由 ttsProviderId 对应的 provider 决定
  voiceId: string | null
  fallbackProvider: string | null
  speed: number
  volume: number
  pitch: number | null
  emotion: string | null
  style: string | null
  format: string | null
  sampleRate: number | null
  temperature: number | null
  prompt: string | null
  // STT 是用户全局输入行为，不在助手维度配置，由系统默认音频供应商决定
}

export type AgentVoicePresetId =
  | 'system-default'
  | 'gentle-guide'
  | 'steady-pro'
  | 'bright-host'

export interface AgentVoicePreset {
  id: AgentVoicePresetId
  name: string
  description: string
  recommendedFor: string[]
  patch: Partial<AgentVoicePanelConfig>
}

export const AGENT_VOICE_PRESETS: AgentVoicePreset[] = [
  {
    id: 'system-default',
    name: '自然默认',
    description: '最稳妥，适合日常对话和普通助手。',
    recommendedFor: ['通用', '日常对话', '默认助手'],
    patch: {
      provider: 'browser-local',
      fallbackProvider: null,
      voiceId: null,
      speed: 1.3,
      volume: 1,
      pitch: null,
      emotion: null,
      style: null,
      prompt: null,
    },
  },
  {
    id: 'gentle-guide',
    name: '温和讲解',
    description: '适合客服、教学、引导类助手。',
    recommendedFor: ['客服', '教学', '引导'],
    patch: {
      provider: 'browser-local',
      fallbackProvider: null,
      voiceId: null,
      speed: 1.3,
      volume: 1,
      pitch: 1.1,
      emotion: 'warm',
      style: 'gentle',
      prompt: '语气温和、停顿自然，像耐心讲解一样说话。',
    },
  },
  {
    id: 'steady-pro',
    name: '沉稳专业',
    description: '适合法律、分析、咨询类助手。',
    recommendedFor: ['法律', '分析', '咨询'],
    patch: {
      provider: 'browser-local',
      fallbackProvider: null,
      voiceId: null,
      speed: 1.3,
      volume: 0.95,
      pitch: 0.9,
      emotion: 'serious',
      style: 'professional',
      prompt: '语气沉稳、表达清晰，避免夸张情绪。',
    },
  },
  {
    id: 'bright-host',
    name: '活力播报',
    description: '适合主持、热点播报、活跃氛围的助手。',
    recommendedFor: ['主持', '热点播报', '娱乐'],
    patch: {
      provider: 'browser-local',
      fallbackProvider: null,
      voiceId: null,
      speed: 1.3,
      volume: 1,
      pitch: 1.15,
      emotion: 'cheerful',
      style: 'energetic',
      prompt: '语气轻快、有节奏感，像在做自然播报。',
    },
  },
]

type PartialAgentSpeechConfig = {
  behavior?: Partial<AgentSpeechConfig['behavior']>
  profile?: Partial<AgentSpeechConfig['profile']>
  sttProfile?: AgentSpeechConfig['sttProfile']
}

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
    sttProfile: null,
  }
}

export function normalizeAgentSpeechConfig(config?: PartialAgentSpeechConfig | null): AgentSpeechConfig {
  const defaults = createDefaultAgentSpeechConfig()
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
    sttProfile: config?.sttProfile ?? null,
  }
}

export function toVoicePanelConfig(config?: AgentSpeechConfig | null): AgentVoicePanelConfig {
  const normalized = normalizeAgentSpeechConfig(config)
  // #52: 运行时校验 llmProviderId 类型，防止非 string 值流入状态
  const rawProviderId = normalized.profile.vendorOptions?.llmProviderId
  const ttsProviderId: string | null = typeof rawProviderId === 'string' ? rawProviderId : null
  return {
    enabled: normalized.behavior.enabled,
    outputMode: normalized.behavior.outputMode,
    autoPlay: normalized.behavior.autoPlay,
    provider: normalized.profile.provider ?? 'browser-local',
    ttsProviderId,
    model: normalized.profile.model ?? null,
    fallbackProvider: normalized.profile.fallbackProvider ?? null,
    voiceId: normalized.profile.voice ?? null,
    speed: normalized.profile.speed ?? 1,
    volume: normalized.profile.volume ?? 1,
    pitch: normalized.profile.pitch ?? null,
    emotion: normalized.profile.emotion ?? null,
    style: normalized.profile.style ?? null,
    format: normalized.profile.format ?? null,
    sampleRate: normalized.profile.sampleRate ?? null,
    temperature: normalized.profile.temperature ?? null,
    prompt: normalized.profile.prompt ?? null,
  }
}

export function fromVoicePanelConfig(config: AgentVoicePanelConfig, sttProfile?: AgentSpeechConfig['sttProfile']): AgentSpeechConfig {
  const ttsVendorOptions: Record<string, unknown> | null = config.ttsProviderId
    ? { llmProviderId: config.ttsProviderId }
    : null

  return normalizeAgentSpeechConfig({
    behavior: {
      enabled: config.enabled,
      outputMode: config.enabled ? config.outputMode : 'off',
      autoPlay: config.enabled ? config.autoPlay : false,
    },
    profile: {
      provider: config.provider ?? 'browser-local',
      model: config.model?.trim() || null,
      voice: config.voiceId?.trim() || null,
      fallbackProvider: config.fallbackProvider?.trim() || null,
      speed: config.speed,
      volume: config.volume,
      pitch: config.pitch,
      emotion: config.emotion?.trim() || null,
      style: config.style?.trim() || null,
      format: config.format?.trim() || null,
      sampleRate: config.sampleRate,
      temperature: config.temperature,
      prompt: config.prompt?.trim() || null,
      vendorOptions: ttsVendorOptions,
    },
    // #23: 透传 sttProfile，避免丢失语音识别配置
    sttProfile: sttProfile ?? null,
  })
}

export function applyVoicePreset(
  config: AgentVoicePanelConfig,
  presetId: AgentVoicePresetId,
): AgentVoicePanelConfig {
  const preset = AGENT_VOICE_PRESETS.find((item) => item.id === presetId)
  if (!preset) return config
  // #51: 仅当 preset 明确指定 provider 为 'browser-local' 时才清除远程 provider 绑定
  const shouldClearTtsProvider = preset.patch.provider === 'browser-local'
  return {
    ...config,
    ...preset.patch,
    ttsProviderId: shouldClearTtsProvider ? null : config.ttsProviderId,
  }
}

// 仅比较影响预设身份的核心字段
const PRESET_CORE_FIELDS: (keyof AgentVoicePanelConfig)[] = [
  'provider',
  'fallbackProvider',
  'voiceId',
  'speed',
  'volume',
  'pitch',
  'emotion',
  'style',
  'prompt',
]

const FLOAT_TOLERANCE = 1e-9

export function inferVoicePresetId(config: AgentVoicePanelConfig): AgentVoicePresetId | null {
  for (const preset of AGENT_VOICE_PRESETS) {
    const matches = PRESET_CORE_FIELDS.every((key) => {
      if (!(key in preset.patch)) return true
      const configVal = config[key]
      const patchVal = preset.patch[key as keyof typeof preset.patch]
      // #39: patch 中显式定义为 null 的字段，config 中也必须是 null 才匹配
      if (patchVal === null) return configVal === null
      // #24: 数值字段用容差比较，避免浮点精度问题
      if (typeof patchVal === 'number' && typeof configVal === 'number') {
        return Math.abs(configVal - patchVal) < FLOAT_TOLERANCE
      }
      return configVal === patchVal
    })
    if (matches) {
      return preset.id
    }
  }
  return null
}

export function getAgentVoicePresetById(presetId: AgentVoicePresetId): AgentVoicePreset | null {
  return AGENT_VOICE_PRESETS.find((item) => item.id === presetId) ?? null
}
