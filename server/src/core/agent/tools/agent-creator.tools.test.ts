import test from 'node:test';
import assert from 'node:assert/strict';

import prisma from '../../../lib/prisma.js';
import { agentCreatorTools } from './agent-creator.tools.js';
import {
  clearBrowserLocalVoiceSnapshots,
  upsertBrowserLocalVoiceSnapshot,
} from '../../../modules/speech/voice-catalog.js';

function getTool(name: string): { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> } {
  const tool = agentCreatorTools.find((item) => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool as unknown as { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> };
}

test.beforeEach(async () => {
  await prisma.agent.deleteMany({
    where: {
      name: {
        startsWith: 'Agent Creator Tool Test',
      },
    },
  });
  await prisma.agentCategory.deleteMany({
    where: {
      name: {
        startsWith: 'Agent Creator Tool Test',
      },
    },
  });
  await prisma.llmProvider.deleteMany({
    where: {
      name: {
        startsWith: 'Agent Creator Tool Test',
      },
    },
  });
  clearBrowserLocalVoiceSnapshots();
});

test('list_agents returns category name and categoryId', async () => {
  const category = await prisma.agentCategory.create({
    data: {
      name: 'Agent Creator Tool Test Category',
      description: 'test category',
    },
  });

  await prisma.agent.create({
    data: {
      name: 'Agent Creator Tool Test Agent',
      prompt: 'test prompt',
      categoryId: category.id,
    },
  });

  const result = await getTool('list_agents').invoke({});
  const text = String(result);

  assert.match(text, /分类ID:/);
  assert.match(text, new RegExp(`分类ID: ${category.id}`));
  assert.match(text, /分类名称:/);
  assert.match(text, /分类名称: Agent Creator Tool Test Category/);
});

test('list_categories returns category ids and names', async () => {
  const category = await prisma.agentCategory.create({
    data: {
      name: 'Agent Creator Tool Test Audit',
      description: 'audit category',
    },
  });

  const result = await getTool('list_categories').invoke({});
  const text = String(result);

  assert.match(text, new RegExp(`ID: ${category.id}`));
  assert.match(text, /名称: Agent Creator Tool Test Audit/);
});

test('list_voice_catalog returns browser-local and remote voice catalog', async () => {
  upsertBrowserLocalVoiceSnapshot('tool-test-user', 'client-a', [
    {
      id: 'com.apple.voice.compact.zh-CN.Tingting',
      name: 'Tingting',
      lang: 'zh-CN',
      voiceURI: 'com.apple.voice.compact.zh-CN.Tingting',
      default: true,
    },
  ]);

  await prisma.llmProvider.create({
    data: {
      name: 'Agent Creator Tool Test Audio',
      type: 'custom',
      modelType: 'audio',
      apiProtocol: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      model: 'gpt-4o-mini-tts',
      audioUsage: 'tts',
      isActive: true,
    },
  });

  const result = await getTool('list_voice_catalog').invoke({});
  const text = String(result);

  assert.match(text, /本地音色（browser-local/);
  assert.doesNotMatch(text, /Tingting/);
  assert.match(text, /当前浏览器\/设备绑定|当前客户端/);
  assert.match(text, /远程音色目录/);
  assert.match(text, /Agent Creator Tool Test Audio/);
  assert.match(text, /profile\.provider = openai-compatible-tts/);
  assert.match(text, /gpt-4o-mini-tts/);
  assert.match(text, /alloy/);
});
