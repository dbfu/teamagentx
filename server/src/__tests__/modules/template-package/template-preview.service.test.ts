import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { previewTemplatePackage } from '../../../modules/template-package/template-preview.service.js';

describe('template preview service', () => {
  test('returns manifest summary, duplicate status, and capability mapping results', () => {
    const result = previewTemplatePackage({
      manifestInput: {
        schemaVersion: '1.0',
        templateId: 'tpl-demo',
        version: '1.0.0',
        title: '客服模板',
        source: { type: 'local' },
        contents: {
          group: true,
          agents: 2,
          categories: 1,
          skills: 3,
          cronTasks: 1,
        },
      },
      desiredGroupName: '客服模板',
      existingImports: [{ templateId: 'tpl-demo', version: '1.0.0' }],
      existingGroupNames: ['客服模板'],
      capabilityDescriptors: [
        {
          agentRef: 'agent-1',
          capabilityType: 'text',
          required: true,
          tool: 'claude',
          providerProtocol: 'anthropic',
          modelType: 'text',
        },
        {
          agentRef: 'agent-2',
          capabilityType: 'image',
          required: true,
          providerProtocol: 'openai',
          modelType: 'image',
        },
      ],
      degradedSkills: [
        {
          slug: 'broken-skill',
          reason: 'SKILL.md not found',
        },
      ],
      localProviders: [
        {
          id: 'provider-1',
          name: 'Claude Sonnet',
          modelType: 'text',
          apiProtocol: 'anthropic',
        },
      ],
    });

    assert.equal(result.manifest.title, '客服模板');
    assert.equal(result.summary.groupName, '客服模板');
    assert.equal(result.summary.skills, 3);
    assert.equal(result.conflicts.duplicateTemplate, true);
    assert.equal(result.conflicts.suggestedGroupName, '客服模板（导入副本 1）');
    assert.equal(result.compatibility.resolved.length, 1);
    assert.equal(result.compatibility.unresolved.length, 1);
    assert.deepStrictEqual(result.degradedSkills, [{ slug: 'broken-skill', reason: 'SKILL.md not found' }]);
  });
});
