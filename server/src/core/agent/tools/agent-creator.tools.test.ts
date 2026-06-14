import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import prisma from '../../../lib/prisma.js';
import { agentCreatorTools, createAgentCreatorTools } from './agent-creator.tools.js';
import { getSharedSkillsDir } from '../../../modules/skill/preinstalled-skills.js';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';
import {
  clearBrowserLocalVoiceSnapshots,
  upsertBrowserLocalVoiceSnapshot,
} from '../../../modules/speech/voice-catalog.js';
import { executorCache } from '../agent-handler/cache.js';

function getTool(name: string): { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> } {
  const tool = agentCreatorTools.find((item) => item.name === name);
  assert.ok(tool, `missing tool ${name}`);
  return tool as unknown as { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> };
}

function writeSharedSkill(slug: string, name: string, description: string): void {
  const skillDir = path.join(getSharedSkillsDir(), slug);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody should not be used for matching.\n`,
    'utf-8',
  );
}

test.beforeEach(async () => {
  await prisma.chatRoom.deleteMany({
    where: {
      name: {
        startsWith: 'Agent Creator Tool Test',
      },
    },
  });
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
  executorCache.clear();
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

test('room-aware update_agent updates current room group history access', async () => {
  const agent = await prisma.agent.create({
    data: {
      name: 'Agent Creator Tool Test Room History Agent',
      prompt: 'test prompt',
    },
  });
  const chatRoom = await prisma.chatRoom.create({
    data: {
      id: 'agent-creator-tool-test-room-history',
      name: 'Agent Creator Tool Test Room History',
      updatedAt: new Date(),
    },
  });
  await prisma.chatRoomAgent.create({
    data: {
      id: 'agent-creator-tool-test-room-history-member',
      chatRoomId: chatRoom.id,
      agentId: agent.id,
      role: 'MEMBER',
      injectGroupHistory: false,
    },
  });

  const tool = createAgentCreatorTools(chatRoom.id).find((item) => item.name === 'update_agent') as
    | { invoke: (input: Record<string, unknown>) => Promise<unknown> }
    | undefined;
  assert.ok(tool);
  const result = await tool.invoke({
    agentId: agent.id,
    injectGroupHistory: true,
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.roomSettings, {
    chatRoomId: chatRoom.id,
    injectGroupHistory: true,
  });

  const roomAgent = await prisma.chatRoomAgent.findUnique({
    where: {
      chatRoomId_agentId: {
        chatRoomId: chatRoom.id,
        agentId: agent.id,
      },
    },
  });

  assert.equal(roomAgent?.injectGroupHistory, true);
});

test('update_agent clears cached executors after prompt update', async () => {
  const agent = await prisma.agent.create({
    data: {
      name: 'Agent Creator Tool Test Prompt Cache',
      prompt: 'old prompt',
    },
  });
  executorCache.set(`room-a_${agent.name}`, {} as never);
  executorCache.set(`room-b_${agent.name}_session`, {} as never);

  const result = await getTool('update_agent').invoke({
    agentId: agent.id,
    prompt: 'new prompt',
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.equal(executorCache.size, 0);
  const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
  assert.equal(updatedAgent?.prompt, 'new prompt');
});

test('update_agents clears cached executors after prompt updates', async () => {
  const firstAgent = await prisma.agent.create({
    data: {
      name: 'Agent Creator Tool Test Batch Prompt Cache A',
      prompt: 'old prompt A',
    },
  });
  const secondAgent = await prisma.agent.create({
    data: {
      name: 'Agent Creator Tool Test Batch Prompt Cache B',
      prompt: 'old prompt B',
    },
  });
  executorCache.set(`room-a_${firstAgent.name}`, {} as never);
  executorCache.set(`room-b_${secondAgent.name}`, {} as never);

  const result = await getTool('update_agents').invoke({
    agents: [
      { agentId: firstAgent.id, prompt: 'new prompt A' },
      { agentId: secondAgent.id, prompt: 'new prompt B' },
    ],
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.equal(executorCache.size, 0);
});

test('room-aware create_agent adds new agent to current room with group history access', async () => {
  const chatRoom = await prisma.chatRoom.create({
    data: {
      id: 'agent-creator-tool-test-create-room-history',
      name: 'Agent Creator Tool Test Create Room History',
      updatedAt: new Date(),
    },
  });

  const tool = createAgentCreatorTools(chatRoom.id).find((item) => item.name === 'create_agent') as
    | { invoke: (input: Record<string, unknown>) => Promise<unknown> }
    | undefined;
  assert.ok(tool);
  const result = await tool.invoke({
    name: 'Agent Creator Tool Test Create Room History Agent',
    description: 'test description',
    prompt: 'test prompt',
    injectGroupHistory: true,
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.roomMembership, {
    chatRoomId: chatRoom.id,
    injectGroupHistory: true,
  });

  const roomAgent = await prisma.chatRoomAgent.findUnique({
    where: {
      chatRoomId_agentId: {
        chatRoomId: chatRoom.id,
        agentId: parsed.agent.id,
      },
    },
  });

  assert.equal(roomAgent?.injectGroupHistory, true);
  const createdAgent = await prisma.agent.findUnique({
    where: { id: parsed.agent.id },
  });
  assert.match(createdAgent?.avatar ?? '', /^\d+$/);
  assert.ok(Number(createdAgent?.avatar) >= 1 && Number(createdAgent?.avatar) < 30);
  assert.equal(createdAgent?.avatarColor, null);
});

test('create_llm_provider supports image model configuration fields', async () => {
  const result = await getTool('create_llm_provider').invoke({
    name: 'Agent Creator Tool Test Image Provider',
    modelType: 'image',
    apiProtocol: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-image-1',
    imageProvider: 'openai',
    imageApiType: 'sync',
    isActive: true,
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.equal(parsed.provider.modelType, 'image');
  assert.equal(parsed.provider.imageProvider, 'openai');
  assert.equal(parsed.provider.imageApiType, 'sync');

  const provider = await prisma.llmProvider.findUnique({
    where: { name: 'Agent Creator Tool Test Image Provider' },
  });

  assert.equal(provider?.modelType, 'image');
  assert.equal(provider?.imageProvider, 'openai');
  assert.equal(provider?.imageApiType, 'sync');
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

test('create_agent installs shared skills selected by the model', async () => {
  writeSharedSkill(
    'web-qa',
    'web-qa',
    'Automates web testing, browser interactions, screenshots, and form checks.',
  );
  writeSharedSkill(
    'image-pipeline',
    'image-pipeline',
    'Generates reusable image files through image generation APIs.',
  );

  const result = await getTool('create_agent').invoke({
    name: 'Agent Creator Tool Test Web QA',
    description: 'Handles web testing and screenshot verification for frontend QA.',
    prompt: 'You verify frontend behavior.',
    type: 'acp',
    acpTool: 'claude',
    autoInstallSkillNames: ['web-qa'],
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.modelSelectedSkills, ['web-qa']);
  assert.deepEqual(parsed.skippedModelSelectedSkills, []);

  const skillsDir = skillInstallService.getAgentSkillsDir({
    id: parsed.agent.id,
    type: 'acp',
    workDir: null,
  });

  assert.equal(fs.existsSync(path.join(skillsDir, 'web-qa', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(skillsDir, 'image-pipeline', 'SKILL.md')), false);
});

test('create_agent does not install shared skills unless the model selects them', async () => {
  writeSharedSkill(
    'browser-audit',
    'browser-audit',
    'Audits browser workflows and screenshot based frontend behavior.',
  );

  const result = await getTool('create_agent').invoke({
    name: 'Agent Creator Tool Test No Skill Selection',
    description: 'Handles browser audit workflows.',
    prompt: 'You audit frontend behavior.',
    type: 'acp',
    acpTool: 'claude',
  });
  const parsed = JSON.parse(String(result));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.modelSelectedSkills, []);

  const skillsDir = skillInstallService.getAgentSkillsDir({
    id: parsed.agent.id,
    type: 'acp',
    workDir: null,
  });

  assert.equal(fs.existsSync(path.join(skillsDir, 'browser-audit', 'SKILL.md')), false);
});
