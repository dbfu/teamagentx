import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectTemplateConflicts,
} from '../../../modules/template-package/conflict-detector.js';

describe('template conflict detector', () => {
  test('renames imported copy deterministically when desired name already exists', () => {
    const result = detectTemplateConflicts({
      desiredGroupName: '客服模板',
      existingGroupNames: ['客服模板', '客服模板（导入副本 1）'],
    });

    assert.equal(result.nameConflict, true);
    assert.deepEqual(result.allowedActions, ['cancel', 'create_copy', 'rename_copy']);
    assert.equal(result.suggestedGroupName, '客服模板（导入副本 2）');
  });

  test('keeps original name when there is no name conflict', () => {
    const result = detectTemplateConflicts({
      desiredGroupName: '客服模板',
      existingGroupNames: ['其他模板'],
    });

    assert.equal(result.nameConflict, false);
    assert.equal(result.suggestedGroupName, '客服模板');
  });
});
