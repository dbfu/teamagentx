import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createEdgeTtsProvider } from '../../../modules/speech/providers/edge-tts.provider.js';

describe('edge-tts provider', () => {
  test('应调用 edge-tts 命令生成音频并返回 data url', async () => {
    let capturedBinary: string | null = null;
    let capturedArgs: string[] | null = null;
    let cleanedPath: string | null = null;

    const provider = createEdgeTtsProvider({
      edgeTtsBinary: 'edge-tts',
      createTempFile: async () => '/tmp/teamagentx-edge-tts.mp3',
      runEdgeTts: async (binary, args) => {
        capturedBinary = binary;
        capturedArgs = args;
      },
      readAudioFile: async (filePath) => {
        assert.strictEqual(filePath, '/tmp/teamagentx-edge-tts.mp3');
        return Buffer.from([1, 2, 3, 4]);
      },
      cleanupFile: async (filePath) => {
        cleanedPath = filePath;
      },
    });

    const result = await provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'edge-tts',
        voice: 'zh-CN-XiaoxiaoNeural',
        speed: 1.3,
        volume: 1,
      },
      input: {
        text: '你好，边缘语音',
      },
    });

    assert.strictEqual(capturedBinary, 'edge-tts');
    assert.deepStrictEqual(capturedArgs, [
      '--voice',
      'zh-CN-XiaoxiaoNeural',
      '--text',
      '你好，边缘语音',
      '--write-media',
      '/tmp/teamagentx-edge-tts.mp3',
      '--rate',
      '+30%',
      '--volume',
      '+0%',
    ]);
    assert.ok(result);
    assert.strictEqual(result?.kind, 'audio');
    assert.strictEqual(result?.provider, 'edge-tts');
    assert.strictEqual(result?.voice, 'zh-CN-XiaoxiaoNeural');
    assert.strictEqual(result?.mimeType, 'audio/mp3');
    assert.ok(result?.audioBuffer);
    assert.strictEqual(result?.audioBuffer?.toString('base64'), 'AQIDBA==');
    assert.strictEqual(cleanedPath, '/tmp/teamagentx-edge-tts.mp3');
  });

  test('未安装 edge-tts 时应给出明确错误', async () => {
    const provider = createEdgeTtsProvider({
      runEdgeTts: async () => {
        const error = new Error('spawn edge-tts ENOENT') as Error & { code?: string };
        error.code = 'ENOENT';
        throw error;
      },
    });

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: {
          provider: 'edge-tts',
        },
        input: {
          text: '你好',
        },
      }) ?? Promise.reject(new Error('provider missing')),
      /edge-tts 未安装或不可用/,
    );
  });
});
