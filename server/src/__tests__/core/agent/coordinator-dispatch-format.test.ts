import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDispatchPlanContent,
  buildUnroutedUserConstraintBlock,
  findCoordinatorProviders,
  isAnthropicToolChoiceCompatibilityError,
} from '../../../core/agent/coordinator-dispatch.js';
import {
  markTaskWithoutAssistantHandoff,
  parseTaskPromptPolicy,
} from '../../../core/agent/task-prompt-policy.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';

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

test('coordinated task policy is internal and reversible', () => {
  const marked = markTaskWithoutAssistantHandoff('@开发助手 修复登录问题');
  const policy = parseTaskPromptPolicy(marked);

  assert.equal(policy.suppressAssistantHandoff, true);
  assert.equal(policy.content, '@开发助手 修复登录问题');
  assert.doesNotMatch(policy.content, /teamagentx:coordinated-task/);
});

test('ordinary task keeps assistant handoff enabled', () => {
  const policy = parseTaskPromptPolicy('@开发助手 修复登录问题');

  assert.equal(policy.suppressAssistantHandoff, false);
  assert.equal(policy.content, '@开发助手 修复登录问题');
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

test('anthropic coordinator detects tool_choice incompatibility in thinking mode', () => {
  const error = new Error(
    '400 {"error":{"message":"The tool_choice parameter does not support being set to required or object in thinking mode"}}',
  );

  assert.equal(isAnthropicToolChoiceCompatibilityError(error), true);
});

test('anthropic coordinator does not hide unrelated provider errors', () => {
  assert.equal(isAnthropicToolChoiceCompatibilityError(new Error('401 invalid api key')), false);
});

test('coordinator provider candidates include compatible fallback models in order', async () => {
  const originalFindActive = llmProviderService.findActive;
  const originalFindDefault = llmProviderService.findDefault;
  const primary = {
    id: 'primary-anthropic',
    name: 'primary',
    model: 'primary-model',
    apiProtocol: 'anthropic',
    modelType: 'text',
  };
  const fallbackAnthropic = {
    id: 'fallback-anthropic',
    name: 'fallback',
    model: 'fallback-model',
    apiProtocol: 'anthropic',
    modelType: 'text',
  };
  const fallbackOpenAI = {
    id: 'fallback-openai',
    name: 'wrong-protocol',
    model: 'wrong-model',
    apiProtocol: 'openai',
    modelType: 'text',
  };
  const fallbackImage = {
    id: 'fallback-image',
    name: 'wrong-type',
    model: 'image-model',
    apiProtocol: 'anthropic',
    modelType: 'image',
  };

  try {
    (llmProviderService as any).findActive = async () => [
      fallbackOpenAI,
      fallbackAnthropic,
      fallbackImage,
      primary,
    ];
    (llmProviderService as any).findDefault = async () => null;

    const candidates = await findCoordinatorProviders({
      acpTool: 'claude',
      llmProvider: primary,
      fallbackLlmProviderIds: JSON.stringify([
        'fallback-openai',
        'fallback-anthropic',
        'fallback-image',
        'primary-anthropic',
      ]),
    } as any);

    assert.deepEqual(
      candidates.map((candidate) => ({
        id: candidate.provider.id,
        role: candidate.role,
      })),
      [
        { id: 'primary-anthropic', role: 'primary' },
        { id: 'fallback-anthropic', role: 'fallback' },
      ],
    );
  } finally {
    (llmProviderService as any).findActive = originalFindActive;
    (llmProviderService as any).findDefault = originalFindDefault;
  }
});
