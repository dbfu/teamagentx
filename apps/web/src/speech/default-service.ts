import { createBrowserLocalSpeechProvider } from '@/speech/providers/browser-local-provider'
import { createRemoteTtsSpeechProvider } from '@/speech/providers/remote-tts-provider'
import { SpeechProviderRegistry } from '@/speech/speech-registry'
import { SpeechRouter } from '@/speech/speech-router'
import { SpeechService } from '@/speech/speech-service'

export const webSpeechProviderRegistry = new SpeechProviderRegistry()
webSpeechProviderRegistry.register(createBrowserLocalSpeechProvider())
// openai-compatible-tts: 通用 OpenAI 兼容 TTS（历史别名 remote-tts 已在 agent-speech.ts 中归一化）
// edge-tts 已移除，历史配置通过 normalizeSpeechProviderId 归一化为 browser-local
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider())

export const webSpeechService = new SpeechService(new SpeechRouter(webSpeechProviderRegistry))
