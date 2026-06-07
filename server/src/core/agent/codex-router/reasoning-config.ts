/**
 * 各家 Chat 兼容接口的 reasoning 参数适配。
 * 移植自 cc-switch `proxy/providers/codex.rs`（推断）与 `transform_codex_chat.rs`（应用）。
 *
 * 思路：Codex 客户端用 Responses 协议发 `reasoning.effort`，但各家 Chat 接口的思考开关
 * 参数完全不同（thinking / enable_thinking / reasoning_effort / reasoning.effort …），
 * 这里按 provider 的 name + base_url + model 推断出一套配置，再据此改写请求体。
 */

import type { JsonValue } from './json-canonical.js';
import { isPlainObject } from './json-canonical.js';

export interface CodexChatReasoningConfig {
  supportsThinking?: boolean;
  supportsEffort?: boolean;
  /** 思考开关参数名：thinking | enable_thinking | reasoning_split | none */
  thinkingParam?: string;
  /** effort 参数名：reasoning_effort | reasoning.effort | none */
  effortParam?: string;
  /** effort 取值映射模式：deepseek | low_high | openrouter | passthrough */
  effortValueMode?: string;
  /** 上游思考回传字段（仅记录用途，转换无需）：reasoning_content | reasoning | ... */
  outputFormat?: string;
}

export interface ReasoningProviderHint {
  name?: string | null;
  baseUrl?: string | null;
  model?: string | null;
}

export function isOpenAiOSeries(model: string): boolean {
  return model.length > 1 && model.startsWith('o') && /[0-9]/.test(model[1] ?? '');
}

export function supportsReasoningEffort(model: string): boolean {
  if (isOpenAiOSeries(model)) return true;
  const lower = model.toLowerCase();
  if (!lower.startsWith('gpt-')) return false;
  const c = lower.slice('gpt-'.length)[0];
  return Boolean(c) && c >= '5' && c <= '9';
}

/**
 * 聚合 / 托管平台的 reasoning 由平台决定，仅按 name + base_url 判定（绝不掺 model 名，
 * 否则会把托管平台误判成模型官方接口）。
 */
function inferAggregatorPlatformConfig(
  name: string,
  baseUrl: string,
): CodexChatReasoningConfig | undefined {
  const platform = `${name} ${baseUrl}`;

  if (platform.includes('openrouter')) {
    return {
      supportsThinking: false,
      supportsEffort: true,
      thinkingParam: 'none',
      effortParam: 'reasoning.effort',
      effortValueMode: 'openrouter',
      outputFormat: 'auto',
    };
  }

  if (platform.includes('siliconflow')) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'enable_thinking',
      effortParam: 'none',
      outputFormat: 'reasoning_content',
    };
  }

  return undefined;
}

/** 根据 provider 标识推断 reasoning 配置。无法识别时返回 undefined（走默认 effort 透传）。 */
export function inferCodexChatReasoningConfig(
  hint: ReasoningProviderHint,
): CodexChatReasoningConfig | undefined {
  const model = (hint.model ?? '').toLowerCase();
  const baseUrl = (hint.baseUrl ?? '').toLowerCase();
  const name = (hint.name ?? '').toLowerCase();

  // 平台优先：覆盖模型规则。
  const platformConfig = inferAggregatorPlatformConfig(name, baseUrl);
  if (platformConfig) return platformConfig;

  const haystack = `${name} ${baseUrl} ${model}`;

  if (haystack.includes('deepseek')) {
    return {
      supportsThinking: true,
      supportsEffort: true,
      thinkingParam: 'thinking',
      effortParam: 'reasoning_effort',
      effortValueMode: 'deepseek',
      outputFormat: 'reasoning_content',
    };
  }

  if (haystack.includes('stepfun') || haystack.includes('step-3.5-flash-2603')) {
    return {
      supportsThinking: true,
      supportsEffort: model.includes('2603'),
      thinkingParam: 'none',
      effortParam: 'reasoning_effort',
      effortValueMode: 'low_high',
      outputFormat: 'reasoning',
    };
  }

  if (haystack.includes('kimi') || haystack.includes('moonshot')) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'thinking',
      effortParam: 'none',
      outputFormat: 'reasoning_content',
    };
  }

  if (haystack.includes('glm') || haystack.includes('zhipu') || haystack.includes('z.ai')) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'thinking',
      effortParam: 'none',
      outputFormat: 'reasoning_content',
    };
  }

  if (
    haystack.includes('qwen') ||
    haystack.includes('dashscope') ||
    haystack.includes('bailian')
  ) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'enable_thinking',
      effortParam: 'none',
      outputFormat: 'reasoning_content',
    };
  }

  if (haystack.includes('minimax')) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'reasoning_split',
      effortParam: 'none',
      outputFormat: 'reasoning_details',
    };
  }

  if (haystack.includes('mimo')) {
    return {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: 'thinking',
      effortParam: 'none',
      outputFormat: 'reasoning_content',
    };
  }

  return undefined;
}

