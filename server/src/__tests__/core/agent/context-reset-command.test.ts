import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getContextResetCommand } from '../../../core/agent/context-reset-command.js';

describe('getContextResetCommand', () => {
  test('matches supported reset commands', () => {
    assert.equal(getContextResetCommand('/clear'), '/clear');
    assert.equal(getContextResetCommand(' /NEW '), '/new');
    assert.equal(getContextResetCommand('@Claude /clear'), '/clear');
    assert.equal(getContextResetCommand('@Claude @Codex /new'), '/new');
  });

  test('does not treat unmatched slash content as a reset command', () => {
    assert.equal(getContextResetCommand('/help'), undefined);
    assert.equal(getContextResetCommand('/clear context'), undefined);
    assert.equal(getContextResetCommand('@Claude /unknown'), undefined);
  });

  test('does not match reset commands embedded in natural language', () => {
    assert.equal(getContextResetCommand('请执行 /clear'), undefined);
  });
});
