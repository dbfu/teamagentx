/**
 * OpenAI Chat Completions SSE → OpenAI Responses SSE 转换。
 * 移植自 cc-switch `proxy/providers/streaming_codex_chat.rs`。
 *
 * 用法：每收到一段上游字节，调用 `push(chunk)` 拿到要写给 Codex 客户端的 Responses SSE
 * 字符串数组；上游结束后调用 `end()`。内部状态机负责把 chat 的增量重组成 Responses 事件。
 */

import type { JsonValue } from './json-canonical.js';
import { canonicalizeToolArgumentsStr, isPlainObject } from './json-canonical.js';
import {
  extractReasoningFieldText,
  responseFunctionCallItem,
  splitLeadingThinkBlock,
  stripLeadingThinkOpenTag,
} from './common.js';
import {
  chatUsageToResponsesUsage,
  responseIdFromChatId,
  responseStatusFromFinishReason,
} from './transform-response.js';

type Obj = Record<string, JsonValue>;

function getStr(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNum(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function sseEvent(event: string, data: JsonValue): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type InlineThinkMode = 'detecting' | 'reasoning' | 'text';
type ThinkPrefixDecision = 'need_more' | 'reasoning' | 'text';

function leadingThinkPrefixDecision(buffer: string): ThinkPrefixDecision {
  const trimmed = buffer.trimStart();
  if (!trimmed) return 'need_more';
  if (trimmed.startsWith('<think>')) return 'reasoning';
  if ('<think>'.startsWith(trimmed)) return 'need_more';
  return 'text';
}

interface ToolCallState {
  outputIndex?: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  reasoningContent: string;
  added: boolean;
  done: boolean;
}

function newToolCallState(): ToolCallState {
  return {
    itemId: '',
    callId: '',
    name: '',
    arguments: '',
    reasoningContent: '',
    added: false,
    done: false,
  };
}

class ChatToResponsesState {
  private responseStarted = false;
  private completed = false;
  private responseId = 'resp_teamagentx';
  private model = '';
  private createdAt = 0;
  private nextIndex = 0;

  private text = { outputIndex: undefined as number | undefined, itemId: '', text: '', added: false, done: false };
  private reasoning = { outputIndex: undefined as number | undefined, itemId: '', text: '', added: false, done: false };
  private inlineMode: InlineThinkMode = 'detecting';
  private inlineBuffer = '';
  private tools = new Map<number, ToolCallState>();
  private outputItems: Array<[number, Obj]> = [];
  private latestUsage: Obj | undefined;
  private finishReason: string | undefined;

  handleChatChunk(chunk: Obj): string[] {
    const events: string[] = [];

    const id = getStr(chunk['id']);
    if (id) this.responseId = responseIdFromChatId(id);
    const model = getStr(chunk['model']);
    if (model) this.model = model;
    const created = getNum(chunk['created']);
    if (created !== undefined) this.createdAt = created;

    events.push(...this.ensureResponseStarted());

    if (chunk['usage'] !== undefined && chunk['usage'] !== null) {
      this.latestUsage = chatUsageToResponsesUsage(chunk['usage']);
    }

    const choices = chunk['choices'];
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    if (!isPlainObject(choice)) return events;

    const delta = choice['delta'];
    if (isPlainObject(delta)) {
      const reasoning = extractReasoningFieldText(delta);
      if (reasoning) events.push(...this.pushReasoningDelta(reasoning));

      const content = getStr(delta['content']);
      if (content) events.push(...this.pushContentDelta(content));

      const toolCalls = delta['tool_calls'];
      if (Array.isArray(toolCalls)) {
        events.push(...this.flushInlineThinkAtBoundary());
        const reasoningForToolCall = this.currentReasoningText();
        events.push(...this.finalizeReasoning());
        for (const toolCall of toolCalls) {
          events.push(...this.pushToolCallDelta(toolCall, reasoningForToolCall));
        }
      }
    }

    const finishReason = getStr(choice['finish_reason']);
    if (finishReason) this.finishReason = finishReason;

    return events;
  }

  private pushContentDelta(delta: string): string[] {
    if (this.inlineMode === 'text') {
      const events = this.finalizeReasoning();
      events.push(...this.pushTextDelta(delta));
      return events;
    }
    if (this.inlineMode === 'detecting') {
      this.inlineBuffer += delta;
      switch (leadingThinkPrefixDecision(this.inlineBuffer)) {
        case 'need_more':
          return [];
        case 'reasoning':
          this.inlineMode = 'reasoning';
          return this.drainCompleteInlineThink();
        case 'text': {
          this.inlineMode = 'text';
          const text = this.inlineBuffer;
          this.inlineBuffer = '';
          const events = this.finalizeReasoning();
          events.push(...this.pushTextDelta(text));
          return events;
        }
      }
    }
    // reasoning
    this.inlineBuffer += delta;
    return this.drainCompleteInlineThink();
  }

  private drainCompleteInlineThink(): string[] {
    const split = splitLeadingThinkBlock(this.inlineBuffer);
    if (!split) return [];
    const [reasoning, answer] = split;
    this.inlineMode = 'text';
    this.inlineBuffer = '';

    const events: string[] = [];
    if (reasoning) {
      events.push(...this.pushReasoningDelta(reasoning));
      events.push(...this.finalizeReasoning());
    }
    if (answer) events.push(...this.pushTextDelta(answer));
    return events;
  }

  private flushInlineThinkAtBoundary(): string[] {
    if (this.inlineMode === 'text') return [];
    if (this.inlineMode === 'detecting') {
      this.inlineMode = 'text';
      const text = this.inlineBuffer;
      this.inlineBuffer = '';
      if (!text) return [];
      const events = this.finalizeReasoning();
      events.push(...this.pushTextDelta(text));
      return events;
    }
    // reasoning
    const buffered = this.inlineBuffer;
    this.inlineBuffer = '';
    this.inlineMode = 'text';
    const split = splitLeadingThinkBlock(buffered);
    if (split) {
      const [reasoning, answer] = split;
      const events: string[] = [];
      if (reasoning) {
        events.push(...this.pushReasoningDelta(reasoning));
        events.push(...this.finalizeReasoning());
      }
      if (answer) events.push(...this.pushTextDelta(answer));
      return events;
    }
    const reasoning = stripLeadingThinkOpenTag(buffered) ?? buffered;
    if (!reasoning) return [];
    const events = this.pushReasoningDelta(reasoning);
    events.push(...this.finalizeReasoning());
    return events;
  }

  private ensureResponseStarted(): string[] {
    if (this.responseStarted) return [];
    this.responseStarted = true;
    return [
      sseEvent('response.created', {
        type: 'response.created',
        response: this.baseResponse('in_progress', []),
      }),
      sseEvent('response.in_progress', {
        type: 'response.in_progress',
        response: this.baseResponse('in_progress', []),
      }),
    ];
  }

  private pushReasoningDelta(delta: string): string[] {
    const events: string[] = [];

    if (!this.reasoning.added) {
      const outputIndex = this.nextOutputIndex();
      const itemId = `rs_${this.responseId}`;
      this.reasoning.outputIndex = outputIndex;
      this.reasoning.itemId = itemId;
      this.reasoning.added = true;

      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: { id: itemId, type: 'reasoning', status: 'in_progress', summary: [] },
        }),
      );
      events.push(
        sseEvent('response.reasoning_summary_part.added', {
          type: 'response.reasoning_summary_part.added',
          item_id: itemId,
          output_index: outputIndex,
          summary_index: 0,
          part: { type: 'summary_text', text: '' },
        }),
      );
    }

    this.reasoning.text += delta;
    const outputIndex = this.reasoning.outputIndex ?? 0;
    events.push(
      sseEvent('response.reasoning_summary_text.delta', {
        type: 'response.reasoning_summary_text.delta',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        delta,
      }),
    );
    return events;
  }

  private pushTextDelta(delta: string): string[] {
    const events: string[] = [];

    if (!this.text.added) {
      const outputIndex = this.nextOutputIndex();
      const itemId = `${this.responseId}_msg`;
      this.text.outputIndex = outputIndex;
      this.text.itemId = itemId;
      this.text.added = true;

      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
        }),
      );
      events.push(
        sseEvent('response.content_part.added', {
          type: 'response.content_part.added',
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: 'output_text', text: '', annotations: [] },
        }),
      );
    }

    this.text.text += delta;
    const outputIndex = this.text.outputIndex ?? 0;
    events.push(
      sseEvent('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        delta,
      }),
    );
    return events;
  }

  private currentReasoningText(): string | undefined {
    return this.reasoning.text.trim() ? this.reasoning.text.trim() : undefined;
  }

  private pushToolCallDelta(toolCall: JsonValue, reasoning: string | undefined): string[] {
    if (!isPlainObject(toolCall)) return [];
    const chatIndex = getNum(toolCall['index']) ?? 0;
    const idDelta = getStr(toolCall['id']);
    const fn = isPlainObject(toolCall['function']) ? toolCall['function'] : {};
    const nameDelta = getStr(fn['name']);
    const argsDelta = getStr(fn['arguments']) ?? '';

    let state = this.tools.get(chatIndex);
    if (!state) {
      state = newToolCallState();
      this.tools.set(chatIndex, state);
    }
    if (idDelta) state.callId = idDelta;
    if (nameDelta) state.name = nameDelta;
    if (argsDelta) state.arguments += argsDelta;
    if (!state.reasoningContent) {
      const r = reasoning?.trim();
      if (r) state.reasoningContent = r;
    }

    const shouldAdd = !state.added && (state.callId !== '' || state.name !== '');
    const events: string[] = [];

    if (shouldAdd) {
      const assigned = this.nextOutputIndex();
      state.added = true;
      if (!state.callId) state.callId = `call_${chatIndex}`;
      if (!state.name) state.name = 'unknown_tool';
      state.outputIndex = assigned;
      state.itemId = `fc_${state.callId}`;
      const pendingArguments = state.arguments;

      const item = responseFunctionCallItem(
        state.itemId,
        'in_progress',
        state.callId,
        state.name,
        '',
        state.reasoningContent || undefined,
      );
      events.push(
        sseEvent('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: assigned,
          item,
        }),
      );
      if (pendingArguments) {
        events.push(
          sseEvent('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: state.itemId,
            output_index: assigned,
            delta: pendingArguments,
          }),
        );
      }
    } else if (argsDelta && state.added && state.outputIndex !== undefined) {
      events.push(
        sseEvent('response.function_call_arguments.delta', {
          type: 'response.function_call_arguments.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: argsDelta,
        }),
      );
    }

    return events;
  }

  finalize(): string[] {
    if (this.completed) return [];

    const events = this.ensureResponseStarted();
    events.push(...this.flushInlineThinkAtBoundary());
    events.push(...this.finalizeReasoning());
    events.push(...this.finalizeText());
    events.push(...this.finalizeTools());

    const status = responseStatusFromFinishReason(this.finishReason);
    const response = this.baseResponse(status, this.completedOutputItems());
    if (status === 'incomplete') {
      response['incomplete_details'] = { reason: 'max_output_tokens' };
    }

    events.push(
      sseEvent('response.completed', { type: 'response.completed', response }),
    );
    this.completed = true;
    return events;
  }

  private finalizeReasoning(): string[] {
    if (!this.reasoning.added || this.reasoning.done) return [];

    const outputIndex = this.reasoning.outputIndex ?? 0;
    const text = this.reasoning.text;
    const item: Obj = {
      id: this.reasoning.itemId,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text }],
    };
    this.outputItems.push([outputIndex, item]);
    this.reasoning.done = true;

    return [
      sseEvent('response.reasoning_summary_text.done', {
        type: 'response.reasoning_summary_text.done',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        text,
      }),
      sseEvent('response.reasoning_summary_part.done', {
        type: 'response.reasoning_summary_part.done',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text },
      }),
      sseEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item,
      }),
    ];
  }

  private finalizeText(): string[] {
    if (!this.text.added || this.text.done) return [];

    const outputIndex = this.text.outputIndex ?? 0;
    const text = this.text.text;
    const item: Obj = {
      id: this.text.itemId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    };
    this.outputItems.push([outputIndex, item]);
    this.text.done = true;

    return [
      sseEvent('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        text,
      }),
      sseEvent('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: 'output_text', text, annotations: [] },
      }),
      sseEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item,
      }),
    ];
  }

  private finalizeTools(): string[] {
    const events: string[] = [];
    const keys = [...this.tools.keys()].sort((a, b) => a - b);

    for (const key of keys) {
      const state = this.tools.get(key);
      if (!state || state.done) continue;

      if (!state.added) {
        const assigned = this.nextOutputIndex();
        state.added = true;
        if (!state.callId) state.callId = `call_${key}`;
        if (!state.name) state.name = 'unknown_tool';
        state.outputIndex = assigned;
        state.itemId = `fc_${state.callId}`;
        const item = responseFunctionCallItem(
          state.itemId,
          'in_progress',
          state.callId,
          state.name,
          '',
          state.reasoningContent || undefined,
        );
        events.push(
          sseEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: assigned,
            item,
          }),
        );
      }

      const outputIndex = state.outputIndex ?? 0;
      const args = canonicalizeToolArgumentsStr(state.arguments);
      const item = responseFunctionCallItem(
        state.itemId,
        'completed',
        state.callId,
        state.name,
        args,
        state.reasoningContent || undefined,
      );
      state.done = true;
      this.outputItems.push([outputIndex, item]);

      events.push(
        sseEvent('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: state.itemId,
          output_index: outputIndex,
          arguments: args,
        }),
      );
      events.push(
        sseEvent('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item,
        }),
      );
    }

    return events;
  }

  private completedOutputItems(): Obj[] {
    return [...this.outputItems]
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => item);
  }

  private baseResponse(status: string, output: Obj[]): Obj {
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.createdAt,
      status,
      model: this.model,
      output,
      usage: this.latestUsage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
  }

  private nextOutputIndex(): number {
    return this.nextIndex++;
  }

  failedEvent(message: string, errorType: string | undefined): string {
    this.completed = true;
    const error: Obj = { message };
    if (errorType) error['type'] = errorType;
    const response = this.baseResponse('failed', this.completedOutputItems());
    response['error'] = error;
    return sseEvent('response.failed', { type: 'response.failed', response });
  }

  isCompleted(): boolean {
    return this.completed;
  }
}

