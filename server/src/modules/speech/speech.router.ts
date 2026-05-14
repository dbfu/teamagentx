import type { SpeechProvider } from './domain/provider.js';
import type { SpeechTask } from './domain/types.js';
import { SpeechProviderRegistry } from './speech.registry.js';

interface RouteOptions {
  preferredProviderId?: string | null;
  skipProviderIds?: string[];
}

export class SpeechRouter {
  constructor(private readonly registry: SpeechProviderRegistry) {}

  route(task: SpeechTask, options: RouteOptions = {}): SpeechProvider {
    const skipped = new Set(options.skipProviderIds ?? []);
    const candidateIds = [
      options.preferredProviderId,
      task.profile?.provider,
      ...this.registry.findByTaskType(task.type).map((provider) => provider.id),
    ].filter((value): value is string => !!value);

    for (const providerId of candidateIds) {
      if (skipped.has(providerId)) continue;
      const provider = this.registry.get(providerId);
      if (!provider) continue;
      if (provider.capabilities.taskTypes.includes(task.type)) {
        return provider;
      }
    }

    throw new Error(`No speech provider available for task type: ${task.type}`);
  }
}
