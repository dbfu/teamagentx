import assert from 'node:assert/strict';
import test from 'node:test';
import { getMentionedKnownUsernames } from './todo-mentions.js';

test('getMentionedKnownUsernames detects spaced and inline Chinese mentions', () => {
  const mentions = getMentionedKnownUsernames('需要 @张三 确认，另外请@李四 看一下', ['张三', '李四']);

  assert.deepEqual(mentions, ['张三', '李四']);
});

test('getMentionedKnownUsernames ignores email-like at signs', () => {
  const mentions = getMentionedKnownUsernames('mail@tester 不是提醒，但 @tester 是', ['tester']);

  assert.deepEqual(mentions, ['tester']);
});

test('getMentionedKnownUsernames prefers exact known names', () => {
  const mentions = getMentionedKnownUsernames('@张三丰 请处理，不要误判 @张三丰-test', ['张三', '张三丰']);

  assert.deepEqual(mentions, ['张三丰']);
});
