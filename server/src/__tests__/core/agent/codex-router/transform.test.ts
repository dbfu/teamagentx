import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  chatCompletionToResponse,
  chatErrorToResponseError,
  ChatToResponsesSseConverter,
  inferCodexChatReasoningConfig,
  responsesToChatCompletions,
} from '../../../../core/agent/codex-router/index.js';

type Obj = Record<string, any>;

describe('codex-router 请求转换 Responses → Chat Completions', () => {
  test('instructions → system，input 字符串 → user 消息', () => {
    const chat = responsesToChatCompletions({
      model: 'deepseek-chat',
      instructions: 'You are helpful.',
      input: 'hello',
    }) as Obj;

    assert.deepStrictEqual(chat.messages, [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'hello' },
    ]);
    assert.strictEqual(chat.model, 'deepseek-chat');
  });

  test('max_output_tokens 映射为 max_tokens（非 o-series）', () => {
    const chat = responsesToChatCompletions({ model: 'gpt-4o', max_output_tokens: 256 }) as Obj;
    assert.strictEqual(chat.max_tokens, 256);
    assert.strictEqual(chat.max_completion_tokens, undefined);
  });

  test('o-series 用 max_completion_tokens', () => {
    const chat = responsesToChatCompletions({ model: 'o3', max_output_tokens: 256 }) as Obj;
    assert.strictEqual(chat.max_completion_tokens, 256);
  });

  test('流式自动注入 stream_options.include_usage', () => {
    const chat = responsesToChatCompletions({ model: 'm', input: 'x', stream: true }) as Obj;
    assert.deepStrictEqual(chat.stream_options, { include_usage: true });
  });

  test('function_call + function_call_output → assistant tool_calls + tool 消息', () => {
    const chat = responsesToChatCompletions({
      model: 'm',
      input: [
        { type: 'message', role: 'user', content: 'do it' },
        { type: 'function_call', call_id: 'c1', name: 'run', arguments: '{"a":1}' },
        { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
      ],
    }) as Obj;

    const [, assistant, tool] = chat.messages;
    assert.strictEqual(assistant.role, 'assistant');
    assert.strictEqual(assistant.tool_calls[0].id, 'c1');
    assert.strictEqual(assistant.tool_calls[0].function.name, 'run');
    // tool-call 消息补占位 reasoning_content
    assert.strictEqual(assistant.reasoning_content, 'tool call');
    assert.strictEqual(tool.role, 'tool');
    assert.strictEqual(tool.tool_call_id, 'c1');
  });

  test('Responses 工具定义 → Chat 工具定义', () => {
    const chat = responsesToChatCompletions({
      model: 'm',
      tools: [{ type: 'function', name: 'get', description: 'd', parameters: { type: 'object' } }],
    }) as Obj;
    assert.deepStrictEqual(chat.tools[0], {
      type: 'function',
      function: { name: 'get', description: 'd', parameters: { type: 'object' } },
    });
  });

  test('deepseek reasoning：注入 thinking 与 reasoning_effort', () => {
    const config = inferCodexChatReasoningConfig({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
    const chat = responsesToChatCompletions(
      { model: 'deepseek-chat', input: 'x', reasoning: { effort: 'high' } },
      config,
    ) as Obj;
    assert.deepStrictEqual(chat.thinking, { type: 'enabled' });
    assert.strictEqual(chat.reasoning_effort, 'high');
  });
});

describe('codex-router 非流式响应转换 Chat → Responses', () => {
  test('普通文本响应', () => {
    const resp = chatCompletionToResponse({
      id: 'chatcmpl-1',
      model: 'm',
      created: 100,
      choices: [{ message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    }) as Obj;

    assert.strictEqual(resp.id, 'resp_chatcmpl-1');
    assert.strictEqual(resp.status, 'completed');
    const msg = resp.output.find((i: Obj) => i.type === 'message');
    assert.strictEqual(msg.content[0].text, 'hi there');
    assert.strictEqual(resp.usage.input_tokens, 5);
    assert.strictEqual(resp.usage.output_tokens, 3);
  });

  test('tool_calls 响应 → function_call output item', () => {
    const resp = chatCompletionToResponse({
      id: 'x',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'run', arguments: '{"a":1}' } }],
        },
        finish_reason: 'tool_calls',
      }],
    }) as Obj;
    const fc = resp.output.find((i: Obj) => i.type === 'function_call');
    assert.strictEqual(fc.call_id, 'call_1');
    assert.strictEqual(fc.name, 'run');
    assert.strictEqual(fc.arguments, '{"a":1}');
  });

  test('finish_reason=length → incomplete', () => {
    const resp = chatCompletionToResponse({
      id: 'x',
      choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }],
    }) as Obj;
    assert.strictEqual(resp.status, 'incomplete');
    assert.deepStrictEqual(resp.incomplete_details, { reason: 'max_output_tokens' });
  });

  test('错误体规整（MiniMax base_resp）', () => {
    const err = chatErrorToResponseError({ base_resp: { status_code: 2013, status_msg: 'bad role' } }) as Obj;
    assert.strictEqual(err.error.message, 'bad role');
    assert.strictEqual(err.error.code, 2013);
  });

  test('错误体规整（裸字符串）', () => {
    const err = chatErrorToResponseError('Unauthorized') as Obj;
    assert.strictEqual(err.error.message, 'Unauthorized');
    assert.strictEqual(err.error.type, 'upstream_error');
  });
});

describe('codex-router 流式 SSE 转换 Chat → Responses', () => {
  function collect(chunks: string[]): string {
    const converter = new ChatToResponsesSseConverter();
    let out = '';
    for (const c of chunks) out += converter.push(c);
    out += converter.end();
    return out;
  }

  test('文本增量重组为 Responses 事件并以 response.completed 收尾', () => {
    const out = collect([
      'data: {"id":"c","model":"m","choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    assert.ok(out.includes('event: response.created'));
    assert.ok(out.includes('event: response.output_text.delta'));
    assert.ok(out.includes('"delta":"He"'));
    assert.ok(out.includes('"delta":"llo"'));
    assert.ok(out.includes('event: response.completed'));
  });

  test('tool_calls 流式 → function_call_arguments 事件', () => {
    const out = collect([
      'data: {"id":"c","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"run","arguments":"{\\"a\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":1}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    assert.ok(out.includes('event: response.function_call_arguments.delta'));
    assert.ok(out.includes('event: response.function_call_arguments.done'));
    assert.ok(out.includes('"name":"run"'));
  });

  test('上游 SSE error → response.failed', () => {
    const out = collect([
      'data: {"id":"c","choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"error":{"message":"boom","type":"server_error"}}\n\n',
    ]);
    assert.ok(out.includes('event: response.failed'));
    assert.ok(out.includes('"message":"boom"'));
  });

  test('内联 <think> 块 → reasoning summary 事件', () => {
    const out = collect([
      'data: {"id":"c","choices":[{"delta":{"content":"<think>"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"pondering</think>answer"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    assert.ok(out.includes('event: response.reasoning_summary_text.delta'));
    assert.ok(out.includes('"delta":"pondering"'));
    assert.ok(out.includes('"delta":"answer"'));
  });
});
