import type { Agent, LlmProvider } from '@prisma/client';
import type { IAgentExecutor, ChatRoomAgentInfo } from './executor.interface.js';
import { ClaudeAgentSdkExecutor } from './claude-sdk.executor.js';
import { CodexSdkExecutor } from './codex-sdk.executor.js';
import {
  DEFAULT_AGENT_THINKING_MODE,
  isAgentThinkingMode,
  type AgentThinkingMode,
} from './thinking-mode.js';

export interface CreateExecutorOptions {
  agent: Agent;
  chatRoomId: string;
  threadId: string;
  injectGroupHistory: boolean;
  chatRoomAgents: ChatRoomAgentInfo[];
  sessionDir?: string;  // 快速对话会话工作目录
  customWorkDir?: string;  // 群聊工作目录
  llmProvider?: LlmProvider;  // LLM 供应商配置
  imageGenerationProvider?: LlmProvider | null; // 默认图片模型配置
  lastInjectedMessageId?: string;  // 上次注入群历史的最后消息 ID（用于增量注入）
  chatRoomRules?: string;  // 群规则/指南
}

function getAgentThinkingMode(agent: Agent): AgentThinkingMode {
  return isAgentThinkingMode(agent.thinkingMode)
    ? agent.thinkingMode
    : DEFAULT_AGENT_THINKING_MODE;
}

/**
 * 根据助手类型创建对应的执行器
 */
export function createExecutor(options: CreateExecutorOptions): IAgentExecutor {
  const {
    agent,
    chatRoomId,
    injectGroupHistory,
    chatRoomAgents,
    sessionDir,
    customWorkDir,
    llmProvider,
    imageGenerationProvider,
    lastInjectedMessageId,
    chatRoomRules,
  } = options;
  const thinkingMode = getAgentThinkingMode(agent);

  switch (agent.type) {
    case 'acp':
      const acpTool = agent.acpTool || 'claude';
      if (acpTool === 'claude') {
        return new ClaudeAgentSdkExecutor(
          agent.name,
          agent.prompt,
          chatRoomId,
          agent.workDir,
          injectGroupHistory,
          agent.id,
          sessionDir,
          customWorkDir,
          lastInjectedMessageId,
          chatRoomAgents,
          llmProvider,
          imageGenerationProvider,
          thinkingMode,
          chatRoomRules,
        );
      }
      if (acpTool === 'codex') {
        return new CodexSdkExecutor(
          agent.name,
          agent.prompt,
          chatRoomId,
          agent.workDir,
          injectGroupHistory,
          agent.id,
          sessionDir,
          customWorkDir,
          lastInjectedMessageId,
          chatRoomAgents,
          llmProvider,
          imageGenerationProvider,
          agent.proxyConfig,
          agent.codexModel,
          thinkingMode,
          chatRoomRules,
        );
      }
      throw new Error(`Unsupported agent tool: ${acpTool}`);

    case 'builtin':
    default:
      return new ClaudeAgentSdkExecutor(
        agent.name,
        agent.prompt,
        chatRoomId,
        agent.workDir,
        injectGroupHistory,
        agent.id,  // 传递 agentId 用于 skills 目录
        sessionDir,
        customWorkDir,
        lastInjectedMessageId,  // 传递上次注入位置
        chatRoomAgents,
        (llmProvider as any)?.apiProtocol === 'anthropic' ? llmProvider : undefined,
        imageGenerationProvider,
        thinkingMode,
        chatRoomRules,
      );
  }
}
