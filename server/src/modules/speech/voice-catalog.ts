import type { LlmProvider } from '@prisma/client';

export type VoiceOption = {
  id: string;
  label: string;
};

export type VoiceProviderMeta = {
  urlPattern: string;
  label: string;
  ttsModels: string[];
  sttModels: string[];
  voices: Record<string, VoiceOption[]>;
};

export type BrowserLocalVoiceOption = {
  id: string;
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
};

export type BrowserLocalVoiceSnapshot = {
  userId: string;
  clientId: string;
  voices: BrowserLocalVoiceOption[];
  updatedAt: string;
};

export type SpeechCatalogModel = {
  id: string;
  voices: VoiceOption[];
};

export type RemoteVoiceCatalogEntry = {
  llmProviderId: string;
  llmProviderName: string;
  apiUrl: string | null;
  providerLabel: string;
  models: SpeechCatalogModel[];
};

export type SpeechVoiceCatalog = {
  browserLocal: {
    provider: 'browser-local';
    reportedAt: string | null;
    voices: BrowserLocalVoiceOption[];
  };
  remoteProviders: RemoteVoiceCatalogEntry[];
};

export const VOICE_PROVIDER_METADATA: VoiceProviderMeta[] = [
  {
    urlPattern: 'siliconflow',
    label: 'SiliconFlow',
    ttsModels: ['FunAudioLLM/CosyVoice2-0.5B'],
    sttModels: ['FunAudioLLM/SenseVoiceSmall'],
    voices: {
      'FunAudioLLM/CosyVoice2-0.5B': [
        { id: 'FunAudioLLM/CosyVoice2-0.5B:anna', label: 'Anna（沉稳女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:bella', label: 'Bella（热情女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:claire', label: 'Claire（温柔女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:diana', label: 'Diana（活泼女声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:alex', label: 'Alex（沉稳男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', label: 'Benjamin（低沉男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:charles', label: 'Charles（磁性男声）' },
        { id: 'FunAudioLLM/CosyVoice2-0.5B:david', label: 'David（明快男声）' },
      ],
    },
  },
  {
    urlPattern: 'api.openai.com',
    label: 'OpenAI',
    ttsModels: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    sttModels: ['whisper-1'],
    voices: {
      'tts-1': [
        { id: 'alloy', label: 'Alloy（中性）' },
        { id: 'echo', label: 'Echo（男声）' },
        { id: 'fable', label: 'Fable（英式男声）' },
        { id: 'onyx', label: 'Onyx（低沉男声）' },
        { id: 'nova', label: 'Nova（女声）' },
        { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
      ],
      'tts-1-hd': [
        { id: 'alloy', label: 'Alloy（中性）' },
        { id: 'echo', label: 'Echo（男声）' },
        { id: 'fable', label: 'Fable（英式男声）' },
        { id: 'onyx', label: 'Onyx（低沉男声）' },
        { id: 'nova', label: 'Nova（女声）' },
        { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
      ],
      'gpt-4o-mini-tts': [
        { id: 'alloy', label: 'Alloy' },
        { id: 'echo', label: 'Echo' },
        { id: 'fable', label: 'Fable' },
        { id: 'onyx', label: 'Onyx' },
        { id: 'nova', label: 'Nova' },
        { id: 'shimmer', label: 'Shimmer' },
        { id: 'ash', label: 'Ash' },
        { id: 'ballad', label: 'Ballad' },
        { id: 'coral', label: 'Coral' },
        { id: 'sage', label: 'Sage' },
        { id: 'verse', label: 'Verse' },
      ],
    },
  },
];

const BROWSER_LOCAL_VOICE_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const BROWSER_LOCAL_VOICE_SNAPSHOT_MAX_ENTRIES = 200;

const browserLocalVoiceSnapshots = new Map<string, BrowserLocalVoiceSnapshot>();

function buildBrowserLocalVoiceSnapshotKey(userId: string, clientId: string): string {
  return `${userId}::${clientId}`;
}

function normalizeAudioUsage(audioUsage?: string | null): 'tts' | 'stt' | 'both' {
  if (audioUsage === 'tts' || audioUsage === 'stt') return audioUsage;
  return 'both';
}

export function getVoiceProviderMeta(apiUrl: string | null | undefined): VoiceProviderMeta | null {
  if (!apiUrl) return null;
  const url = apiUrl.toLowerCase();
  return VOICE_PROVIDER_METADATA.find((item) => url.includes(item.urlPattern)) ?? null;
}

export function pruneExpiredBrowserLocalVoiceSnapshots(nowMs = Date.now()): void {
  for (const [key, snapshot] of browserLocalVoiceSnapshots.entries()) {
    const updatedAtMs = Date.parse(snapshot.updatedAt);
    if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs > BROWSER_LOCAL_VOICE_SNAPSHOT_TTL_MS) {
      browserLocalVoiceSnapshots.delete(key);
    }
  }
}

function trimBrowserLocalVoiceSnapshotsToLimit(): void {
  if (browserLocalVoiceSnapshots.size <= BROWSER_LOCAL_VOICE_SNAPSHOT_MAX_ENTRIES) return;
  const snapshots = Array.from(browserLocalVoiceSnapshots.entries())
    .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));

  while (snapshots.length > 0 && browserLocalVoiceSnapshots.size > BROWSER_LOCAL_VOICE_SNAPSHOT_MAX_ENTRIES) {
    const [oldestKey] = snapshots.shift()!;
    browserLocalVoiceSnapshots.delete(oldestKey);
  }
}

