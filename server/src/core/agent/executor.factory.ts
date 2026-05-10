import type { Agent, LlmProvider } from '@prisma/client';
import type { IAgentExecutor, ChatRoomAgentInfo } from './executor.interface.js';
import { LangChainAgentExecutor } from './langchain.executor.js';
import { AcpExecutor } from './acp.executor.js';
import { ClaudeAgentSdkExecutor } from './claude-sdk.executor.js';
import { CodexSdkExecutor } from './codex-sdk.executor.js';

// ACP 工具命令映射（来自 acpx AGENT_REGISTRY）
const ACP_TOOL_COMMANDS: Record<string, string | undefined> = {
  pi: 'npx pi-acp@^0.0.22',
  openclaw: 'openclaw acp --verbose --session agent:main:main',
  gemini: 'gemini --acp',
  cursor: 'cursor-agent acp',
  copilot: 'copilot --acp --stdio',
  droid: 'droid exec --output-format acp',
  iflow: 'iflow --experimental-acp',
  kilocode: 'npx -y @kilocode/cli acp',
  kimi: 'kimi acp',
  kiro: 'kiro-cli acp',
  opencode: 'npx -y opencode-ai acp',
  qwen: 'qwen --acp',
};

// 获取 ACP 工具命令
function getAcpToolCommand(tool: string): string {
  return ACP_TOOL_COMMANDS[tool] || tool;
}

export interface CreateExecutorOptions {
  agent: Agent;
  chatRoomId: string;
  threadId: string;
  injectGroupHistory: boolean;
  chatRoomAgents: ChatRoomAgentInfo[];
  sessionDir?: string;  // 快速对话会话工作目录
  customWorkDir?: string;  // 群聊工作目录
  llmProvider?: LlmProvider;  // LLM 供应商配置
  lastInjectedMessageId?: string;  // 上次注入群历史的最后消息 ID（用于增量注入）
  chatRoomRules?: string;  // 群规则/指南
}

/**
 * 根据助手类型创建对应的执行器
 */
export function createExecutor(options: CreateExecutorOptions): IAgentExecutor {
  const { agent, chatRoomId, threadId, injectGroupHistory, chatRoomAgents, sessionDir, customWorkDir, llmProvider, lastInjectedMessageId, chatRoomRules } = options;

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
        );
      }
      const agentCommand = getAcpToolCommand(acpTool);
      return new AcpExecutor(
        agent.name,
        agent.prompt,
        chatRoomId,
        agent.workDir,  // 使用通用 workDir
        injectGroupHistory,
        agent.id,
        acpTool,
        agentCommand,
        sessionDir,
        customWorkDir,
        lastInjectedMessageId,  // 传递上次注入位置
        chatRoomAgents,  // 传递群内助手列表
        llmProvider,
      );

    case 'builtin':
    default:
      return new LangChainAgentExecutor(
        agent.name,
        agent.prompt,
        threadId,
        chatRoomId,
        injectGroupHistory,
        chatRoomAgents,
        customWorkDir || undefined,
        llmProvider,
        agent.id,  // 传递 agentId 用于 skills 目录
        agent.workDir || undefined,  // 传递 agent 原始 workDir（用于 skills 目录）
        lastInjectedMessageId,  // 传递上次注入位置
        chatRoomRules,  // 传递群规则
      );
  }
}
