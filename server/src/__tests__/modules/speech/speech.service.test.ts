import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  SpeechProviderRegistry,
  SpeechRouter,
  SpeechService,
  type SpeechProvider,
  type SpeechTask,
} from '../../../modules/speech/index.js';

function createTtsProvider(options: {
  id: string;
  runtime?: 'client' | 'server';
  onSynthesize?: (task: SpeechTask<{ text: string }>) => Promise<{ provider: string; text: string }>;
}) {
  const runtime = options.runtime ?? 'server';

  const provider: SpeechProvider = {
    id: options.id,
    runtime,
    capabilities: {
      provider: options.id,
      runtime,
      taskTypes: ['tts'],
    },
    async synthesize(task) {
      if (options.onSynthesize) {
        const artifact = await options.onSynthesize(task as SpeechTask<{ text: string }>);
        return {
          kind: 'audio',
          provider: artifact.provider,
          text: artifact.text,
        };
      }

      return {
        kind: 'audio',
        provider: options.id,
        text: String((task.input as { text: string }).text),
      };
    },
  };

  return provider;
}

describe('Speech Service', () => {
  test('registry 应支持注册并按 id 获取 provider', () => {
    const registry = new SpeechProviderRegistry();
    const provider = createTtsProvider({ id: 'remote-tts' });

    registry.register(provider);

    assert.strictEqual(registry.get('remote-tts'), provider);
    assert.deepStrictEqual(
      registry.list().map((item) => item.id),
      ['remote-tts'],
    );
  });

  test('router 应优先选择 profile 指定的 provider', () => {
    const registry = new SpeechProviderRegistry();
    registry.register(createTtsProvider({ id: 'browser-local', runtime: 'client' }));
    registry.register(createTtsProvider({ id: 'remote-tts' }));

    const router = new SpeechRouter(registry);
    const provider = router.route({
      type: 'tts',
      profile: {
        provider: 'remote-tts',
      },
      input: { text: 'hello' },
    });

    assert.strictEqual(provider.id, 'remote-tts');
  });

  test('service 应在首选 provider 失败时回退到 fallback provider', async () => {
    const registry = new SpeechProviderRegistry();
    registry.register(
      createTtsProvider({
        id: 'remote-tts',
        onSynthesize: async () => {
          throw new Error('remote down');
        },
      }),
    );
    registry.register(createTtsProvider({ id: 'browser-local', runtime: 'client' }));

    const router = new SpeechRouter(registry);
    const service = new SpeechService(router);

    const artifact = await service.execute({
      type: 'tts',
      profile: {
        provider: 'remote-tts',
        fallbackProvider: 'browser-local',
      },
      preferences: {
        allowFallback: true,
      },
      input: { text: 'fallback me' },
    });

    assert.ok('kind' in artifact);
    assert.strictEqual(artifact.kind, 'audio');
    assert.strictEqual(artifact.provider, 'browser-local');
    assert.strictEqual(artifact.text, 'fallback me');
  });
});
