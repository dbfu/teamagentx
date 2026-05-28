import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplatePackagePayload } from '../../../modules/template-package/template-export.service.js';

describe('template export service', () => {
  test('builds manifest and snapshot payload from reusable room assets', () => {
    const payload = buildTemplatePackagePayload({
      templateId: 'tpl-customer-support',
      version: '1.0.0',
      title: '客服模板',
      summary: '带分诊和日报',
      sourceType: 'local',
      sourceAuthor: 'user-1',
      room: {
        id: 'room-1',
        name: '客服群',
        description: '客服工作流',
        rules: '优先分诊',
        workDir: '/Users/private/room',
        defaultAgentId: 'agent-1',
        agentTriggerMode: 'manual',
      },
      agents: [
        {
          id: 'agent-1',
          name: '分诊助手',
          prompt: 'help users',
          type: 'acp',
          acpTool: 'claude',
          workDir: '/Users/private/agent',
          proxyConfig: 'http://127.0.0.1:7890',
          codexModel: null,
          claudeModel: 'claude-sonnet-4',
          thinkingMode: 'high',
          llmProviderId: 'provider-1',
          speechConfig: null,
          capabilities: [],
        },
      ],
      categories: [{ id: 'cat-1', name: '客服', description: '客服分类', sortOrder: 1 }],
      cronTasks: [{
        id: 'cron-1',
        name: '日报',
        description: '每天晨报',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        intervalMinutes: null,
        scheduledAt: null,
        payload: 'send summary',
        agentIds: ['agent-1'],
        enabled: true,
        maxRetries: 3,
      }],
    });

    assert.equal(payload.manifest.templateId, 'tpl-customer-support');
    assert.equal(payload.manifest.contents.agents, 1);
    assert.equal(payload.manifest.contents.categories, 1);
    assert.equal(payload.snapshot.room.workDir, null);
    assert.equal(payload.snapshot.agents[0]?.proxyConfig, null);
    assert.equal(payload.capabilityDescriptors.length, 1);
    assert.equal(payload.capabilityDescriptors[0]?.capabilityType, 'text');
    assert.equal(payload.skills.length, 0);
    assert.equal(payload.skillUsages.length, 0);
    assert.equal(payload.snapshot.cronTasks[0]?.scheduleType, 'cron');
    assert.equal(payload.snapshot.cronTasks[0]?.cronExpression, '0 9 * * *');
    assert.deepEqual(payload.snapshot.cronTasks[0]?.agentIds, ['agent-1']);
    assert.equal(payload.snapshot.cronTasks[0]?.enabled, true);
  });

  test('omits skills and cron tasks when export options disable them', () => {
    const payload = buildTemplatePackagePayload({
      templateId: 'tpl-lean-export',
      version: '1.0.0',
      title: '轻量模板',
      sourceType: 'local',
      room: {
        id: 'room-1',
        name: '客服群',
        description: null,
        rules: null,
        workDir: '/Users/private/room',
        defaultAgentId: null,
        agentTriggerMode: 'auto',
      },
      agents: [
        {
          id: 'agent-1',
          name: '分诊助手',
          prompt: 'help users',
          type: 'acp',
          acpTool: 'claude',
          workDir: '/Users/private/agent',
          proxyConfig: null,
          codexModel: null,
          claudeModel: 'claude-sonnet-4',
          thinkingMode: 'high',
          llmProviderId: 'provider-1',
          speechConfig: null,
          capabilities: [],
        },
      ],
      categories: [],
      cronTasks: [{
        id: 'cron-1',
        name: '日报',
        description: null,
        scheduleType: 'once',
        cronExpression: null,
        intervalMinutes: null,
        scheduledAt: '2026-05-26T09:00:00.000Z',
        payload: 'send summary',
        agentIds: [],
        enabled: false,
        maxRetries: 3,
      }],
      skills: [{
        slug: 'browser-use',
        name: 'Browser Use',
        description: 'Test',
        files: [{ path: 'SKILL.md', content: Buffer.from('body') }],
        origin: null,
      }],
      skillUsages: [{ agentId: 'agent-1', slug: 'browser-use' }],
      includeSkills: false,
      includeCronTasks: false,
    });

    assert.equal(payload.manifest.contents.skills, 0);
    assert.equal(payload.manifest.contents.cronTasks, 0);
    assert.equal(payload.snapshot.cronTasks.length, 0);
    assert.equal(payload.skills.length, 0);
    assert.equal(payload.skillUsages.length, 0);
  });

  test('does not emit audio capability descriptors for browser-local speech preferences', () => {
    const payload = buildTemplatePackagePayload({
      templateId: 'tpl-browser-local-voice',
      version: '1.0.0',
      title: '本地播报模板',
      sourceType: 'local',
      room: {
        id: 'room-1',
        name: '客服群',
        description: null,
        rules: null,
        workDir: null,
        defaultAgentId: null,
        agentTriggerMode: 'auto',
      },
      agents: [
        {
          id: 'agent-1',
          name: '播报助手',
          prompt: 'read updates',
          type: 'builtin',
          acpTool: null,
          workDir: null,
          proxyConfig: null,
          codexModel: null,
          claudeModel: null,
          thinkingMode: 'high',
          llmProviderId: null,
          speechConfig: {
            behavior: {
              enabled: true,
              outputMode: 'manual',
              autoPlay: false,
            },
            profile: {
              provider: 'browser-local',
              model: null,
              voice: null,
              fallbackProvider: null,
              speed: 1.3,
              volume: 0.95,
              pitch: 0.9,
              emotion: 'serious',
              style: 'professional',
              format: null,
              sampleRate: null,
              temperature: null,
              prompt: '语气沉稳、表达清晰。',
              vendorOptions: null,
            },
            sttProfile: null,
          },
          capabilities: [],
        },
      ],
      categories: [],
      cronTasks: [],
    });

    assert.deepStrictEqual(
      payload.capabilityDescriptors.map((item) => item.capabilityType),
      ['text'],
    );
  });

  test('keeps audio capability descriptors for remote speech providers', () => {
    const payload = buildTemplatePackagePayload({
      templateId: 'tpl-remote-voice',
      version: '1.0.0',
      title: '远程语音模板',
      sourceType: 'local',
      room: {
        id: 'room-1',
        name: '客服群',
        description: null,
        rules: null,
        workDir: null,
        defaultAgentId: null,
        agentTriggerMode: 'auto',
      },
      agents: [
        {
          id: 'agent-1',
          name: '播报助手',
          prompt: 'read updates',
          type: 'builtin',
          acpTool: null,
          workDir: null,
          proxyConfig: null,
          codexModel: null,
          claudeModel: null,
          thinkingMode: 'high',
          llmProviderId: null,
          speechConfig: {
            behavior: {
              enabled: true,
              outputMode: 'manual',
              autoPlay: false,
            },
            profile: {
              provider: 'openai-compatible-tts',
              model: 'gpt-4o-mini-tts',
              voice: 'alloy',
              fallbackProvider: null,
              speed: 1.1,
              volume: 1,
              pitch: null,
              emotion: null,
              style: null,
              format: 'mp3',
              sampleRate: 24000,
              temperature: null,
              prompt: null,
              vendorOptions: { llmProviderId: 'provider-audio-1' },
            },
            sttProfile: null,
          },
          capabilities: [],
        },
      ],
      categories: [],
      cronTasks: [],
    });

    assert.deepStrictEqual(
      payload.capabilityDescriptors.map((item) => item.capabilityType),
      ['text', 'audio'],
    );
  });
});
