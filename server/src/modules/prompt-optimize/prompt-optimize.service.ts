import type { FastifyReply } from 'fastify';
import { createLlmClient } from '../../lib/llm-client.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';

// System prompt for prompt optimization.
const OPTIMIZE_SYSTEM_PROMPT = `You are an expert at optimizing AI assistant prompts. Improve the user's prompt so that it:
1. Is clearer and more structured.
2. Includes a clear role definition.
3. Includes concrete behavioral guidance.
4. Preserves the original intent.
5. Preserves or adds this TeamAgentX collaboration rule when relevant: a single message may contain at most one triggerable @assistant mention. If multiple assistants could help, choose one next target or ask the user to choose, and refer to any additional assistants by name without @.

Output only the optimized prompt. Do not add explanations or commentary.`;

export const promptOptimizeService = {
  /**
   * 使用 AI 优化提示词（非流式）
   * @param prompt 原始提示词
   * @returns 优化后的提示词
   */
  async optimize(prompt: string): Promise<string> {
    // 获取默认 LLM Provider
    const provider = await llmProviderService.findDefault();
    if (!provider) {
      throw new Error('未找到默认 LLM Provider，请先在设置中配置');
    }

    const model = createLlmClient(provider, { temperature: 0.7 });

    // 构建消息
    const messages = [
      {role: 'system', content: OPTIMIZE_SYSTEM_PROMPT},
      {role: 'user', content: prompt},
    ];

    // 调用 LLM
    const content = await model.invoke(messages as any);

    return content.trim();
  },

  /**
   * 使用 AI 优化提示词（流式输出）
   * @param prompt 原始提示词
   * @param reply Fastify reply 对象，用于 SSE 响应
   */
  async optimizeStream(prompt: string, reply: FastifyReply): Promise<void> {
    // 获取默认 LLM Provider
    const provider = await llmProviderService.findDefault();
    if (!provider) {
      reply.raw.write(
        `data: ${JSON.stringify({error: '未找到默认 LLM Provider，请先在设置中配置'})}\n\n`,
      );
      reply.raw.end();
      return;
    }

    const model = createLlmClient(provider, { temperature: 0.7 });

    // 构建消息
    const messages = [
      {role: 'system', content: OPTIMIZE_SYSTEM_PROMPT},
      {role: 'user', content: prompt},
    ];

    // 设置 SSE 响应头（包括 CORS）
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // 流式调用 LLM
      for await (const content of model.stream(messages as any)) {
        if (content) {
          // 发送 SSE 事件
          reply.raw.write(`data: ${JSON.stringify({content})}\n\n`);
        }
      }

      // 发送结束事件
      reply.raw.write(`data: ${JSON.stringify({done: true})}\n\n`);
    } catch (error: any) {
      console.error('[OptimizePrompt] 流式优化失败:', error);
      reply.raw.write(
        `data: ${JSON.stringify({error: error.message || '优化失败'})}\n\n`,
      );
    } finally {
      reply.raw.end();
    }
  },
};
