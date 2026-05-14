import type { SpeechProvider } from './domain/provider.js';
import type { SpeechArtifact, SpeechSession, SpeechTask } from './domain/types.js';
import { SpeechRouter } from './speech.router.js';

export class SpeechService {
  constructor(private readonly router: SpeechRouter) {}

  async execute(task: SpeechTask): Promise<SpeechArtifact | SpeechSession> {
    const triedProviderIds: string[] = [];

    try {
      const primaryProvider = this.router.route(task);
      triedProviderIds.push(primaryProvider.id);
      return await this.executeWithProvider(primaryProvider, task);
    } catch (error) {
      if (!task.preferences?.allowFallback || !task.profile?.fallbackProvider) {
        throw error;
      }

      // 配置/校验类错误不可通过 fallback 恢复，直接抛出
      if (isUnrecoverableError(error)) {
        throw error;
      }

      const fallbackProvider = this.router.route(task, {
        preferredProviderId: task.profile.fallbackProvider,
        skipProviderIds: triedProviderIds,
      });
      return await this.executeWithProvider(fallbackProvider, task);
    }
  }

  private async executeWithProvider(provider: SpeechProvider, task: SpeechTask): Promise<SpeechArtifact | SpeechSession> {
    switch (task.type) {
      case 'tts':
        if (!provider.synthesize) {
          break;
        }
        return provider.synthesize(task);
      case 'stt':
        if (!provider.transcribe) {
          break;
        }
        return provider.transcribe(task);
      case 'realtime-chat':
        if (!provider.openRealtimeSession) {
          break;
        }
        return provider.openRealtimeSession(task);
    }

    throw new Error(`Provider ${provider.id} does not support task type: ${task.type}`);
  }
}

function isUnrecoverableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const keywords = ['仅支持', 'Invalid', '不支持', 'empty', '非法字符', '不允许', '无效'];
  return keywords.some((kw) => message.includes(kw));
}
