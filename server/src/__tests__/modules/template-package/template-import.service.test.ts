import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTemplateImportPlan } from '../../../modules/template-package/template-import.service.js';

describe('template import service', () => {
  test('builds import plan using suggested copy name when duplicate action is rename_copy', () => {
    const plan = buildTemplateImportPlan({
      desiredGroupName: '客服模板',
      duplicateAction: 'rename_copy',
      preview: {
        conflicts: {
          duplicateTemplate: true,
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
  });

  test('rejects import when duplicate action is cancel', () => {
    assert.throws(
      () => buildTemplateImportPlan({
        desiredGroupName: '客服模板',
        duplicateAction: 'cancel',
        preview: {
          conflicts: {
            duplicateTemplate: true,
            suggestedGroupName: '客服模板（导入副本 1）',
          },
          compatibility: {
            resolved: [],
            unresolved: [],
          },
        },
      }),
      /用户取消了导入操作/,
    );
  });

  test('counts unresolved capabilities for follow-up configuration', () => {
    const plan = buildTemplateImportPlan({
      desiredGroupName: '客服模板',
      duplicateAction: 'create_copy',
      preview: {
        conflicts: {
          duplicateTemplate: false,
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
