/**
 * Codex Responses 请求 → OpenAI Chat Completions 请求。
 * 移植自 cc-switch `proxy/providers/transform_codex_chat.rs`（请求侧）。
 */

import type { JsonValue } from './json-canonical.js';
import {
  canonicalJsonString,
  canonicalizeJsonStringIfParseable,
  canonicalizeToolArguments,
  isPlainObject,
} from './json-canonical.js';
import {
  appendReasoningContent,
  extractReasoningFieldText,
  extractReasoningSummaryText,
} from './common.js';
import {
  applyReasoningOptions,
  isOpenAiOSeries,
  type CodexChatReasoningConfig,
} from './reasoning-config.js';

type Obj = Record<string, JsonValue>;

const EXTRA_CHAT_PASSTHROUGH_FIELDS = [
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'metadata',
  'n',
  'parallel_tool_calls',
  'presence_penalty',
  'response_format',
  'seed',
  'service_tier',
  'stop',
  'stream_options',
  'top_logprobs',
  'user',
] as const;

function getStr(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 主入口：把 Responses 请求体转换成 Chat Completions 请求体。 */
export function responsesToChatCompletions(
  body: Obj,
  reasoningConfig?: CodexChatReasoningConfig,
): Obj {
  const result: Obj = {};

  if (body['model'] !== undefined) result['model'] = body['model'];

  const messages: Obj[] = [];
  if (body['instructions'] !== undefined) {
    const instructions = instructionText(body['instructions']);
    if (instructions) messages.push({ role: 'system', content: instructions });
  }
  if (body['input'] !== undefined) {
    appendResponsesInputAsChatMessages(body['input'], messages);
  }
  result['messages'] = collapseSystemMessagesToHead(messages);

  const model = getStr(body['model']) ?? '';
  if (body['max_output_tokens'] !== undefined) {
    if (isOpenAiOSeries(model)) {
      result['max_completion_tokens'] = body['max_output_tokens'];
    } else {
      result['max_tokens'] = body['max_output_tokens'];
    }
  }
  if (body['max_tokens'] !== undefined) result['max_tokens'] = body['max_tokens'];
  if (body['max_completion_tokens'] !== undefined) {
    result['max_completion_tokens'] = body['max_completion_tokens'];
  }

  for (const key of ['temperature', 'top_p', 'stream'] as const) {
    if (body[key] !== undefined) result[key] = body[key];
  }

  applyReasoningOptions(result, body, model, reasoningConfig);

  const tools = body['tools'];
  if (Array.isArray(tools)) {
    const chatTools = tools
      .map(responsesToolToChatTool)
      .filter((t): t is Obj => t !== undefined);
    if (chatTools.length > 0) result['tools'] = chatTools;
  }

  if (body['tool_choice'] !== undefined) {
    result['tool_choice'] = responsesToolChoiceToChat(body['tool_choice']);
  }

  for (const key of EXTRA_CHAT_PASSTHROUGH_FIELDS) {
    if (body[key] !== undefined) result[key] = body[key];
  }

  // OpenAI 兼容上游流式默认不回 usage，必须显式 include_usage 才会在末尾吐 usage chunk。
  if (result['stream'] === true) {
    const opts = result['stream_options'];
    if (isPlainObject(opts)) {
      opts['include_usage'] = true;
    } else {
      result['stream_options'] = { include_usage: true };
    }
  }

  return result;
}

function instructionText(value: JsonValue): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (isPlainObject(part)) return getStr(part['text']);
        return typeof part === 'string' ? part : undefined;
      })
      .filter((s): s is string => Boolean(s))
      .join('\n\n');
  }
  return '';
}

/**
 * MiniMax 等严格要求 system 只能首条出现，把所有 system 合并到首位。
 * 对 OpenAI/DeepSeek 等宽松层也是无损的。
 */
function collapseSystemMessagesToHead(messages: Obj[]): Obj[] {
  const systemChunks: string[] = [];
  const rest: Obj[] = [];

  for (const msg of messages) {
    if (msg['role'] === 'system' && typeof msg['content'] === 'string') {
      if (msg['content'].trim()) systemChunks.push(msg['content']);
      continue;
    }
    rest.push(msg);
  }

  const out: Obj[] = [];
  if (systemChunks.length > 0) {
    out.push({ role: 'system', content: systemChunks.join('\n\n') });
  }
  out.push(...rest);
  return out;
}

