import { strict as assert } from 'assert';
import { describe, test } from 'node:test';
import { __claudeSdkTestUtils } from '../../../core/agent/claude-sdk.executor.js';

const { getClaudeAutoCompactWindow } = __claudeSdkTestUtils;

// SDK 运行时校验：autoCompactWindow 仅接受 int().min(100000).max(1000000)，
// 超范围会被静默丢弃。以下断言验证我们把 provider.contextLength 夹取到该有效区间。
const SDK_MIN = 100_000;
const SDK_MAX = 1_000_000;

function provider(contextLength?: number): any {
  return contextLength === undefined ? {} : { contextLength };
}

describe('getClaudeAutoCompactWindow', () => {
  test('未接入自定义供应商时不覆盖（用宿主机 Claude 原生窗口）', () => {
    assert.equal(getClaudeAutoCompactWindow(undefined), undefined);
  });

  test('供应商无 contextLength 时返回 undefined', () => {
    assert.equal(getClaudeAutoCompactWindow(provider()), undefined);
  });

  test('真实场景：200K 后端模型 → 原样下发 200000，让 Claude 提前压缩', () => {
    assert.equal(getClaudeAutoCompactWindow(provider(200_000)), 200_000);
  });

  test('低于 SDK 下限（如此前测试的 1001）被夹到 100000，而非被 SDK 丢弃', () => {
    assert.equal(getClaudeAutoCompactWindow(provider(1001)), SDK_MIN);
  });

  test('高于 SDK 上限被夹到 1000000', () => {
    assert.equal(getClaudeAutoCompactWindow(provider(2_000_000)), SDK_MAX);
  });

  test('默认 1M 落在上限内', () => {
    assert.equal(getClaudeAutoCompactWindow(provider(1_000_000)), SDK_MAX);
  });

  test('非法值（NaN / 负数 / 0）返回 undefined', () => {
    assert.equal(getClaudeAutoCompactWindow(provider(Number.NaN)), undefined);
    assert.equal(getClaudeAutoCompactWindow(provider(-1)), undefined);
    assert.equal(getClaudeAutoCompactWindow(provider(0)), undefined);
  });

  test('结果始终落在 SDK 接受区间内', () => {
    for (const v of [100_000, 128_000, 200_000, 500_000, 1_000_000]) {
      const out = getClaudeAutoCompactWindow(provider(v))!;
      assert.ok(out >= SDK_MIN && out <= SDK_MAX, `${v} -> ${out} 超出 [${SDK_MIN}, ${SDK_MAX}]`);
      assert.ok(Number.isInteger(out));
    }
  });
});
