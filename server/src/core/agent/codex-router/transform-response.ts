/**
 * 非流式 OpenAI Chat Completions 响应 / 错误 → Codex Responses 形状。
 * 移植自 cc-switch `proxy/providers/transform_codex_chat.rs`（响应侧）。
 * 同时导出流式与非流式共用的小工具。
 */

import type { JsonValue } from './json-canonical.js';
import { canonicalizeToolArguments, isPlainObject } from './json-canonical.js';
import {
  extractReasoningFieldText,
  responseFunctionCallItem,
  splitLeadingThinkBlock,
} from './common.js';

type Obj = Record<string, JsonValue>;

export class CodexRouterTransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexRouterTransformError';
  }
}

function getStr(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNum(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function responseIdFromChatId(id: string | undefined): string {
  const value = id ?? 'teamagentx';
  return value.startsWith('resp_') ? value : `resp_${value}`;
}

export function responseStatusFromFinishReason(finishReason: string | undefined): string {
  return finishReason === 'length' ? 'incomplete' : 'completed';
}

export function chatUsageToResponsesUsage(usage: JsonValue | undefined): Obj {
  if (!isPlainObject(usage)) {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }

  const inputTokens = getNum(usage['prompt_tokens']) ?? getNum(usage['input_tokens']) ?? 0;
  const outputTokens =
    getNum(usage['completion_tokens']) ?? getNum(usage['output_tokens']) ?? 0;
  const totalTokens = getNum(usage['total_tokens']) ?? inputTokens + outputTokens;

  const result: Obj = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };

  const promptDetails = usage['prompt_tokens_details'];
  const inputDetails = usage['input_tokens_details'];
  const cached =
    (isPlainObject(promptDetails) ? getNum(promptDetails['cached_tokens']) : undefined) ??
    (isPlainObject(inputDetails) ? getNum(inputDetails['cached_tokens']) : undefined);
  if (cached !== undefined) result['input_tokens_details'] = { cached_tokens: cached };

  if (usage['completion_tokens_details'] !== undefined) {
    result['output_tokens_details'] = usage['completion_tokens_details'];
  }
  if (usage['cache_read_input_tokens'] !== undefined) {
    result['cache_read_input_tokens'] = usage['cache_read_input_tokens'];
  }
  if (usage['cache_creation_input_tokens'] !== undefined) {
    result['cache_creation_input_tokens'] = usage['cache_creation_input_tokens'];
  }

  return result;
}

/** 非流式 Chat 响应 → Responses 响应。 */
export function chatCompletionToResponse(body: JsonValue): Obj {
  if (!isPlainObject(body)) {
    throw new CodexRouterTransformError('Chat response is not an object');
  }
  const choices = body['choices'];
  if (!Array.isArray(choices)) {
    throw new CodexRouterTransformError('No choices in chat response');
  }
  const choice = choices[0];
  if (!isPlainObject(choice)) {
    throw new CodexRouterTransformError('Empty choices in chat response');
  }
  const message = choice['message'];
  if (!isPlainObject(message)) {
    throw new CodexRouterTransformError('No message in chat choice');
  }

  const responseId = responseIdFromChatId(getStr(body['id']));
  const model = getStr(body['model']) ?? '';
  const createdAt = getNum(body['created']) ?? 0;
  const finishReason = getStr(choice['finish_reason']);

  const reasoning = chatReasoningText(message);
  const output: Obj[] = [];

  const reasoningItem = chatReasoningToResponseOutputItem(reasoning, responseId);
  if (reasoningItem) output.push(reasoningItem);

  const messageItem = chatMessageToResponseOutputItem(message, responseId);
  if (messageItem) output.push(messageItem);

  output.push(...chatToolCallsToResponseOutputItems(message, reasoning));

  const response: Obj = {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: responseStatusFromFinishReason(finishReason),
    model,
    output,
    usage: chatUsageToResponsesUsage(body['usage']),
  };

  if (finishReason === 'length') {
    response['incomplete_details'] = { reason: 'max_output_tokens' };
  }

  return response;
}

function chatReasoningToResponseOutputItem(
  reasoning: string | undefined,
  responseId: string,
): Obj | undefined {
  if (!reasoning) return undefined;
  return {
    id: `rs_${responseId}`,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: reasoning }],
  };
}

