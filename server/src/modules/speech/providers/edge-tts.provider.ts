import { execFile as nodeExecFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../../../config/index.js';
import type { SpeechProvider } from '../domain/provider.js';
import type { SpeechArtifact, SpeechTask } from '../domain/types.js';

const execFileAsync = promisify(nodeExecFile);

type EdgeTtsDependencies = {
  edgeTtsBinary?: string;
  defaultVoice?: string;
  providerId?: string;
  createTempFile?: () => Promise<string>;
  runEdgeTts?: (binary: string, args: string[]) => Promise<void>;
  readAudioFile?: (filePath: string) => Promise<Buffer>;
  cleanupFile?: (filePath: string) => Promise<void>;
};

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function formatSignedValue(value: number, suffix: string): string {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

function toRateArg(speed?: number | null): string | null {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
    return null;
  }
  return formatSignedValue(Math.round((speed - 1) * 100), '%');
}

function toVolumeArg(volume?: number | null): string | null {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) {
    return null;
  }
  return formatSignedValue(Math.round((volume - 1) * 100), '%');
}

function toPitchArg(pitch?: number | null): string | null {
  if (typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch <= 0) {
    return null;
  }
  return formatSignedValue(Math.round((pitch - 1) * 50), 'Hz');
}

async function defaultCreateTempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'teamagentx-edge-tts-'));
  return join(dir, 'speech.mp3');
}

async function defaultRunEdgeTts(binary: string, args: string[]): Promise<void> {
  await execFileAsync(binary, args);
}

async function defaultCleanupFile(filePath: string): Promise<void> {
  await rm(dirname(filePath), { recursive: true, force: true });
}

export function createEdgeTtsProvider(dependencies: EdgeTtsDependencies = {}): SpeechProvider {
  const providerId = dependencies.providerId ?? 'edge-tts';
  const edgeTtsBinary = dependencies.edgeTtsBinary ?? config.speech.edgeTtsBinary;
  const defaultVoice = dependencies.defaultVoice ?? config.speech.edgeTtsDefaultVoice;
  const createTempFile = dependencies.createTempFile ?? defaultCreateTempFile;
  const runEdgeTts = dependencies.runEdgeTts ?? defaultRunEdgeTts;
  const readAudioFile = dependencies.readAudioFile ?? readFile;
  const cleanupFile = dependencies.cleanupFile ?? defaultCleanupFile;

  return {
    id: providerId,
    runtime: 'server',
    capabilities: {
      provider: providerId,
      runtime: 'server',
      taskTypes: ['tts'],
      formats: ['mp3'],
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

      const outputPath = await createTempFile();
      const voice = task.profile?.voice?.trim() || defaultVoice;
      const args = [
        '--voice',
        voice,
        '--text',
        text,
        '--write-media',
        outputPath,
      ];

      const rateArg = toRateArg(task.profile?.speed);
      const volumeArg = toVolumeArg(task.profile?.volume);
      const pitchArg = toPitchArg(task.profile?.pitch);
      if (rateArg) {
        args.push('--rate', rateArg);
      }
      if (volumeArg) {
        args.push('--volume', volumeArg);
      }
      if (pitchArg) {
        args.push('--pitch', pitchArg);
      }

      try {
        await runEdgeTts(edgeTtsBinary, args);
        const bytes = await readAudioFile(outputPath);
        return {
          kind: 'audio',
          provider: providerId,
          text,
          audioUrl: toDataUrl(bytes, 'audio/mpeg'),
          mimeType: 'audio/mpeg',
          voice,
          metadata: {
            runtime: 'server',
            transport: 'edge-tts',
          },
        } satisfies SpeechArtifact;
      } catch (error) {
        const commandError = error as Error & { code?: string };
        if (commandError?.code === 'ENOENT') {
          throw new Error('edge-tts 未安装或不可用，请先在服务端环境安装 edge-tts');
        }
        throw error;
      } finally {
        await cleanupFile(outputPath).catch(() => undefined);
      }
    },
  };
}