export function upsertBrowserLocalVoiceSnapshot(
  userId: string,
  clientId: string,
  voices: BrowserLocalVoiceOption[],
): BrowserLocalVoiceSnapshot {
  pruneExpiredBrowserLocalVoiceSnapshots();
  const snapshot: BrowserLocalVoiceSnapshot = {
    userId,
    clientId,
    voices: voices.map((voice) => ({ ...voice })),
    updatedAt: new Date(Date.now()).toISOString(),
  };
  browserLocalVoiceSnapshots.set(buildBrowserLocalVoiceSnapshotKey(userId, clientId), snapshot);
  trimBrowserLocalVoiceSnapshotsToLimit();
  return snapshot;
}

export function getBrowserLocalVoiceSnapshot(userId: string, clientId: string): BrowserLocalVoiceSnapshot | null {
  pruneExpiredBrowserLocalVoiceSnapshots();
  return browserLocalVoiceSnapshots.get(buildBrowserLocalVoiceSnapshotKey(userId, clientId)) ?? null;
}

export function clearBrowserLocalVoiceSnapshots(): void {
  browserLocalVoiceSnapshots.clear();
}

export function buildRemoteVoiceCatalog(providers: LlmProvider[]): RemoteVoiceCatalogEntry[] {
  return providers
    .filter((provider) =>
      provider.isActive
      && provider.modelType === 'audio'
      && provider.apiProtocol === 'openai'
      && ['tts', 'both'].includes(normalizeAudioUsage(provider.audioUsage)),
    )
    .map((provider) => {
      const meta = getVoiceProviderMeta(provider.apiUrl);
      const modelIds = Array.from(
        new Set([
          provider.model,
          ...(meta?.ttsModels ?? []),
        ].filter((value): value is string => !!value)),
      );

      return {
        llmProviderId: provider.id,
        llmProviderName: provider.name,
        apiUrl: provider.apiUrl,
        providerLabel: meta?.label ?? provider.name,
        models: modelIds.map((modelId) => ({
          id: modelId,
          voices: meta?.voices[modelId] ?? [],
        })),
      } satisfies RemoteVoiceCatalogEntry;
    });
}

export function buildSpeechVoiceCatalog(options: {
  audioProviders: LlmProvider[];
  browserLocalSnapshot?: BrowserLocalVoiceSnapshot | null;
}): SpeechVoiceCatalog {
  const snapshot = options.browserLocalSnapshot ?? null;
  return {
    browserLocal: {
      provider: 'browser-local',
      reportedAt: snapshot?.updatedAt ?? null,
      voices: snapshot?.voices ?? [],
    },
    remoteProviders: buildRemoteVoiceCatalog(options.audioProviders),
  };
}
