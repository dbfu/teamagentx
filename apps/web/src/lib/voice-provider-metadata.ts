/**
 * 已知语音供应商的模型和音色列表。
 * 新增供应商只需在此文件添加一个条目，UI 自动支持下拉选择。
 *
 * 字段说明：
 *   models     — 该供应商常用的 TTS 模型名称列表（顺序即推荐顺序）
 *   sttModels  — STT 专用模型（若与 TTS 不同）
 *   voices     — 模型 -> 音色列表（为空则 UI 显示自由文本输入）
 */

export type VoiceOption = {
  id: string      // 传给 API 的值
  label: string   // 显示给用户的名称
}

export type VoiceProviderMeta = {
  /** 匹配规则：LlmProvider.apiUrl 包含此字符串则命中 */
  urlPattern: string
  label: string
  ttsModels: string[]
  sttModels: string[]
  /** model -> voices，key 为完整模型名；未列出的模型显示自由输入 */
  voices: Record<string, VoiceOption[]>
}

export const VOICE_PROVIDER_METADATA: VoiceProviderMeta[] = [
  {
    urlPattern: 'siliconflow',
    label: 'SiliconFlow',
    ttsModels: ['FunAudioLLM/CosyVoice2-0.5B'],
    sttModels: ['FunAudioLLM/SenseVoiceSmall'],
    voices: {
      'FunAudioLLM/CosyVoice2-0.5B': [
        { id: 'FunAudioLLM/CosyVoice2-0.5B:anna', label: 'Anna（沉稳女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:bella', label: 'Bella（热情女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:claire', label: 'Claire（温柔女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:diana', label: 'Diana（活泼女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:alex', label: 'Alex（沉稳男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', label: 'Benjamin（低沉男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:charles', label: 'Charles（磁性男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:david', label: 'David（明快男声）' },
      ],
    },
  },
  {
    urlPattern: 'api.openai.com',
    label: 'OpenAI',
    ttsModels: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    sttModels: ['whisper-1'],
    voices: {
      'tts-1': [
        { id: 'alloy', label: 'Alloy（中性）' },
        { id: 'echo', label: 'Echo（男声）' },
        { id: 'fable', label: 'Fable（英式男声）' },
        { id: 'onyx', label: 'Onyx（低沉男声）' },
        { id: 'nova', label: 'Nova（女声）' },
        { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
      ],
      'tts-1-hd': [
        { id: 'alloy', label: 'Alloy（中性）' },
        { id: 'echo', label: 'Echo（男声）' },
        { id: 'fable', label: 'Fable（英式男声）' },
        { id: 'onyx', label: 'Onyx（低沉男声）' },
        { id: 'nova', label: 'Nova（女声）' },
        { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
      ],
      'gpt-4o-mini-tts': [
        { id: 'alloy', label: 'Alloy' },
        { id: 'echo', label: 'Echo' },
        { id: 'fable', label: 'Fable' },
        { id: 'onyx', label: 'Onyx' },
        { id: 'nova', label: 'Nova' },
        { id: 'shimmer', label: 'Shimmer' },
        { id: 'ash', label: 'Ash' },
        { id: 'ballad', label: 'Ballad' },
        { id: 'coral', label: 'Coral' },
        { id: 'sage', label: 'Sage' },
        { id: 'verse', label: 'Verse' },
      ],
    },
  },
]

/** 根据 apiUrl 找到对应的 provider metadata */
export function getProviderMeta(apiUrl: string | null | undefined): VoiceProviderMeta | null {
  if (!apiUrl) return null
  const url = apiUrl.toLowerCase()
  return VOICE_PROVIDER_METADATA.find((m) => url.includes(m.urlPattern)) ?? null
}

/** 根据 apiUrl + 模型名获取音色列表，没有则返回 null（UI 显示自由输入） */
export function getVoiceOptions(apiUrl: string | null | undefined, model: string | null | undefined): VoiceOption[] | null {
  if (!model) return null
  const meta = getProviderMeta(apiUrl)
  if (!meta) return null
  return meta.voices[model] ?? null
}
