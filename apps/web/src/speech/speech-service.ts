import type { SpeechArtifact, SpeechSession, SpeechTask } from '@/speech/domain/types'
import type { SpeechProvider } from '@/speech/providers/provider'
import { SpeechRouter } from '@/speech/speech-router'

export class SpeechService {
  constructor(private readonly router: SpeechRouter) {}

  async execute(task: SpeechTask): Promise<SpeechArtifact | SpeechSession> {
    const triedProviderIds: string[] = []

    try {
      const primaryProvider = this.router.route(task)
      triedProviderIds.push(primaryProvider.id)
      return await this.executeWithProvider(primaryProvider, task)
    } catch (error) {
      if (!task.preferences?.allowFallback || !task.profile?.fallbackProvider) {
        throw error
      }

      const fallbackProvider = this.router.route(task, {
        preferredProviderId: task.profile.fallbackProvider,
        skipProviderIds: triedProviderIds,
      })
      return await this.executeWithProvider(fallbackProvider, task)
    }
  }

  private async executeWithProvider(provider: SpeechProvider, task: SpeechTask): Promise<SpeechArtifact | SpeechSession> {
    switch (task.type) {
      case 'tts':
        if (provider.synthesize) {
          return provider.synthesize(task)
        }
        break
      case 'stt':
        if (provider.transcribe) {
          return provider.transcribe(task)
        }
        break
      case 'realtime-chat':
        if (provider.openRealtimeSession) {
          return provider.openRealtimeSession(task)
        }
        break
    }

    throw new Error(`Provider ${provider.id} does not support task type: ${task.type}`)
  }
}
