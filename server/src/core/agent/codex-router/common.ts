/**
 * Codex Responses ↔ Chat Completions 转换的共享小工具。
 * 移植自 cc-switch `proxy/providers/codex_chat_common.rs`。
 */

import type { JsonValue } from './json-canonical.js';
import { isPlainObject } from './json-canonical.js';

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 穷举上游可能的 reasoning 字段：reasoning_content > reasoning(字符串/对象) > reasoning_details。
 * 不依赖 provider 的 outputFormat 声明，对各家 Chat 兼容接口都能兜底。
 */
export function extractReasoningFieldText(value: JsonValue): string | undefined {
  if (!isPlainObject(value)) return undefined;

  for (const key of ['reasoning_content', 'reasoning']) {
    const text = asString(value[key]);
    if (text) return text;
  }

  const reasoning = value['reasoning'];
  if (isPlainObject(reasoning)) {
    for (const key of ['content', 'text', 'summary']) {
      const text = asString(reasoning[key]);
      if (text) return text;
    }
  }

  const details = value['reasoning_details'];
  if (details !== undefined) {
    const text = extractReasoningDetailsText(details);
    if (text) return text;
  }

  return undefined;
}

function extractReasoningDetailsText(value: JsonValue): string | undefined {
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) {
    const text = value
      .map(extractReasoningDetailPartText)
      .filter((t): t is string => Boolean(t))
      .join('\n\n');
    return text || undefined;
  }
  if (isPlainObject(value)) return extractReasoningDetailPartText(value);
  return undefined;
}

function extractReasoningDetailPartText(value: JsonValue): string | undefined {
  if (!isPlainObject(value)) return undefined;
  for (const key of ['text', 'content', 'summary']) {
    const text = asString(value[key]);
    if (text) return text;
  }
  const parts = value['parts'];
  if (Array.isArray(parts)) {
    const text = parts
      .map(extractReasoningDetailPartText)
      .filter((t): t is string => Boolean(t))
      .join('\n\n');
    return text || undefined;
  }
  return undefined;
}

/** 从 Responses 的 reasoning item 中提取 summary 文本。 */
export function extractReasoningSummaryText(value: JsonValue): string | undefined {
  if (!isPlainObject(value)) return undefined;

  for (const key of ['reasoning_content', 'content', 'text']) {
    const text = asString(value[key]);
    if (text) return text;
  }

  const summary = value['summary'];
  if (summary === undefined) return undefined;
  if (typeof summary === 'string') return summary.length > 0 ? summary : undefined;
  if (!Array.isArray(summary)) return undefined;

  const text = summary
    .map((part) => {
      if (isPlainObject(part)) {
        return asString(part['text']) ?? asString(part['content']);
      }
      return typeof part === 'string' ? part : undefined;
    })
    .filter((t): t is string => Boolean(t))
    .join('\n\n');
  return text || undefined;
}

/** 把 reasoning 追加进 assistant 消息的 reasoning_content（已有则换行拼接）。 */
export function appendReasoningContent(
  message: Record<string, JsonValue>,
  reasoning: string,
): boolean {
  const trimmed = reasoning.trim();
  if (!trimmed) return false;

  const existing = message['reasoning_content'];
  if (typeof existing === 'string' && existing.length > 0) {
    message['reasoning_content'] = `${existing}\n\n${trimmed}`;
  } else {
    message['reasoning_content'] = trimmed;
  }
  return true;
}

/** 构造 Responses 协议的 function_call output item。 */
export function responseFunctionCallItem(
  itemId: string,
  status: string,
  callId: string,
  name: string,
  args: string,
  reasoning: string | undefined,
): Record<string, JsonValue> {
  const item: Record<string, JsonValue> = {
    id: itemId,
    type: 'function_call',
    status,
    call_id: callId,
    name,
    arguments: args,
  };
  const trimmed = reasoning?.trim();
  if (trimmed) item['reasoning_content'] = trimmed;
  return item;
}

/**
 * 拆分以 `<think>...</think>` 开头的文本，返回 [reasoning, answer]。
 * 不是该形态时返回 undefined。
 */
export function splitLeadingThinkBlock(text: string): [string, string] | undefined {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (!afterWs.startsWith(THINK_OPEN_TAG)) return undefined;

  const bodyStart = leadingWsLen + THINK_OPEN_TAG.length;
  const closeRelative = text.slice(bodyStart).indexOf(THINK_CLOSE_TAG);
  if (closeRelative < 0) return undefined;
  const closeStart = bodyStart + closeRelative;
  const answerStart = closeStart + THINK_CLOSE_TAG.length;

  return [
    text.slice(bodyStart, closeStart).trim(),
    text.slice(answerStart).replace(/^[\r\n\t ]+/, ''),
  ];
}

/** 去掉开头的 `<think>` 开标签（无闭标签的半截思考流），返回剩余文本。 */
export function stripLeadingThinkOpenTag(text: string): string | undefined {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (!afterWs.startsWith(THINK_OPEN_TAG)) return undefined;
  return afterWs.slice(THINK_OPEN_TAG.length).trim();
}
