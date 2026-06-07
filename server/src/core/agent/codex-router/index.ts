/**
 * Codex 路由模式：Responses ⇄ Chat Completions 转换。
 *
 * 当 codex provider 仅支持 Chat Completions（LlmProvider.codexWireApi === 'chat'）时，
 * codex 客户端仍以 Responses 协议发请求到本地网关，由这里的纯函数完成双向转换。
 * 移植自 cc-switch 的 codex_chat 转换实现。
 */

export type { JsonValue } from './json-canonical.js';
export {
  responsesToChatCompletions,
} from './transform-request.js';
export {
  chatCompletionToResponse,
  chatErrorToResponseError,
  CodexRouterTransformError,
} from './transform-response.js';
export { ChatToResponsesSseConverter } from './transform-stream.js';
export {
  inferCodexChatReasoningConfig,
  type CodexChatReasoningConfig,
  type ReasoningProviderHint,
} from './reasoning-config.js';
