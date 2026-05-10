import { test, describe } from 'node:test';
import assert from 'node:assert';

// Helper function to remove mentions and check for slash command
function getMessageWithoutMentions(message: string): string {
  const mentionRegex = /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_]+)(?=\s|$)/g;
  return message.replace(mentionRegex, '').trim();
}

// Check if message should trigger passthrough mode (slash command after removing mentions)
function shouldPassthrough(message: string): boolean {
  return getMessageWithoutMentions(message).startsWith('/');
}

// 测试 slash command 检测逻辑的纯函数
describe('Slash Command Detection', () => {
  test('纯 / 命令应触发透传模式', () => {
    assert.strictEqual(shouldPassthrough('/new'), true);
  });

  test('@mention 后的 / 命令应触发透传模式', () => {
    assert.strictEqual(shouldPassthrough('@Claude /new'), true);
    assert.strictEqual(getMessageWithoutMentions('@Claude /new'), '/new');
  });

  test('多个 @mention 后的 / 命令应触发透传模式', () => {
    assert.strictEqual(shouldPassthrough('@Claude @Codex /help me'), true);
    assert.strictEqual(getMessageWithoutMentions('@Claude @Codex /help me'), '/help me');
  });

  test('普通消息不应触发透传模式', () => {
    assert.strictEqual(shouldPassthrough('请帮我写一个函数'), false);
  });

  test('@mention 后的普通消息不应触发透传模式', () => {
    assert.strictEqual(shouldPassthrough('@Claude 请帮我分析这段代码'), false);
  });

  test('空 mention 后的消息应正确处理', () => {
    // 空消息不以 / 开头
    assert.strictEqual(shouldPassthrough('@Claude '), false);
  });

  test('中文助手名 mention 应正确移除', () => {
    assert.strictEqual(shouldPassthrough('@小助手 /clear'), true);
    assert.strictEqual(getMessageWithoutMentions('@小助手 /clear'), '/clear');
  });
});