import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';

// 重新导出 AttachmentData 供其他模块使用
export type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';

export interface AgentAction {
  type: 'message';
  content: string;
  target?: string;
}

// 历史消息类型
export interface HistoryMessage {
  content: string;
  senderName: string;
  isHuman: boolean;
  kind?: 'message' | 'memory_summary' | 'message_index';
  messageId?: string;
  time?: string;
  senderType?: 'user' | 'agent';
  preview?: string;
  attachments?: Array<{filename?: string | null; type?: string | null}>;
}

// 消息广播回调类型（异步，确保消息保存完成）
export type MessageEmitCallback = (
  content: string,
  replyMessageId?: string,
) => Promise<void>;

// 流式内容回调类型
export type StreamEmitCallback = (content: string) => void;

// 思考过程回调类型
export type ThinkingEmitCallback = (thinking: string) => void;

// 工具调用回调类型
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  toolCallId: string;
  status?: 'in_progress' | 'completed' | 'error';
  output?: string;  // 工具执行结果输出
  timestamp?: number;  // 执行时间戳
}

export type ToolCallEmitCallback = (toolCall: ToolCall) => void;

// Token 使用信息
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

// Agent 执行结果
export interface AgentExecResult {
  actions: AgentAction[];
  tokenUsage?: TokenUsage;  // Token 使用信息
}

// 群聊助手信息（包含工作目录）
export interface ChatRoomAgentInfo {
  name: string;
  agentId: string;  // 助手 ID（用于计算默认工作目录）
  workDir?: string | null;  // 助手配置的工作目录
  customWorkDir?: string | null;  // 群聊中的自定义工作目录
}

// Agent 调试信息接口（联合类型）
export type AgentDebugInfo = {
  name: string;
  systemPrompt: string;
  lastContext: string | null;
  lastInvokeResult?: string | null;
  lastResponse?: string | null;
  lastHistory: HistoryMessage[] | null;
  threadId?: string;
  chatRoomId: string;
  injectGroupHistory: boolean;
  chatRoomAgents?: ChatRoomAgentInfo[];
  type: 'acp';
  acpTool?: string;
  workDir?: string; // 工作目录
  agentId?: string | null;
  llmProvider?: {
    id: string;
    name: string;
    type: string;
    model: string;
  };
};

// Agent 执行器接口
export interface IAgentExecutor {
  // 只读属性
  readonly name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir?: string;
  readonly lastInjectedMessageId?: string;  // 上次注入群历史的最后消息 ID

  // 执行方法
  exec(
    message: string,
    emit: MessageEmitCallback,
    originalMessageId: string,
    history?: HistoryMessage[],
    emitStream?: StreamEmitCallback,
    emitToolCall?: ToolCallEmitCallback,
    emitThinking?: ThinkingEmitCallback,
    signal?: AbortSignal,
    attachments?: AttachmentData[],  // 图片附件（包含 base64）
  ): Promise<AgentExecResult>;

  // 获取调试信息
  getDebugInfo(): AgentDebugInfo;

  // 设置上次注入位置（用于增量注入）
  setLastInjectedMessageId(id: string): void;

  // 清理资源（可选，用于正确关闭 ACP 会话等）
  cleanup?: () => Promise<void>;
}
