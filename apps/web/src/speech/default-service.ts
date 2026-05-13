import { createBrowserLocalSpeechProvider } from '@/speech/providers/browser-local-provider'
import { createRemoteTtsSpeechProvider } from '@/speech/providers/remote-tts-provider'
import { SpeechProviderRegistry } from '@/speech/speech-registry'
import { SpeechRouter } from '@/speech/speech-router'
import { SpeechService } from '@/speech/speech-service'

export const webSpeechProviderRegistry = new SpeechProviderRegistry()
webSpeechProviderRegistry.register(createBrowserLocalSpeechProvider())
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider())
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider({ providerId: 'remote-tts' }))

export const webSpeechService = new SpeechService(new SpeechRouter(webSpeechProviderRegistry))
