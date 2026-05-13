import type { SpeechArtifact, SpeechCapability, SpeechSession, SpeechTask } from '@/speech/domain/types'

export interface SpeechProvider {
  id: string
  runtime: 'client' | 'server'
  capabilities: SpeechCapability
  synthesize?: (task: SpeechTask) => Promise<SpeechArtifact>
  transcribe?: (task: SpeechTask) => Promise<SpeechArtifact>
  openRealtimeSession?: (task: SpeechTask) => Promise<SpeechSession>
}
