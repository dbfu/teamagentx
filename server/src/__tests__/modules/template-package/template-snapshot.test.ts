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
        envVars: JSON.stringify([
          { key: 'CUSTOMER_API_TOKEN', value: 'secret-token', description: '客服 API Token' },
        ]),
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
          thinkingMode: 'high',
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
    assert.deepEqual(JSON.parse(snapshot.room.envVars ?? '[]'), [
      { key: 'CUSTOMER_API_TOKEN', value: '', description: '客服 API Token' },
    ]);
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
        avatar: 'data:image/png;base64,ROOM',
        avatarColor: '#2563eb',
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
          thinkingMode: 'high',
          llmProviderId: null,
          speechConfig: null,
          avatar: '7',
          avatarColor: '#f97316',
          capabilities: [],
        },
      ],
      categories: [{ id: 'cat-1', name: '客服', description: '客服分类', sortOrder: 1 }],
      cronTasks: [{
        id: 'cron-1',
        name: '日报',
        description: '每天推送日报',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        intervalMinutes: null,
        scheduledAt: null,
        payload: 'send summary',
        agentIds: ['agent-1'],
        enabled: true,
        maxRetries: 5,
      }],
      commands: [
        {
          id: 'cmd-1',
          name: '初始化项目',
          content: '/初始化项目\n请检查当前仓库并给出启动建议',
          sortOrder: 1,
        },
      ],
    });

    assert.equal(snapshot.room.name, '客服群');
    assert.equal(snapshot.room.agentTriggerMode, 'manual');
    assert.equal(snapshot.categories[0]?.name, '客服');
    assert.equal(snapshot.cronTasks[0]?.name, '日报');
    assert.equal(snapshot.cronTasks[0]?.scheduleType, 'cron');
    assert.equal(snapshot.cronTasks[0]?.cronExpression, '0 9 * * *');
    assert.deepEqual(snapshot.cronTasks[0]?.agentIds, ['agent-1']);
    assert.equal(snapshot.cronTasks[0]?.enabled, true);
    assert.equal(snapshot.agents[0]?.claudeModel, 'claude-sonnet-4');
    assert.equal(snapshot.room.avatar, 'data:image/png;base64,ROOM');
    assert.equal(snapshot.room.avatarColor, '#2563eb');
    assert.equal(snapshot.agents[0]?.avatar, '7');
    assert.equal(snapshot.agents[0]?.avatarColor, '#f97316');
    assert.deepEqual(snapshot.commands, [
      {
        id: 'cmd-1',
        name: '初始化项目',
        content: '/初始化项目\n请检查当前仓库并给出启动建议',
        sortOrder: 1,
      },
    ]);
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
