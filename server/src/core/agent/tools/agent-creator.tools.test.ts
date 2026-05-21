import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

import prisma from '../../../lib/prisma.js';
import { agentCreatorTools } from './agent-creator.tools.js';
import { getSharedSkillsDir } from '../../../modules/skill/preinstalled-skills.js';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';
import {
  clearBrowserLocalVoiceSnapshots,
  upsertBrowserLocalVoiceSnapshot,
} from '../../../modules/speech/voice-catalog.js';

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
