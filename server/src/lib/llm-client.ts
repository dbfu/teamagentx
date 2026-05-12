import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from '@prisma/client';
import OpenAI from 'openai';

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmClientOptions = {
  temperature?: number;
  maxTokens?: number;
};

export type LlmClient = {
  invoke(input: string | LlmMessage[]): Promise<string>;
  stream(input: string | LlmMessage[]): AsyncGenerator<string>;
};

function normalizeMessages(input: string | LlmMessage[]): LlmMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  return input;
}

function splitSystemMessages(messages: LlmMessage[]): {
  system: string | undefined;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n') || undefined;

  return {
    system,
    messages: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
  };
}

function textFromAnthropicContent(content: Anthropic.Messages.Message['content']): string {
  return content
    .map((item) => (item.type === 'text' ? item.text : ''))
    .join('')
    .trim();
}

function createAnthropicClient(provider: LlmProvider, options: LlmClientOptions): LlmClient {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: provider.apiUrl || undefined,
  });

  return {
    async invoke(input) {
      const normalized = splitSystemMessages(normalizeMessages(input));
      const response = await client.messages.create({
        model: provider.model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
        system: normalized.system,
        messages: normalized.messages,
      });
      return textFromAnthropicContent(response.content);
    },

    async *stream(input) {
      const normalized = splitSystemMessages(normalizeMessages(input));
      const stream = await client.messages.create({
        model: provider.model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
        system: normalized.system,
        messages: normalized.messages,
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }
    },
  };
}

function createOpenAIClient(provider: LlmProvider, options: LlmClientOptions): LlmClient {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.apiUrl || undefined,
  });

  return {
    async invoke(input) {
      const response = await client.chat.completions.create({
        model: provider.model,
        messages: normalizeMessages(input),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      });
      return (response.choices[0]?.message?.content || '').trim();
    },

    async *stream(input) {
      const stream = await client.chat.completions.create({
        model: provider.model,
        messages: normalizeMessages(input),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (typeof content === 'string' && content) {
          yield content;
        }
      }
    },
  };
}

export function createLlmClient(provider: LlmProvider, options: LlmClientOptions = {}): LlmClient {
  const protocol = ((provider as any).apiProtocol || 'anthropic').toLowerCase();
  return protocol === 'anthropic'
    ? createAnthropicClient(provider, options)
    : createOpenAIClient(provider, options);
}
