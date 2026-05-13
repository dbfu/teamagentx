// 统一导出入口 - 保持与原 agent.handler.ts 相同的导出接口

// 从 cache 导出
export {
  executorCache,
  processingMap,
  abortControllers,
  streamEventsCache,
  getCachedStreamEvents,
  clearCachedStreamEvents,
  stopAgentExecution,
  clearAllExecutionState,
  getCacheKey,
} from './cache.js';

// 从 status 导出
export {
  type AgentStatus,
  getAgentStatus,
  getAgentStatuses,
  broadcastAgentStatus,
  broadcastAgentTaskQueue,
} from './status.js';

// 从 executor-manager 导出
export {
  getExecutor,
  clearExecutorCache,
  getAgentDebugInfo,
  _testInjectDebugInfo,
  initAgents,
} from './executor-manager.js';

// 从 processor 导出
export {
  processQueue,
  recoverPendingTasks,
} from './processor.js';

// 从 handler 导出
export {
  messageEventEmitter,
  setupAIHandlers,
} from './handler.js';

// 从 message-utils 导出
export {
  buildAIMessage,
  broadcastCronTriggerMessage,
  broadcastAgentJoinedMessage,
  parseMentions,
} from './message-utils.js';

// 从 debug 导出
export {
  debugLog,
} from './debug.js';

// 从 claude-sdk.executor 导出
export { clearClaudeSdkFileSystemContext } from '../claude-sdk.executor.js';

// 从 codex-sdk.executor 导出
export { clearCodexSdkFileSystemContext } from '../codex-sdk.executor.js';