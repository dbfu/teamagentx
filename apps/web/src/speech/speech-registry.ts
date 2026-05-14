import type { SpeechProvider } from '@/speech/providers/provider'
import type { SpeechTaskType } from '@/speech/domain/types'

export class SpeechProviderRegistry {
  private readonly providers = new Map<string, SpeechProvider>()

  register(provider: SpeechProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: string): SpeechProvider | undefined {
    return this.providers.get(id)
  }

  list(): SpeechProvider[] {
    return [...this.providers.values()]
  }

  findByTaskType(taskType: SpeechTaskType): SpeechProvider[] {
    return this.list().filter((provider) => provider.capabilities.taskTypes.includes(taskType))
  }
}