function reasoningPointerEffort(body: Record<string, JsonValue>): string | undefined {
  const reasoning = body['reasoning'];
  if (isPlainObject(reasoning) && typeof reasoning['effort'] === 'string') {
    return reasoning['effort'];
  }
  return undefined;
}

/** 上游是否表达了"要思考"。undefined 表示完全没带 reasoning 字段。 */
function reasoningRequested(body: Record<string, JsonValue>): boolean | undefined {
  const effort = reasoningPointerEffort(body);
  if (effort !== undefined) {
    return !['none', 'off', 'disabled'].includes(effort.trim().toLowerCase());
  }
  const reasoning = body['reasoning'];
  if (reasoning === undefined) return undefined;
  return reasoning !== null;
}

function mapReasoningEffort(effort: string, mode: string | undefined): string | undefined {
  const e = effort.trim().toLowerCase();
  if (['none', 'off', 'disabled'].includes(e)) return undefined;

  switch (mode ?? 'passthrough') {
    case 'deepseek':
      return e === 'max' || e === 'xhigh' ? 'max' : 'high';
    case 'low_high':
      return e === 'minimal' || e === 'low' ? 'low' : 'high';
    case 'openrouter':
      if (e === 'max' || e === 'xhigh') return 'xhigh';
      if (['high', 'medium', 'low', 'minimal'].includes(e)) return e;
      return undefined;
    default:
      if (['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(e)) return e;
      return undefined;
  }
}

/**
 * 据 reasoning 配置把 Responses 的 `reasoning.effort` 改写进 Chat 请求体 `result`。
 * config 为 undefined 时退化为 OpenAI 风格：仅 gpt-5+/o-series 透传 reasoning_effort。
 */
export function applyReasoningOptions(
  result: Record<string, JsonValue>,
  body: Record<string, JsonValue>,
  model: string,
  config: CodexChatReasoningConfig | undefined,
): void {
  if (!config) {
    if (supportsReasoningEffort(model)) {
      const effort = reasoningPointerEffort(body);
      if (effort !== undefined) result['reasoning_effort'] = effort;
    }
    return;
  }

  const supportsEffort = config.supportsEffort ?? false;
  const supportsThinking = (config.supportsThinking ?? false) || supportsEffort;
  const reasoningEnabled = reasoningRequested(body);
  if (reasoningEnabled === undefined) return;

  if (supportsThinking) {
    switch ((config.thinkingParam ?? 'thinking').trim().toLowerCase()) {
      case 'thinking':
        result['thinking'] = { type: reasoningEnabled ? 'enabled' : 'disabled' };
        break;
      case 'enable_thinking':
        result['enable_thinking'] = reasoningEnabled;
        break;
      case 'reasoning_split':
        result['reasoning_split'] = reasoningEnabled;
        break;
      default:
        break;
    }
  }

  const effortParam = (config.effortParam ?? 'reasoning_effort').trim().toLowerCase();

  if (!reasoningEnabled) {
    // OpenRouter 原生 reasoning.effort 支持显式 "none"（彻底关闭推理）。
    if (effortParam === 'reasoning.effort') {
      result['reasoning'] = { effort: 'none' };
    }
    return;
  }

  if (!supportsEffort) return;

  const effort = reasoningPointerEffort(body);
  if (effort === undefined) return;
  const mapped = mapReasoningEffort(effort, config.effortValueMode);
  if (mapped === undefined) return;

  if (effortParam === 'reasoning_effort') {
    result['reasoning_effort'] = mapped;
  } else if (effortParam === 'reasoning.effort') {
    result['reasoning'] = { effort: mapped };
  }
}
