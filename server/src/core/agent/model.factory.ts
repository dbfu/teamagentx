import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import type { LlmProvider } from '@prisma/client';

/**
 * 判断是否是 OpenAI reasoning 模型
 * 根据 LangChain isReasoningModel 的逻辑：o1/o3/o4-mini/gpt-5 系列
 */
function isOpenAIReasoningModel(model: string): boolean {
  if (!model) return false;
  // o1, o3, o4-mini 等系列
  if (/^o\d/.test(model)) return true;
  // gpt-5 系列（排除 gpt-5-chat）
  if (model.startsWith('gpt-5') && !model.startsWith('gpt-5-chat')) return true;
  return false;
}

/**
 * 判断错误是否是因为不支持思考模式
 */
export function isThinkingUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  // 百炼错误：model `xxx` is not supported（当启用 enable_thinking 但模型不支持时）
  // 或者包含 enable_thinking 相关的错误
  return (
    message.includes('is not supported') ||
    message.includes('enable_thinking') ||
    message.includes('thinking') ||
    message.includes('invalid_parameter')
  );
}

/**
 * 创建 LLM 模型实例
 * 根据 LLM Provider 配置返回对应的 ChatAnthropic 或 ChatOpenAI 实例
 */
export function createModel(
  provider: LlmProvider,
  agentName: string,
): ChatAnthropic | ChatOpenAI {
  // apiProtocol 决定使用哪种 API 协议（anthropic 或 openai-compatible）
  const apiProtocol = (provider as any).apiProtocol || 'anthropic';
  // supportsThinking: null 表示未检测，false 表示不支持，true 表示支持
  const supportsThinking = (provider as any).supportsThinking;

  console.log(
    `${agentName}: 使用 LLM Provider ${provider.name} (${provider.type}, protocol=${apiProtocol}, model=${provider.model}, supportsThinking=${supportsThinking})`,
  );

  switch (apiProtocol) {
    case 'anthropic':
      return new ChatAnthropic({
        model: provider.model,
        apiKey: provider.apiKey,
        thinking: { type: 'enabled', budget_tokens: 16000 },
        maxTokens: 16384,
        // 启用流式 token 使用统计
        streamUsage: true,
        // 启用 prompt-caching beta 来获取详细 token 统计
        betas: ['prompt-caching-2024-04-01'],
        ...(provider.apiUrl && { anthropicApiUrl: provider.apiUrl }),
      });

    case 'openai':
    default:
      // 检查是否是 OpenAI reasoning 模型
      const isOpenAIReasoning = isOpenAIReasoningModel(provider.model);

      // 默认启用思考模式，除非已标记不支持
      // supportsThinking: null 或 true 时启用，false 时禁用
      const shouldEnableThinking = supportsThinking !== false;

      console.log(
        `${agentName}: OpenAI 协议配置 - reasoning=${isOpenAIReasoning}, enable_thinking=${shouldEnableThinking}`,
      );

      const openAIConfig: Record<string, any> = {
        model: provider.model,
        apiKey: provider.apiKey,
        // 为 OpenAI reasoning 模型配置 reasoning_effort
        ...(isOpenAIReasoning && {
          reasoning: { effort: 'medium' as const },
        }),
        // 默认启用 enable_thinking（通过 modelKwargs）
        // 如果模型不支持，会在运行时报错，然后标记 supportsThinking=false
        ...(shouldEnableThinking && {
          modelKwargs: { enable_thinking: true },
        }),
        // 启用原始响应保存，以便获取 reasoning_content 等非标准字段
        __includeRawResponse: true,
        ...(provider.apiUrl && { configuration: { baseURL: provider.apiUrl } }),
      };

      return new ChatOpenAI(openAIConfig as any);
  }
}