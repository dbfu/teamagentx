import type { SpeechTask } from '@/speech/domain/types'
import type { SpeechProvider } from '@/speech/providers/provider'
import { SpeechProviderRegistry } from '@/speech/speech-registry'

interface RouteOptions {
  preferredProviderId?: string | null
  skipProviderIds?: string[]
}

export class SpeechRouter {
  constructor(private readonly registry: SpeechProviderRegistry) {}

  route(task: SpeechTask, options: RouteOptions = {}): SpeechProvider {
    const skipped = new Set(options.skipProviderIds ?? [])
    const candidates = [
      options.preferredProviderId,
      task.profile?.provider,
      ...this.registry.findByTaskType(task.type).map((provider) => provider.id),
    ].filter((value): value is string => Boolean(value))

    for (const providerId of candidates) {
      if (skipped.has(providerId)) continue
      const provider = this.registry.get(providerId)
      if (provider && provider.capabilities.taskTypes.includes(task.type)) {
        return provider
      }
    }

    throw new Error(`No speech provider available for task type: ${task.type}`)
  }
}
