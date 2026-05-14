import { createBrowserLocalSpeechProvider } from '@/speech/providers/browser-local-provider'
import { createRemoteTtsSpeechProvider } from '@/speech/providers/remote-tts-provider'
import { SpeechProviderRegistry } from '@/speech/speech-registry'
import { SpeechRouter } from '@/speech/speech-router'
import { SpeechService } from '@/speech/speech-service'

export const webSpeechProviderRegistry = new SpeechProviderRegistry()
webSpeechProviderRegistry.register(createBrowserLocalSpeechProvider())
// 两个 remote TTS 走同一个 /speech/tts 接口，但需要不同的 providerId
// 注册以匹配前端 profile.provider 字段：
// - openai-compatible-tts: 通用 OpenAI 兼容 TTS（包含历史别名 remote-tts，已在 agent-speech.ts 中归一化）
// - edge-tts: 微软 Edge TTS
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider())
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider({ providerId: 'edge-tts' }))

export const webSpeechService = new SpeechService(new SpeechRouter(webSpeechProviderRegistry))
