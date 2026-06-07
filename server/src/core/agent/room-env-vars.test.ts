import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRoomEnvVars,
  buildShellEnvFromRoomEnvVars,
  partitionRoomEnvVars,
} from './room-env-vars.js';

test('parseRoomEnvVars: 解析合法 JSON 数组', () => {
  const raw = JSON.stringify([
    { key: 'GITHUB_TOKEN', value: 'ghp_x', description: 'token' },
    { key: 'DEPLOY_HOST', value: '10.0.0.1' },
  ]);
  const result = parseRoomEnvVars(raw);
  assert.deepEqual(result, [
    { key: 'GITHUB_TOKEN', value: 'ghp_x', description: 'token' },
    { key: 'DEPLOY_HOST', value: '10.0.0.1', description: undefined },
  ]);
});

test('parseRoomEnvVars: 非法输入返回空数组', () => {
  assert.deepEqual(parseRoomEnvVars(null), []);
  assert.deepEqual(parseRoomEnvVars(undefined), []);
  assert.deepEqual(parseRoomEnvVars(''), []);
  assert.deepEqual(parseRoomEnvVars('not json'), []);
  assert.deepEqual(parseRoomEnvVars('{"key":"X"}'), []); // 非数组
});

test('parseRoomEnvVars: 丢弃非法 key', () => {
  const raw = JSON.stringify([
    { key: '1BAD', value: 'a' },
    { key: 'has-dash', value: 'b' },
    { key: 'has space', value: 'c' },
    { key: '', value: 'd' },
    { key: 'GOOD_1', value: 'e' },
    { key: '_underscore', value: 'f' },
  ]);
  const result = parseRoomEnvVars(raw);
  assert.deepEqual(
    result.map((v) => v.key),
    ['GOOD_1', '_underscore'],
  );
});

test('parseRoomEnvVars: key 去重保留首次出现', () => {
  const raw = JSON.stringify([
    { key: 'DUP', value: 'first' },
    { key: 'DUP', value: 'second' },
  ]);
  const result = parseRoomEnvVars(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, 'first');
});

test('parseRoomEnvVars: value 缺省为空字符串', () => {
  const raw = JSON.stringify([{ key: 'NO_VALUE' }]);
  const result = parseRoomEnvVars(raw);
  assert.deepEqual(result, [
    { key: 'NO_VALUE', value: '', description: undefined },
  ]);
});

test('buildShellEnvFromRoomEnvVars: 合并普通键', () => {
  const base: Record<string, string | undefined> = { PATH: '/usr/bin', EXISTING: '1' };
  const { env, skippedKeys } = buildShellEnvFromRoomEnvVars(base, [
    { key: 'MY_VAR', value: 'hello' },
  ]);
  assert.equal(env.MY_VAR, 'hello');
  assert.equal(env.EXISTING, '1');
  assert.deepEqual(skippedKeys, []);
});

test('buildShellEnvFromRoomEnvVars: 跳过保留键且不污染 base', () => {
  const base: Record<string, string | undefined> = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret' };
  const { env, skippedKeys } = buildShellEnvFromRoomEnvVars(base, [
    { key: 'PATH', value: '/evil' },
    { key: 'ANTHROPIC_API_KEY', value: 'hijack' },
    { key: 'OPENAI_MODEL', value: 'x' },
    { key: 'TEAMAGENTX_WORK_DIR', value: 'y' },
    { key: 'SAFE', value: 'ok' },
  ]);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.ANTHROPIC_API_KEY, 'secret');
  assert.equal(env.SAFE, 'ok');
  assert.equal(env.OPENAI_MODEL, undefined);
  assert.equal(env.TEAMAGENTX_WORK_DIR, undefined);
  assert.deepEqual(
    skippedKeys.sort(),
    ['ANTHROPIC_API_KEY', 'OPENAI_MODEL', 'PATH', 'TEAMAGENTX_WORK_DIR'].sort(),
  );
});

test('partitionRoomEnvVars: 拆分保留键与可用键', () => {
  const { accepted, skippedKeys } = partitionRoomEnvVars([
    { key: 'SAFE', value: '1' },
    { key: 'PATH', value: '/evil' },
    { key: 'ANTHROPIC_API_KEY', value: 'x' },
    { key: 'OK_2', value: '2' },
  ]);
  assert.deepEqual(
    accepted.map((v) => v.key),
    ['SAFE', 'OK_2'],
  );
  assert.deepEqual(skippedKeys, ['PATH', 'ANTHROPIC_API_KEY']);
});

test('buildShellEnvFromRoomEnvVars: 空列表原样返回', () => {
  const base = { PATH: '/usr/bin' };
  const { env, skippedKeys } = buildShellEnvFromRoomEnvVars(base, []);
  assert.equal(env.PATH, '/usr/bin');
  assert.deepEqual(skippedKeys, []);
});
