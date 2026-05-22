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
  const mentions = parseKnownMentions('@Agent.(A)/v2? 修复', [
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

test('parseKnownMentions ignores inline mentions after punctuation', () => {
  const mentions = parseKnownMentions(
    '遵旨。臣先传内阁首辅周大人上朝奏对。@内阁首辅·周延儒 首辅周大人，早朝已启。',
    ['内阁首辅·周延儒'],
  );

  assert.deepStrictEqual(mentions, []);
});

test('parseKnownMentions matches inline mentions after a space', () => {
  const mentions = parseKnownMentions(
    '遵旨。臣先传内阁首辅周大人上朝奏对。 @内阁首辅·周延儒 首辅周大人，早朝已启。',
    ['内阁首辅·周延儒'],
  );

  assert.deepStrictEqual(mentions, ['内阁首辅·周延儒']);
});

test('parseKnownMentions matches mentions at the start of a new line', () => {
  const mentions = parseKnownMentions('请处理下一步：\n@Codex/CLI 继续', [
    'Codex/CLI',
  ]);

  assert.deepStrictEqual(mentions, ['Codex/CLI']);
});
