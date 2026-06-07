import type { SpeechProvider } from './domain/provider.js';
import type { SpeechTaskType } from './domain/types.js';

export class SpeechProviderRegistry {
  private readonly providers = new Map<string, SpeechProvider>();

  register(provider: SpeechProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): SpeechProvider | undefined {
    return this.providers.get(id);
  }

  list(): SpeechProvider[] {
    return [...this.providers.values()];
  }

  findByTaskType(taskType: SpeechTaskType): SpeechProvider[] {
    return this.list().filter((provider) => provider.capabilities.taskTypes.includes(taskType));
  }
}