function chatReasoningText(message: Obj): string | undefined {
  const field = extractReasoningFieldText(message);
  if (field) return field;

  const content = getStr(message['content']);
  if (content) {
    const split = splitLeadingThinkBlock(content);
    if (split && split[0]) return split[0];
  }
  return undefined;
}

function chatMessageToResponseOutputItem(message: Obj, responseId: string): Obj | undefined {
  const content: Obj[] = [];

  const textContent = getStr(message['content']);
  if (textContent !== undefined) {
    const split = splitLeadingThinkBlock(textContent);
    const text = split ? split[1] : textContent;
    if (text) content.push({ type: 'output_text', text, annotations: [] });
  } else if (Array.isArray(message['content'])) {
    for (const part of message['content']) {
      if (!isPlainObject(part)) continue;
      const partType = getStr(part['type']) ?? '';
      if (partType === 'text' || partType === 'output_text') {
        const text = getStr(part['text']);
        if (text) content.push({ type: 'output_text', text, annotations: [] });
      } else if (partType === 'refusal') {
        const text = getStr(part['refusal']);
        if (text) content.push({ type: 'refusal', refusal: text });
      }
    }
  }

  const refusal = getStr(message['refusal']);
  if (refusal) content.push({ type: 'refusal', refusal });

  if (content.length === 0) return undefined;

  return {
    id: `${responseId}_msg`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content,
  };
}

function chatToolCallsToResponseOutputItems(
  message: Obj,
  reasoning: string | undefined,
): Obj[] {
  const output: Obj[] = [];
  const toolCalls = message['tool_calls'];
  if (Array.isArray(toolCalls)) {
    toolCalls.forEach((toolCall, index) => {
      output.push(chatToolCallToResponseItem(toolCall, index, reasoning));
    });
  } else if (message['function_call'] !== undefined) {
    output.push(chatLegacyFunctionCallToResponseItem(message['function_call'], reasoning));
  }
  return output;
}

function chatToolCallToResponseItem(
  toolCall: JsonValue,
  index: number,
  reasoning: string | undefined,
): Obj {
  const obj = isPlainObject(toolCall) ? toolCall : {};
  const callId = getStr(obj['id']) || `call_${index}`;
  const fn = isPlainObject(obj['function']) ? obj['function'] : {};
  const name = getStr(fn['name']) ?? '';
  const args = canonicalizeToolArguments(fn['arguments']);
  return responseFunctionCallItem(`fc_${callId}`, 'completed', callId, name, args, reasoning);
}

function chatLegacyFunctionCallToResponseItem(
  functionCall: JsonValue,
  reasoning: string | undefined,
): Obj {
  const obj = isPlainObject(functionCall) ? functionCall : {};
  const callId = getStr(obj['id']) || 'call_0';
  const name = getStr(obj['name']) ?? '';
  const args = canonicalizeToolArguments(obj['arguments']);
  return responseFunctionCallItem(`fc_${callId}`, 'completed', callId, name, args, reasoning);
}

/**
 * Chat 错误体 → Responses 风格 `{"error": {message, type, code, param}}`。
 * 兼容标准 OpenAI、MiniMax base_resp、顶层 message/detail、裸字符串。
 */
export function chatErrorToResponseError(body: JsonValue | undefined): Obj {
  if (body === undefined || body === null) {
    return {
      error: {
        message: 'Upstream returned an empty error response',
        type: 'upstream_error',
        code: null,
        param: null,
      },
    };
  }

  if (typeof body === 'string') {
    return {
      error: { message: body, type: 'upstream_error', code: null, param: null },
    };
  }

  const source =
    isPlainObject(body) && isPlainObject(body['error']) ? body['error'] : body;
  const srcObj = isPlainObject(source) ? source : {};
  const baseResp = isPlainObject(srcObj['base_resp']) ? srcObj['base_resp'] : undefined;

  const message =
    getStr(srcObj['message']) ??
    getStr(srcObj['detail']) ??
    getStr(srcObj['status_msg']) ??
    (baseResp ? getStr(baseResp['status_msg']) : undefined) ??
    (typeof source === 'string' ? source : undefined) ??
    JSON.stringify(source);

  const errorType = getStr(srcObj['type']) ?? 'upstream_error';
  const code =
    srcObj['code'] !== undefined
      ? srcObj['code']
      : baseResp && baseResp['status_code'] !== undefined
        ? baseResp['status_code']
        : null;
  const param = srcObj['param'] !== undefined ? srcObj['param'] : null;

  return { error: { message, type: errorType, code, param } };
}
