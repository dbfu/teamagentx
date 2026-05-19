import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKnownMentions } from '../../../core/agent/agent-handler/message-utils.js';

test('parseKnownMentions matches agent names containing slashes', () => {
  const mentions = parseKnownMentions('@Codex/CLI 帮我看一下', [
    'Codex/CLI',
    'Codex',
  ]);

  assert.deepStrictEqual(mentions, ['Codex/CLI']);
});

test('parseKnownMentions treats regex characters in agent names literally', () => {
  const mentions = parseKnownMentions('请 @Agent.(A)/v2? 修复', [
    'Agent.(A)/v2?',
  ]);

  assert.deepStrictEqual(mentions, ['Agent.(A)/v2?']);
});

test('parseKnownMentions does not partially match shorter agent names', () => {
  const mentions = parseKnownMentions('@Alpha/Beta 继续', [
    'Alpha',
    'Alpha/Beta',
  ]);

  assert.deepStrictEqual(mentions, ['Alpha/Beta']);
});