function extractChatSseError(value: JsonValue): [string, string | undefined] {
  const error = isPlainObject(value) && value['error'] !== undefined ? value['error'] : value;
  let message: string;
  if (typeof error === 'string') message = error;
  else if (isPlainObject(error)) {
    message =
      getStr(error['message']) ?? getStr(error['detail']) ?? JSON.stringify(error);
  } else message = JSON.stringify(error);

  const errorType = isPlainObject(error)
    ? getStr(error['type']) ?? getStr(error['code'])
    : undefined;
  return [message, errorType];
}

/**
 * 流式转换器：把上游 Chat SSE 字节增量喂进来，得到要写给客户端的 Responses SSE 字符串。
 * 自带 SSE 分块解析（按空行切 event/data 块），处理跨 chunk 的不完整数据。
 */
export class ChatToResponsesSseConverter {
  private buffer = '';
  private state = new ChatToResponsesState();
  private streamFailed = false;

  /** 喂入一段上游文本，返回要转发给客户端的 Responses SSE 片段。 */
  push(chunk: string): string {
    if (this.streamFailed || this.state.isCompleted()) return '';
    this.buffer += chunk;
    const out: string[] = [];

    let block: string | undefined;
    while ((block = this.takeSseBlock()) !== undefined) {
      if (!block.trim()) continue;

      let eventName: string | undefined;
      const dataParts: string[] = [];
      for (const line of block.split('\n')) {
        const ev = stripSseField(line, 'event');
        if (ev !== undefined) eventName = ev.trim();
        const data = stripSseField(line, 'data');
        if (data !== undefined) dataParts.push(data);
      }
      if (dataParts.length === 0) continue;

      const data = dataParts.join('\n');
      if (data.trim() === '[DONE]') {
        out.push(...this.state.finalize());
        continue;
      }

      let parsed: JsonValue;
      try {
        parsed = JSON.parse(data) as JsonValue;
      } catch {
        continue;
      }

      if (eventName === 'error' || (isPlainObject(parsed) && parsed['error'] !== undefined)) {
        const [message, errorType] = extractChatSseError(parsed);
        out.push(this.state.failedEvent(message, errorType));
        this.streamFailed = true;
        break;
      }

      if (isPlainObject(parsed)) {
        out.push(...this.state.handleChatChunk(parsed));
      }
    }

    return out.join('');
  }

  /** 上游结束时调用，补齐 finalize 事件（若上游未发 [DONE]）。 */
  end(): string {
    if (this.streamFailed || this.state.isCompleted()) return '';
    return this.state.finalize().join('');
  }

  /** 上游异常中断时调用。 */
  fail(message: string): string {
    if (this.streamFailed || this.state.isCompleted()) return '';
    this.streamFailed = true;
    return this.state.failedEvent(message, 'stream_error');
  }

  /** 从缓冲里取一个完整 SSE 块（以空行分隔）。 */
  private takeSseBlock(): string | undefined {
    const normalized = this.buffer.replace(/\r\n/g, '\n');
    const sepIndex = normalized.indexOf('\n\n');
    if (sepIndex < 0) {
      this.buffer = normalized;
      return undefined;
    }
    const block = normalized.slice(0, sepIndex);
    this.buffer = normalized.slice(sepIndex + 2);
    return block;
  }
}

function stripSseField(line: string, field: string): string | undefined {
  if (!line.startsWith(field)) return undefined;
  const rest = line.slice(field.length);
  if (rest.startsWith(': ')) return rest.slice(2);
  if (rest.startsWith(':')) return rest.slice(1);
  if (rest.length === 0) return '';
  return undefined;
}
