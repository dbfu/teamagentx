import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectTemplateConflicts,
} from '../../../modules/template-package/conflict-detector.js';

describe('template conflict detector', () => {
  test('marks package as duplicate when same template id and version already imported', () => {
    const result = detectTemplateConflicts({
      templateId: 'tpl-demo',
      version: '1.0.0',
      desiredGroupName: '客服模板',
      existingImports: [
        { templateId: 'tpl-demo', version: '1.0.0' },
      ],
      existingGroupNames: [],
    });

    assert.equal(result.duplicateTemplate, true);
    assert.deepEqual(result.allowedActions, ['cancel', 'create_copy', 'rename_copy']);
  });

  test('renames imported copy deterministically when desired name already exists', () => {
    const result = detectTemplateConflicts({
      templateId: 'tpl-demo',
      version: '1.0.0',
      desiredGroupName: '客服模板',
      existingImports: [],
      existingGroupNames: ['客服模板', '客服模板（导入副本 1）'],
    });

    assert.equal(result.duplicateTemplate, false);
    assert.equal(result.suggestedGroupName, '客服模板（导入副本 2）');
  });

  test('keeps original name when there is no name conflict', () => {
    const result = detectTemplateConflicts({
      templateId: 'tpl-demo',
      version: '1.0.0',
      desiredGroupName: '客服模板',
      existingImports: [],
      existingGroupNames: ['其他模板'],
    });

    assert.equal(result.suggestedGroupName, '客服模板');
  });
});