interface InputState {
  pendingToolCalls: Obj[];
  pendingReasoning: string | undefined;
  lastAssistantIndex: number | undefined;
}

function appendResponsesInputAsChatMessages(input: JsonValue, messages: Obj[]): void {
  const state: InputState = {
    pendingToolCalls: [],
    pendingReasoning: undefined,
    lastAssistantIndex: undefined,
  };

  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) appendResponsesItem(item, messages, state);
  } else if (isPlainObject(input)) {
    appendResponsesItem(input, messages, state);
  }

  flushPendingToolCalls(messages, state);
  backfillToolCallReasoningPlaceholders(messages);
}

function appendResponsesItem(item: JsonValue, messages: Obj[], state: InputState): void {
  if (!isPlainObject(item)) return;
  const itemType = getStr(item['type']);

  switch (itemType) {
    case 'function_call':
      appendUniquePendingReasoning(state, extractReasoningFieldText(item));
      state.pendingToolCalls.push(responsesFunctionCallToChatToolCall(item));
      return;
    case 'function_call_output': {
      flushPendingToolCalls(messages, state);
      const callId = getStr(item['call_id']) ?? '';
      const out = item['output'];
      let content = '';
      if (typeof out === 'string') content = canonicalizeJsonStringIfParseable(out);
      else if (out !== undefined && out !== null) content = canonicalJsonString(out);
      messages.push({ role: 'tool', tool_call_id: callId, content });
      return;
    }
    case 'reasoning': {
      const reasoning = extractReasoningSummaryText(item);
      const attached =
        state.pendingToolCalls.length === 0 &&
        attachReasoningToLastAssistant(messages, state.lastAssistantIndex, reasoning);
      if (!attached) appendPendingReasoning(state, reasoning);
      return;
    }
    default: {
      // "message" 或无 type，以及未知 type：先 flush 工具调用，再作为消息处理。
      flushPendingToolCalls(messages, state);
      if (item['role'] !== undefined || item['content'] !== undefined) {
        const message = responsesMessageItemToChatMessage(item, state);
        updateLastAssistantIndex(messages, message, state);
        messages.push(message);
      }
      return;
    }
  }
}

function flushPendingToolCalls(messages: Obj[], state: InputState): void {
  if (state.pendingToolCalls.length === 0) return;
  const message: Obj = {
    role: 'assistant',
    content: null,
    tool_calls: state.pendingToolCalls,
  };
  state.pendingToolCalls = [];
  attachPendingReasoningToAssistant(message, state);
  state.lastAssistantIndex = messages.length;
  messages.push(message);
}

function responsesMessageItemToChatMessage(item: Obj, state: InputState): Obj {
  const role = getStr(item['role']) ?? 'user';
  const chatRole = responsesRoleToChatRole(role);
  const content =
    item['content'] !== undefined
      ? responsesContentToChatContent(item['content'])
      : null;

  const message: Obj = { role: chatRole, content };

  if (chatRole === 'assistant') {
    appendPendingReasoning(state, extractReasoningFieldText(item));
    attachPendingReasoningToAssistant(message, state);
  } else if (state.pendingReasoning !== undefined) {
    state.pendingReasoning = undefined;
  }

  return message;
}

function responsesRoleToChatRole(role: string): string {
  switch (role) {
    case 'system':
    case 'developer':
      return 'system';
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    default:
      return 'user';
  }
}

function updateLastAssistantIndex(messages: Obj[], message: Obj, state: InputState): void {
  const role = getStr(message['role']);
  if (role === 'assistant') state.lastAssistantIndex = messages.length;
  else if (role === 'tool') {
    /* 保持 */
  } else state.lastAssistantIndex = undefined;
}

function appendPendingReasoning(state: InputState, reasoning: string | undefined): void {
  const trimmed = reasoning?.trim();
  if (!trimmed) return;
  if (state.pendingReasoning) state.pendingReasoning = `${state.pendingReasoning}\n\n${trimmed}`;
  else state.pendingReasoning = trimmed;
}

function appendUniquePendingReasoning(state: InputState, reasoning: string | undefined): void {
  const trimmed = reasoning?.trim();
  if (!trimmed) return;
  if (state.pendingReasoning?.includes(trimmed)) return;
  if (state.pendingReasoning) state.pendingReasoning = `${state.pendingReasoning}\n\n${trimmed}`;
  else state.pendingReasoning = trimmed;
}

