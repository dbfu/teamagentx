import { execFile as nodeExecFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../../../config/index.js';
import type { SpeechProvider } from '../domain/provider.js';
import type { SpeechArtifact, SpeechTask } from '../domain/types.js';
import { SpeechConfigError } from '../speech.service.js';

const execFileAsync = promisify(nodeExecFile);

const VOICE_PATTERN = /^[A-Za-z0-9,\- ]+$/;
const MAX_TEXT_LENGTH = 5000;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

type EdgeTtsDependencies = {
  edgeTtsBinary?: string;
  defaultVoice?: string;
  providerId?: string;
  createTempFile?: () => Promise<string>;
  runEdgeTts?: (binary: string, args: string[]) => Promise<void>;
  readAudioFile?: (filePath: string) => Promise<Buffer>;
  cleanupFile?: (filePath: string) => Promise<void>;
};

function formatSignedValue(value: number, suffix: string): string {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

function toRateArg(speed?: number | null): string | null {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return null;
  }
  // 注意：edge-tts 不接受负值过大的 rate；speed=0 会得到 -100%。
  // clamp 到 [0.1, 3]，避免生成不被支持的极端参数。
  const clamped = Math.max(0.1, Math.min(speed, 3));
  return formatSignedValue(Math.round((clamped - 1) * 100), '%');
}

function toVolumeArg(volume?: number | null): string | null {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) {
    return null;
  }
  return formatSignedValue(Math.round((volume - 1) * 100), '%');
}

function toPitchArg(pitch?: number | null): string | null {
  if (pitch === null || pitch === undefined) {
    return null;
  }
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) {
    return null;
  }
  return formatSignedValue(Math.round((pitch - 1) * 50), 'Hz');
}

async function defaultCreateTempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'teamagentx-edge-tts-'));
  return join(dir, 'speech.mp3');
}

async function defaultRunEdgeTts(binary: string, args: string[]): Promise<void> {
  await execFileAsync(binary, args, { timeout: 30000 });
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
      const rawText = String((task.input as { text?: string }).text || '').trim();
      const text = rawText.replace(CONTROL_CHAR_PATTERN, '');
      if (!text) {
        return {
          kind: 'audio',
          provider: providerId,
          text: '',
        };
      }
      if (text.length > MAX_TEXT_LENGTH) {
        throw new SpeechConfigError(
          `edge-tts text 长度超过限制（${text.length} > ${MAX_TEXT_LENGTH}）`,
        );
      }

      const voice = task.profile?.voice?.trim() || defaultVoice;
      if (!VOICE_PATTERN.test(voice)) {
        throw new SpeechConfigError('edge-tts voice 参数包含非法字符');
      }
      let outputPath: string | null = null;
      try {
        outputPath = await createTempFile();
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
          const audioBuffer = await readAudioFile(outputPath);
          return {
            kind: 'audio',
            provider: providerId,
            text,
            audioBuffer,
            mimeType: 'audio/mp3',
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
        }
      } finally {
        if (outputPath) {
          await cleanupFile(outputPath).catch((e) =>
            console.warn('[edge-tts] 清理临时文件失败:', e),
          );
        }
      }
    },
  };
}
