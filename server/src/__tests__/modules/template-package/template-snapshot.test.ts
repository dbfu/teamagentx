import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplateSnapshot } from '../../../modules/template-package/template-snapshot.js';

describe('template snapshot builder', () => {
  test('strips sensitive environment-bound fields from room and agents', () => {
    const snapshot = buildTemplateSnapshot({
      room: {
        id: 'room-1',
        name: '客服群',
        description: '客服工作流',
        rules: '优先分诊',
        workDir: '/Users/demo/private-workdir',
        defaultAgentId: 'agent-1',
        agentTriggerMode: 'auto',
      },
      agents: [
        {
          id: 'agent-1',
          name: '分诊助手',
        prompt: 'help users',
        type: 'acp',
        acpTool: 'claude',
        categoryId: 'cat-1',
        workDir: '/Users/demo/agent-workdir',
        proxyConfig: 'http://127.0.0.1:7890',
          codexModel: null,
          claudeModel: 'claude-sonnet-4',
          llmProviderId: 'provider-text-1',
          speechConfig: {
            behavior: { enabled: true, outputMode: 'manual', autoPlay: false },
            profile: { provider: 'remote', model: 'tts-1' },
          },
          capabilities: [
            {
              capabilityType: 'image',
              enabled: true,
              llmProviderId: 'provider-image-1',
            },
          ],
        },
      ],
      categories: [],
      cronTasks: [],
    });

    assert.equal(snapshot.room.workDir, null);
    assert.equal(snapshot.agents[0]?.workDir, null);
    assert.equal(snapshot.agents[0]?.proxyConfig, null);
    assert.equal(snapshot.agents[0]?.llmProviderId, null);
    assert.equal(snapshot.agents[0]?.categoryId, 'cat-1');
    assert.equal(snapshot.agents[0]?.capabilities[0]?.llmProviderId, null);
    assert.equal(snapshot.agents[0]?.capabilities[0]?.modelType, 'image');
  });

  test('keeps reusable room and agent metadata', () => {
    const snapshot = buildTemplateSnapshot({
      room: {
        id: 'room-1',
        name: '客服群',
        description: '客服工作流',
        rules: '优先分诊',
        workDir: null,
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
          categoryId: 'cat-1',
          workDir: null,
          proxyConfig: null,
          codexModel: null,
          claudeModel: 'claude-sonnet-4',
          llmProviderId: null,
          speechConfig: null,
          capabilities: [],
        },
      ],
      categories: [{ id: 'cat-1', name: '客服', description: '客服分类', sortOrder: 1 }],
      cronTasks: [{ id: 'cron-1', name: '日报', payload: 'send summary' }],
    });

    assert.equal(snapshot.room.name, '客服群');
    assert.equal(snapshot.room.agentTriggerMode, 'manual');
    assert.equal(snapshot.categories[0]?.name, '客服');
    assert.equal(snapshot.cronTasks[0]?.name, '日报');
    assert.equal(snapshot.agents[0]?.claudeModel, 'claude-sonnet-4');
  });

  test('keeps coordinator trigger mode in room metadata', () => {
    const snapshot = buildTemplateSnapshot({
      room: {
        id: 'room-1',
        name: '协作群',
        description: null,
        rules: null,
        workDir: null,
        defaultAgentId: null,
        agentTriggerMode: 'coordinator',
      },
      agents: [],
      categories: [],
      cronTasks: [],
    });

    assert.equal(snapshot.room.agentTriggerMode, 'coordinator');
  });
});