function attachPendingReasoningToAssistant(message: Obj, state: InputState): void {
  const reasoning = state.pendingReasoning;
  state.pendingReasoning = undefined;
  if (!reasoning || !reasoning.trim()) return;
  appendReasoningContent(message, reasoning);
}

/** 管线末端兜底：仍缺 reasoning_content 的 assistant tool-call 消息补占位。 */
function backfillToolCallReasoningPlaceholders(messages: Obj[]): void {
  for (const message of messages) {
    const isAssistantToolCall =
      message['role'] === 'assistant' &&
      Array.isArray(message['tool_calls']) &&
      message['tool_calls'].length > 0;
    if (isAssistantToolCall) ensureToolCallReasoningContent(message);
  }
}

function ensureToolCallReasoningContent(message: Obj): void {
  const existing = message['reasoning_content'];
  const has = typeof existing === 'string' && existing.trim().length > 0;
  if (!has) message['reasoning_content'] = 'tool call';
}

function attachReasoningToLastAssistant(
  messages: Obj[],
  lastAssistantIndex: number | undefined,
  reasoning: string | undefined,
): boolean {
  const trimmed = reasoning?.trim();
  if (!trimmed) return true; // 无内容，视为已处理。
  if (lastAssistantIndex === undefined) return false;
  const message = messages[lastAssistantIndex];
  if (!message || message['role'] !== 'assistant') return false;
  appendReasoningContent(message, trimmed);
  return true;
}

function responsesContentToChatContent(content: JsonValue): JsonValue {
  if (content === null || typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;

  const chatParts: Obj[] = [];
  let hasNonText = false;

  for (const part of content) {
    if (!isPlainObject(part)) continue;
    const partType = getStr(part['type']) ?? '';
    if (partType === 'input_text' || partType === 'output_text' || partType === 'text') {
      const text = getStr(part['text']);
      if (text) chatParts.push({ type: 'text', text });
    } else if (partType === 'refusal') {
      const text = getStr(part['refusal']);
      if (text) chatParts.push({ type: 'text', text });
    } else if (partType === 'input_image') {
      const imageUrl = part['image_url'];
      if (imageUrl !== undefined) {
        const normalized = isPlainObject(imageUrl)
          ? imageUrl
          : { url: getStr(imageUrl) ?? '' };
        chatParts.push({ type: 'image_url', image_url: normalized });
        hasNonText = true;
      }
    }
  }

  if (!hasNonText) {
    return chatParts
      .map((p) => getStr(p['text']))
      .filter((t): t is string => Boolean(t))
      .join('\n');
  }
  return chatParts;
}

function responsesFunctionCallToChatToolCall(item: Obj): Obj {
  const callId = getStr(item['call_id']) ?? getStr(item['id']) ?? '';
  const name = getStr(item['name']) ?? '';
  const args = canonicalizeToolArguments(item['arguments']);
  return {
    id: callId,
    type: 'function',
    function: { name, arguments: args },
  };
}

function responsesToolToChatTool(tool: JsonValue): Obj | undefined {
  if (!isPlainObject(tool)) return undefined;
  if (tool['type'] !== 'function') return undefined;

  if (tool['function'] !== undefined) {
    const chatTool: Obj = { ...tool };
    if (tool['strict'] !== undefined && isPlainObject(chatTool['function'])) {
      const fn = chatTool['function'] as Obj;
      if (fn['strict'] === undefined) fn['strict'] = tool['strict'];
      delete chatTool['strict'];
    }
    return chatTool;
  }

  const fn: Obj = {
    name: getStr(tool['name']) ?? '',
    description: tool['description'] ?? null,
    parameters: tool['parameters'] ?? {},
  };
  if (tool['strict'] !== undefined) fn['strict'] = tool['strict'];
  return { type: 'function', function: fn };
}

function responsesToolChoiceToChat(toolChoice: JsonValue): JsonValue {
  if (isPlainObject(toolChoice) && toolChoice['type'] === 'function') {
    return {
      type: 'function',
      function: { name: getStr(toolChoice['name']) ?? '' },
    };
  }
  return toolChoice;
}
