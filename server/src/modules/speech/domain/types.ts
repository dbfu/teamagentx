export type SpeechTaskType = 'tts' | 'stt' | 'realtime-chat';

export interface SpeechProfile {
  provider?: string | null;
  model?: string | null;
  voice?: string | null;
  fallbackProvider?: string | null;
  speed?: number | null;
  volume?: number | null;
  pitch?: number | null;
  emotion?: string | null;
  style?: string | null;
  format?: string | null;
  sampleRate?: number | null;
  temperature?: number | null;
  prompt?: string | null;
  vendorOptions?: Record<string, unknown> | null;
}

export interface SpeechTask<TInput = unknown> {
  type: SpeechTaskType;
  profile?: SpeechProfile | null;
  input: TInput;
  context?: {
    chatRoomId?: string;
    agentId?: string;
    messageId?: string;
    source?: 'assistant-auto-speak' | 'assistant-preview' | 'user-recording' | 'system';
  };
  preferences?: {
    preferLocal?: boolean;
    allowFallback?: boolean;
    cacheKey?: string | null;
  };
}

export interface SpeechArtifact {
  kind: 'audio' | 'transcript' | 'session';
  text?: string | null;
  audioBuffer?: Buffer;
  mimeType?: string | null;
  durationMs?: number | null;
  provider: string;
  model?: string | null;
  voice?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpeechSession {
  id: string;
  provider: string;
  status: 'open' | 'active' | 'closing' | 'closed' | 'failed';
  profile?: SpeechProfile | null;
  metadata?: Record<string, unknown> | null;
}

export interface SpeechCapability {
  provider: string;
  runtime: 'client' | 'server';
  taskTypes: SpeechTaskType[];
  formats?: string[];
  sampleRates?: number[];
}
