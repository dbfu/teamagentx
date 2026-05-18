import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createEdgeTtsProvider } from '../../../modules/speech/providers/edge-tts.provider.js';

describe('edge-tts provider', () => {
  test('应调用 edge-tts 命令生成音频并返回 data url', async () => {
    let capturedBinary: string | null = null;
    let capturedArgs: string[] | null = null as string[] | null;
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

  describe('voice 注入防护', () => {
    function makeProvider() {
      return createEdgeTtsProvider({
        edgeTtsBinary: 'edge-tts',
        createTempFile: async () => '/tmp/x.mp3',
        runEdgeTts: async () => {},
        readAudioFile: async () => Buffer.from([0]),
        cleanupFile: async () => {},
      });
    }

    test('包含分号的 voice 应被拒绝', async () => {
      const provider = makeProvider();
      await assert.rejects(
        provider.synthesize?.({
          type: 'tts',
          profile: { provider: 'edge-tts', voice: 'zh-CN; rm -rf /' },
          input: { text: '你好' },
        }) ?? Promise.reject(new Error('missing')),
        /非法/,
      );
    });

    test('包含换行的 voice 应被拒绝', async () => {
      const provider = makeProvider();
      await assert.rejects(
        provider.synthesize?.({
          type: 'tts',
          profile: {
            provider: 'edge-tts',
            voice: 'zh-CN XiaoxiaoNeural\nContent-Type: text/html',
          },
          input: { text: '你好' },
        }) ?? Promise.reject(new Error('missing')),
        /非法/,
      );
    });

    test('空字符串 voice 应回退到默认 voice（合法）', async () => {
      // 空 voice trim 后为空字符串，会回退到 defaultVoice。
      // 这里显式传 defaultVoice 为非法值时应拒绝。
      const provider = createEdgeTtsProvider({
        edgeTtsBinary: 'edge-tts',
        defaultVoice: 'bad;voice',
        createTempFile: async () => '/tmp/x.mp3',
        runEdgeTts: async () => {},
        readAudioFile: async () => Buffer.from([0]),
        cleanupFile: async () => {},
      });
      await assert.rejects(
        provider.synthesize?.({
          type: 'tts',
          profile: { provider: 'edge-tts', voice: '' },
          input: { text: '你好' },
        }) ?? Promise.reject(new Error('missing')),
        /非法/,
      );
    });
  });

  test('text 超过 5000 字符应抛出 SpeechConfigError', async () => {
    const provider = createEdgeTtsProvider({
      edgeTtsBinary: 'edge-tts',
      createTempFile: async () => '/tmp/x.mp3',
      runEdgeTts: async () => {},
      readAudioFile: async () => Buffer.from([0]),
      cleanupFile: async () => {},
    });

    const longText = 'a'.repeat(5001);
    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' },
        input: { text: longText },
      }) ?? Promise.reject(new Error('missing')),
      /长度超过限制/,
    );
  });

  test('text 中的控制字符应被剥离', async () => {
    let capturedArgs: string[] | null = null as string[] | null;
    const provider = createEdgeTtsProvider({
      edgeTtsBinary: 'edge-tts',
      createTempFile: async () => '/tmp/x.mp3',
      runEdgeTts: async (_binary, args) => {
        capturedArgs = args;
      },
      readAudioFile: async () => Buffer.from([0]),
      cleanupFile: async () => {},
    });

    await provider.synthesize?.({
      type: 'tts',
      profile: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' },
      input: { text: '你好\x00世界\x01' },
    });

    assert.ok(capturedArgs);
    const textIdx = capturedArgs!.indexOf('--text');
    assert.strictEqual(capturedArgs![textIdx + 1], '你好世界');
  });

  describe('speed clamp', () => {
    async function captureRate(speed: number | undefined | null): Promise<string | null> {
      let capturedArgs: string[] | null = null as string[] | null;
      const provider = createEdgeTtsProvider({
        edgeTtsBinary: 'edge-tts',
        createTempFile: async () => '/tmp/x.mp3',
        runEdgeTts: async (_binary, args) => {
          capturedArgs = args;
        },
        readAudioFile: async () => Buffer.from([0]),
        cleanupFile: async () => {},
      });

      await provider.synthesize?.({
        type: 'tts',
        profile: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural', speed: speed ?? undefined },
        input: { text: '你好' },
      });

      assert.ok(capturedArgs);
      const idx = capturedArgs!.indexOf('--rate');
      return idx === -1 ? null : capturedArgs![idx + 1];
    }

    test('speed=0 应 clamp 到 0.1 → -90%', async () => {
      assert.strictEqual(await captureRate(0), '-90%');
    });

    test('speed=NaN 应不输出 --rate', async () => {
      assert.strictEqual(await captureRate(NaN), null);
    });

    test('speed=10 应 clamp 到 3x → +200%', async () => {
      assert.strictEqual(await captureRate(10), '+200%');
    });

    test('speed=1.3 → +30%', async () => {
      assert.strictEqual(await captureRate(1.3), '+30%');
    });
  });

  test('runEdgeTts 抛错时仍应清理临时文件', async () => {
    let cleanedPath: string | null = null;
    const provider = createEdgeTtsProvider({
      edgeTtsBinary: 'edge-tts',
      createTempFile: async () => '/tmp/teamagentx-edge-tts-err.mp3',
      runEdgeTts: async () => {
        throw new Error('boom');
      },
      readAudioFile: async () => Buffer.from([0]),
      cleanupFile: async (filePath) => {
        cleanedPath = filePath;
      },
    });

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' },
        input: { text: '你好' },
      }) ?? Promise.reject(new Error('missing')),
      /boom/,
    );

    assert.strictEqual(cleanedPath, '/tmp/teamagentx-edge-tts-err.mp3');
  });

  test('createTempFile 抛错时不应调用 cleanupFile', async () => {
    let cleanupCalled = false;
    const provider = createEdgeTtsProvider({
      edgeTtsBinary: 'edge-tts',
      createTempFile: async () => {
        throw new Error('mkdtemp failed');
      },
      runEdgeTts: async () => {},
      readAudioFile: async () => Buffer.from([0]),
      cleanupFile: async () => {
        cleanupCalled = true;
      },
    });

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: { provider: 'edge-tts', voice: 'zh-CN-XiaoxiaoNeural' },
        input: { text: '你好' },
      }) ?? Promise.reject(new Error('missing')),
      /mkdtemp failed/,
    );

    assert.strictEqual(cleanupCalled, false);
  });
});
