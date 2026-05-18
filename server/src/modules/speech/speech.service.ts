import type { SpeechProvider } from './domain/provider.js';
import type { SpeechArtifact, SpeechSession, SpeechTask } from './domain/types.js';
import { SpeechRouter } from './speech.router.js';

/**
 * #48/#12: 配置/校验类错误，不可通过 fallback 恢复。
 * provider 层通过 throw new SpeechConfigError(...) 标记此类错误，
 * service 层通过 instanceof 判断，无需字符串匹配。
 */
export class SpeechConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechConfigError';
  }
}

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
  // #48: 优先用 instanceof 判断，保留字符串匹配作为兜底
  if (error instanceof SpeechConfigError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message || '';
  const keywords = ['仅支持', 'Invalid', '不支持', 'empty', '非法字符', '不允许', '无效', '未配置'];
  return keywords.some((kw) => message.includes(kw));
}
