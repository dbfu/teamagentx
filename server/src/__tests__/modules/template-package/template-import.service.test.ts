import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplateImportPlan } from '../../../modules/template-package/template-import.service.js';

describe('template import service', () => {
  test('builds import plan using suggested copy name when target name conflicts', () => {
    const plan = buildTemplateImportPlan({
      desiredGroupName: '客服模板',
      preview: {
        conflicts: {
          nameConflict: true,
          suggestedGroupName: '客服模板（导入副本 1）',
        },
        compatibility: {
          resolved: [],
          unresolved: [],
        },
      },
    });

    assert.equal(plan.finalGroupName, '客服模板（导入副本 1）');
    assert.equal(plan.unresolvedCount, 0);
    assert.equal(plan.importAction, 'rename_copy');
  });

  test('keeps the requested name when there is no conflict', () => {
    const plan = buildTemplateImportPlan({
      desiredGroupName: '客服模板',
      preview: {
        conflicts: {
          nameConflict: false,
          suggestedGroupName: '客服模板',
        },
        compatibility: {
          resolved: [],
          unresolved: [],
        },
      },
    });

    assert.equal(plan.finalGroupName, '客服模板');
    assert.equal(plan.importAction, 'create_copy');
  });

  test('counts unresolved capabilities for follow-up configuration', () => {
    const plan = buildTemplateImportPlan({
      desiredGroupName: '客服模板',
      preview: {
        conflicts: {
          nameConflict: false,
          suggestedGroupName: '客服模板',
        },
        compatibility: {
          resolved: [],
          unresolved: [
            {
              agentRef: 'agent-1',
              capabilityType: 'image',
              status: 'requires_user_selection',
            },
            {
              agentRef: 'agent-2',
              capabilityType: 'audio',
              status: 'unsupported_but_importable',
            },
          ],
        },
      },
    });

    assert.equal(plan.finalGroupName, '客服模板');
    assert.equal(plan.unresolvedCount, 1);
  });
});
