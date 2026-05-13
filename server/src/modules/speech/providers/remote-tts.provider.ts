import type { Agent, LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { SpeechProvider } from '../domain/provider.js';
import type { SpeechArtifact, SpeechTask } from '../domain/types.js';

type RemoteTtsDependencies = {
  resolveLlmProvider?: (task: SpeechTask<{ text: string }>) => Promise<LlmProvider>;
  providerId?: string;
};

function getSpeechEndpoint(apiUrl?: string | null): string {
  const trimmed = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (trimmed.endsWith('/audio/speech')) return trimmed;
  return `${trimmed}/audio/speech`;
}

function buildInstructions(task: SpeechTask<{ text: string }>): string | null {
  const chunks = [
    task.profile?.prompt?.trim(),
    task.profile?.style ? `style: ${task.profile.style.trim()}` : null,
    task.profile?.emotion ? `emotion: ${task.profile.emotion.trim()}` : null,
  ].filter((value): value is string => !!value);

  return chunks.length > 0 ? chunks.join('\n') : null;
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

async function resolveLlmProviderFromTask(task: SpeechTask<{ text: string }>): Promise<LlmProvider> {
  const explicitProviderId = typeof task.profile?.vendorOptions?.llmProviderId === 'string'
    ? task.profile.vendorOptions.llmProviderId
    : null;

  if (explicitProviderId) {
    const provider = await prisma.llmProvider.findUnique({ where: { id: explicitProviderId } });
    if (provider?.isActive) {
      return provider;
    }
  }

  if (task.context?.agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: task.context.agentId },
      include: {
        llmProvider: true,
      },
    }) as (Agent & { llmProvider: LlmProvider | null }) | null;

    if (agent?.llmProvider?.isActive) {
      return agent.llmProvider;
    }
  }

  const provider = await prisma.llmProvider.findFirst({
    where: {
      isActive: true,
      isDefault: true,
    },
  });

  if (!provider) {
    throw new Error('未找到可用的默认语音模型供应商');
  }

  return provider;
}

export function createRemoteTtsProvider(dependencies: RemoteTtsDependencies = {}): SpeechProvider {
  const resolveLlmProvider = dependencies.resolveLlmProvider ?? resolveLlmProviderFromTask;
  const providerId = dependencies.providerId ?? 'openai-compatible-tts';

  return {
    id: providerId,
    runtime: 'server',
    capabilities: {
      provider: providerId,
      runtime: 'server',
      taskTypes: ['tts'],
      formats: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'],
    },
    async synthesize(task) {
      const text = String((task.input as { text?: string }).text || '').trim();
      if (!text) {
        return {
          kind: 'audio',
          provider: providerId,
          text: '',
        };
      }

      const llmProvider = await resolveLlmProvider(task as SpeechTask<{ text: string }>);
      if (llmProvider.apiProtocol !== 'openai') {
        throw new Error(`${providerId} 仅支持 openai 协议供应商，当前为 ${llmProvider.apiProtocol}`);
      }

      const format = task.profile?.format?.trim() || 'mp3';
      const voice = task.profile?.voice?.trim() || 'alloy';
      const model = task.profile?.model?.trim() || llmProvider.model;
      const endpoint = getSpeechEndpoint(llmProvider.apiUrl);
      const instructions = buildInstructions(task as SpeechTask<{ text: string }>);
      const vendorOptions = task.profile?.vendorOptions && typeof task.profile.vendorOptions === 'object'
        ? { ...task.profile.vendorOptions }
        : {};
      delete (vendorOptions as Record<string, unknown>).llmProviderId;

      const baseBody: Record<string, unknown> = {
        ...vendorOptions,
        model,
        voice,
        input: text,
        response_format: format,
      };

      if (typeof task.profile?.speed === 'number') {
        baseBody.speed = task.profile.speed;
      }
      if (instructions) {
        baseBody.instructions = instructions;
      }

      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmProvider.apiKey}`,
        },
        body: JSON.stringify(baseBody),
      });

      if (!response.ok && instructions) {
        const fallbackBody = { ...baseBody };
        delete fallbackBody.instructions;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llmProvider.apiKey}`,
          },
          body: JSON.stringify(fallbackBody),
        });
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || `远程语音合成失败(${response.status})`);
      }

      const mimeType = response.headers.get('content-type') || 'audio/mpeg';
      const bytes = new Uint8Array(await response.arrayBuffer());

      return {
        kind: 'audio',
        provider: providerId,
        text,
        audioUrl: toDataUrl(bytes, mimeType),
        mimeType,
        model,
        voice,
        metadata: {
          runtime: 'server',
          llmProviderId: llmProvider.id,
          llmProviderName: llmProvider.name,
        },
      } satisfies SpeechArtifact;
    },
  };
}
