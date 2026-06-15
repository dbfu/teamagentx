import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDispatchPlanContent,
  buildUnroutedUserConstraintBlock,
} from '../../../core/agent/coordinator-dispatch.js';

const task = (name: string, content: string) => ({
  agent: { name } as any,
  content,
});

test('parallel dispatch message shows independent tasks on separate lines', () => {
  const content = buildDispatchPlanContent(
    [
      task('前端助手', '实现登录页面'),
      task('后端助手', '实现登录接口'),
    ],
    'parallel',
    'zh-CN',
  );

  assert.equal(
    content,
    '**并行任务**\n- @前端助手 实现登录页面\n- @后端助手 实现登录接口',
  );
});

test('serial dispatch message shows execution order and independent tasks', () => {
  const content = buildDispatchPlanContent(
    [
      task('需求助手', '梳理验收标准'),
      task('开发助手', '根据验收标准实现功能'),
      task('测试助手', '验证开发结果'),
    ],
    'serial',
    'zh-CN',
  );

  assert.equal(
    content,
    '**串行任务**\n1. @需求助手 梳理验收标准\n2. @开发助手 根据验收标准实现功能\n3. @测试助手 验证开发结果',
  );
});

test('single dispatch message omits the title and prefix', () => {
  const content = buildDispatchPlanContent(
    [task('开发助手', '修复登录问题')],
    'parallel',
    'zh-CN',
  );

  assert.equal(content, '@开发助手 修复登录问题');
});

test('unrouted user task requires the most relevant single assistant', () => {
  const content = buildUnroutedUserConstraintBlock(3, 'zh-CN');

  assert.match(content, /选择相关度最高的一个助手处理/);
  assert.match(content, /只允许 dispatch，并生成一个 assignment/);
  assert.match(content, /禁止 no_dispatch、ask_owner、cannot_dispatch/);
  assert.match(content, /forwardVerbatim: true/);
});

test('unrouted user constraint is omitted when no business assistant exists', () => {
  assert.equal(buildUnroutedUserConstraintBlock(0, 'zh-CN'), '');
});
