import type { LlmProvider } from '@prisma/client';
import { createDeepAgent } from 'deepagents';
import * as fs from 'fs';
import * as path from 'path';
import { checkpointer } from '../../lib/checkpointer.js';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import { CustomShellBackend } from '../shell/custom-shell-backend.js';
import {
  buildAgentLongTermMemorySection,
  ensureLongTermMemoryFiles,
} from './agent-long-term-memory.js';
import { agentLog } from './agent-log.js';
import type {
  AgentDebugInfo,
  AgentExecResult,
  AttachmentData,
  ChatRoomAgentInfo,
  HistoryMessage,
  IAgentExecutor,
  MessageEmitCallback,
  StreamEmitCallback,
  ThinkingEmitCallback,
  TokenUsage,
  ToolCall,
  ToolCallEmitCallback,
} from './executor.interface.js';
import { createModel, isThinkingUnsupportedError } from './model.factory.js';
import {
  resolveAgentWorkDir,
} from './work-dir.js';
import {
  buildInstalledSkillsInstructions,
  buildInstalledSkillsSignature,
} from './skill-instructions.js';
import {
  AGENT_CREATOR_AGENT_ID,
  CHATROOM_HELPER_AGENT_ID,
  CRON_TASK_HELPER_AGENT_ID,
  SKILL_MANAGER_AGENT_ID,
  agentCreatorTools,
  chatroomHelperTools,
  cronTaskHelperTools,
  skillManagerTools,
  webFetchTools,
} from './tools/index.js';

// 重试配置
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 30000]; // 5秒, 15秒, 30秒

/**
 * 检测是否是 API 限流错误（需要重试）
 * 讯飞 API 限流错误特征：错误码 10012，包含 "system is busy" 或 "429 Too Many Requests"
 */
function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const errorMessage = error.message;

  // 检测讯飞 API 限流错误
  // 错误码 10012: EngineInternalError
  // "The system is busy, please try again later"
  // "429 Too Many Requests"
  // "Rate limit reached for TPM"
  const rateLimitPatterns = [
    'code: 10012',
    'EngineInternalError',
    'The system is busy',
    '429 Too Many Requests',
    'Rate limit reached',
    'rate_limit',
    'too many requests',
  ];

  return rateLimitPatterns.some((pattern) =>
    errorMessage.toLowerCase().includes(pattern.toLowerCase()),
  );
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Agent Action 类型
export interface AgentAction {
  type: 'message';
  content: string;
  target?: string;
}

export class LangChainAgentExecutor implements IAgentExecutor {
  name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir: string; // 工作目录（用于 shell 执行）
  chatRoomAgents: ChatRoomAgentInfo[]; // 群内所有助手信息列表
  readonly llmProvider?: LlmProvider; // LLM 供应商配置
  readonly agentId?: string; // Agent ID（用于 skills 目录）
  readonly agentWorkDir?: string; // Agent 原始 workDir（用于 skills 目录）
  readonly chatRoomRules?: string; // 群规则/指南

  // 上次注入群历史的最后消息 ID（用于增量注入）
  private _lastInjectedMessageId?: string;
  private lastInjectedSkillsSignature?: string;

  /**
   * 处理 /clear 和 /new 命令：清除上下文
   */
  private async handleClearContext(
    emit: MessageEmitCallback,
    originalMessageId: string,
  ): Promise<string> {
    try {
      console.log(`${this.name}: 开始清除上下文...`);

      // 1. 清空 checkpointer 中的所有 checkpoint 数据
      await checkpointer.deleteThread(this.threadId);
      console.log(
        `${this.name}: 已清空 thread ${this.threadId} 的 checkpoint 数据`,
      );

      // 2. 清空上次注入位置（增量历史）
      this._lastInjectedMessageId = undefined;
      if (this.agentId) {
        await agentMemoryService.clear(this.chatRoomId, this.agentId);
      }

      // 3. 发送确认消息
      const resultMessage = '✅ 上下文已清除，开始新的对话';
      await emit(resultMessage, originalMessageId);

      return resultMessage;
    } catch (error) {
      console.error(`${this.name}: 清除上下文失败:`, error);
      const errorMessage = '❌ 清除上下文失败，请重试';
      await emit(errorMessage, originalMessageId);
      return errorMessage;
    }
  }

  systemPrompt: string;
  threadId: string;
  private agent: ReturnType<typeof createDeepAgent> | null = null;
  private backend: CustomShellBackend | null = null;

  // 流式输出回调
  private emitStream: StreamEmitCallback | null = null;
  // 思考过程回调
  private emitThinking: ThinkingEmitCallback | null = null;
  // 工具调用回调
  private emitToolCall: ToolCallEmitCallback | null = null;

  // 调试信息
  private lastContext: string | null = null;
  private lastInvokeResult: string | null = null;
  private lastHistory: HistoryMessage[] | null = null;

  // 工具调用收集器
  private toolCalls: ToolCall[] = [];

  constructor(
    name: string,
    systemPrompt: string,
    threadId: string = 'default',
    chatRoomId: string = 'default',
    injectGroupHistory: boolean = true,
    chatRoomAgents: ChatRoomAgentInfo[] = [],
    customWorkDir?: string,
    llmProvider?: LlmProvider,
    agentId?: string,
    agentWorkDir?: string, // Agent 原始 workDir（用于 skills 目录）
    lastInjectedMessageId?: string, // 上次注入群历史的最后消息 ID
    chatRoomRules?: string, // 群规则/指南
  ) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.threadId = threadId;
    this.chatRoomId = chatRoomId;
    this.injectGroupHistory = injectGroupHistory;
    this.chatRoomAgents = chatRoomAgents;
    this.llmProvider = llmProvider;
    this.agentId = agentId;
    this.agentWorkDir = agentWorkDir;
    this._lastInjectedMessageId = lastInjectedMessageId;
    this.chatRoomRules = chatRoomRules;

    this.workDir = resolveAgentWorkDir({
      chatRoomId,
      customWorkDir,
      agentWorkDir,
    });

    // 确保工作目录存在
    this.ensureWorkDirectory();

    // 不在构造函数中创建 agent，延迟到 exec 时初始化
  }

  // 初始化 backend 和 agent
  private async initAgent(): Promise<void> {
    if (this.agent) return;

    console.log(`${this.name}: 初始化 agent, 工作目录=${this.workDir}`);

    // 使用 CustomShellBackend.create() 确保 backend 正确初始化
    // timeout 设置为 15 秒，超时后自动切换后台（让 agent 保持响应）
    // 后台任务最多运行 30 分钟后强制终止
    this.backend = await CustomShellBackend.create({
      rootDir: this.workDir,
      inheritEnv: true, // 继承所有环境变量（包括 HOME、PATH 等）
      timeout: 15, // 15 秒（秒）
    });

    // 在 systemPrompt 中注入工作目录、群聊协作和模型信息
    const modelInfo = this.llmProvider
      ? `
## 当前模型
你正在使用 ${this.llmProvider.name} 提供的模型服务。
- 模型名称：${this.llmProvider.model}
- 供应商类型：${this.llmProvider.type}`
      : '';

    const enhancedSystemPrompt = `
${modelInfo}

## 工作目录
你的工作目录是：${this.workDir}

## 群聊协作场景
你正在群聊 ${this.chatRoomId} 中与一群同事协作工作。
- 直接输出 @{同事名称} 不会触发其他助手任务；需要协作时，请让用户在群聊中 @ 对应助手，或使用当前执行器支持的平台协作工具
- 你必须遵守群规则，与同事友好协作
- 当收到 @{你的名称} 的消息时，请积极响应并完成任务
`;

    // 判断是否是专用助手，添加对应工具
    const isAgentCreator = this.agentId === AGENT_CREATOR_AGENT_ID;
    const isCronTaskHelper = this.agentId === CRON_TASK_HELPER_AGENT_ID;
    const isSkillManager = this.agentId === SKILL_MANAGER_AGENT_ID;
    const isChatroomHelper = this.agentId === CHATROOM_HELPER_AGENT_ID;

    // 专用工具（根据 agent ID 选择）
    const specializedTools = isAgentCreator
      ? (agentCreatorTools as any)
      : isCronTaskHelper
        ? (cronTaskHelperTools as any)
        : isSkillManager
          ? (skillManagerTools as any)
          : isChatroomHelper
            ? (chatroomHelperTools as any)
            : [];

    // 合并专用工具和通用工具（web fetch 等）
    const tools = [...specializedTools, ...webFetchTools] as any;

    // 如果没有配置 LLM Provider，抛出错误
    if (!this.llmProvider) {
      throw new Error(
        `${this.name}: 未配置 LLM Provider，请在数据库中设置默认 LLM Provider 或为助手指定 LLM Provider`,
      );
    }

    this.agent = createDeepAgent({
      model: createModel(this.llmProvider, this.name) as any,
      systemPrompt: enhancedSystemPrompt,
      backend: this.backend as any,
      checkpointer,
      skills: this.getSkillsPaths(), // 加载 Skills 目录
      memory: this.getMemoryPaths(), // 加载记忆文件
      tools, // Skills 安装助手的专用工具
    });

    console.log(`${this.name}: agent 初始化完成`);
  }

  // 确保工作目录存在
  private ensureWorkDirectory() {
    try {
      fs.mkdirSync(this.workDir, {recursive: true});
      console.log(`${this.name}: 工作目录已创建 ${this.workDir}`);
    } catch (error) {
      console.error(`${this.name}: 创建工作目录失败`, error);
    }
  }

  // 上次注入位置的 getter
  get lastInjectedMessageId(): string | undefined {
    return this._lastInjectedMessageId;
  }

  // 上次注入位置的 setter
  setLastInjectedMessageId(id: string): void {
    this._lastInjectedMessageId = id;
  }

  // 获取 Skills 路径列表（用于 deepagents）
  private getSkillsPaths(): string[] {
    if (!this.agentId) {
      return [];
    }

    const skillsDir = skillInstallService.getAgentSkillsDir({
      id: this.agentId,
      type: 'builtin',
      workDir: this.agentWorkDir || null,
    });

    const installedSkills = skillInstallService.listInstalled(skillsDir);
    const skillSourcePaths = skillInstallService.getSkillsPaths(skillsDir);
    if (skillSourcePaths.length > 0) {
      console.log(
        `${this.name}: 检测到 ${installedSkills.length} 个 Skills，source=${skillsDir}`,
      );
    }
    return skillSourcePaths;
  }

  // 获取记忆文件路径列表（用于 deepagents）
  private getMemoryPaths(): string[] {
    const memoryFiles = ensureLongTermMemoryFiles(this.chatRoomId, this.agentId, this.name);
    console.log(`${this.name}: 加载记忆文件 ${memoryFiles.join(', ')}`);
    return memoryFiles;
  }

  async exec(
    message: string,
    emit: MessageEmitCallback,
    originalMessageId: string,
    history?: HistoryMessage[],
    emitStream?: StreamEmitCallback,
    emitToolCall?: ToolCallEmitCallback,
    emitThinking?: ThinkingEmitCallback,
    signal?: AbortSignal,
    attachments?: AttachmentData[], // 图片附件（包含 base64）
  ): Promise<AgentExecResult> {
    console.log(`${this.name}: 开始执行任务`);
    agentLog(this.name, 'EXEC_START', {
      message: message.substring(0, 500),
      hasAttachments: !!attachments,
    });

    if (attachments && attachments.length > 0) {
      console.log(`${this.name}: 收到 ${attachments.length} 个图片附件`);
      agentLog(this.name, 'ATTACHMENTS', {
        count: attachments.length,
        types: attachments.map((a) => a.mimeType),
      });
    }

    // 初始化 agent（确保 backend 正确初始化）
    await this.initAgent();

    // 设置流式输出回调
    this.emitStream = emitStream || null;
    this.emitThinking = emitThinking || null;
    this.emitToolCall = emitToolCall || null;

    // 检查是否是透传命令（移除 mention 后以 / 开头）
    const trimmedMessage = message.trim();
    const mentionRegex =
      /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_]+)(?=\s|$)/g;
    const messageWithoutMentions = trimmedMessage
      .replace(mentionRegex, '')
      .trim();

    if (messageWithoutMentions.startsWith('/')) {
      // 检查是否是需要拦截处理的命令
      const command = messageWithoutMentions.toLowerCase().trim();
      if (command === '/clear' || command === '/new') {
        // 拦截 /clear 和 /new 命令：清除上下文
        console.log(`${this.name}: 拦截命令 ${command}，清除上下文`);

        const resultMessage = await this.handleClearContext(
          emit,
          originalMessageId,
        );

        return {
          actions: [
            {
              type: 'message',
              content: resultMessage,
            },
          ],
        };
      }

      // 其他 slash 命令：拦截并提示暂不支持
      console.log(`${this.name}: 拦截命令 ${command}，暂不支持`);
      const unsupportedMessage = `暂不支持当前指令: ${command}`;
      await emit(unsupportedMessage, originalMessageId);

      return {
        actions: [
          {
            type: 'message',
            content: unsupportedMessage,
          },
        ],
      };
    }

    // 构建上下文
    let contextMessage = message;

    // 添加系统提示词
    if (this.systemPrompt) {
      contextMessage = `【系统提示词】
${this.systemPrompt}

${contextMessage}`;
    }

    const longTermMemorySection = buildAgentLongTermMemorySection(this.chatRoomId, this.agentId, this.name);
    if (longTermMemorySection) {
      contextMessage = `${longTermMemorySection}

${contextMessage}`;
    }

    const skillsUpdateSection = this.buildSkillsUpdateSection();
    if (skillsUpdateSection) {
      contextMessage = `${skillsUpdateSection}

${contextMessage}`;
    }

    // 注入群规则（强调必须遵守）
    if (this.chatRoomRules && this.chatRoomRules.trim()) {
      contextMessage = `【群规则 - 必须遵守】
${this.chatRoomRules.trim()}

${contextMessage}`;
    }

    // 注入群内助手列表信息
    if (this.chatRoomAgents.length > 0) {
      const agentsInfo = this.chatRoomAgents.map((a) => a.name).join('、');
      const selfInfo = this.name;
      const otherAgents = this.chatRoomAgents.filter(
        (agent) => agent.name !== this.name,
      );

      const otherAgentsList = otherAgents.map((agent) => agent.name).join('、');
      const othersInfo = otherAgents.length > 0 ? otherAgentsList : '无';
      const mentionTip =
        otherAgents.length > 0
          ? `\n【协作提示】
你正在与 ${otherAgents.length} 位同事协作工作。直接输出 @{同事名称} 不会触发其他助手任务；需要协作时，请让用户在群聊中 @ 对应助手，或使用当前执行器支持的平台协作工具。`
          : '';

      contextMessage = `【群聊协作信息】
群聊工作目录：${this.workDir}
当前群聊成员：${agentsInfo}
你是：${selfInfo}
其他同事：${othersInfo}${mentionTip}

${contextMessage}`;
    }

    // 检查是否需要注入群历史摘要和最近消息
    if (this.injectGroupHistory && history && history.length > 0) {
      const memorySummary = history.find((msg) => msg.kind === 'memory_summary')?.content;
      const recentHistory = history.filter((msg) => msg.kind !== 'memory_summary');
      const historySections: string[] = [];

      if (memorySummary) {
        historySections.push(`【群聊长期记忆摘要】
${memorySummary}`);
      }

      if (recentHistory.length > 0) {
        const historyText = recentHistory
          .map((msg) => `[${msg.senderName}]: ${msg.content}`)
          .join('\n');

        historySections.push(`【最近群聊消息】以下是当前消息之前最近的群聊消息（共 ${recentHistory.length} 条）：
${historyText}`);
      }

      if (historySections.length > 0) {
        contextMessage = `${historySections.join('\n\n')}

当前消息：${contextMessage}`;
      }
    }

    // 保存历史消息用于调试
    this.lastHistory = history ?? null;

    // 重试机制：处理 API 限流错误
    let retryCount = 0;
    let lastError: Error | null = null;

    // 重试循环
    while (retryCount <= MAX_RETRIES) {
      // 重置工具调用收集器（每次重试都重新开始）
      this.toolCalls = [];

      // 消息收集器
      const messageCollector = {
        content: '',
        thought: '',
        thoughtTimestamp: 0, // 思考开始时间戳
        lastOutputStart: 0, // 最后一次 output 开始的位置
        lastEventType: '', // 上一个事件类型
        // 累积的 AI message chunk（用于正确处理 tool_calls）
        accumulatedAiChunk: null as any,
        // 已发送的工具调用（避免重复发送）
        sentToolCalls: new Set<string>(),
        // 已发送但未收到结果的工具调用（用于处理 middleware 工具如 write_todos）
        pendingToolCalls: new Map<string, {name: string; args: any}>(),
      };

      // Token 使用收集器
      let tokenUsage: TokenUsage | null = null;

      // 检查是否已经被中断
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      try {
        // 构建消息内容（支持多模态）
        let userMessageContent:
          | string
          | Array<{
              type: string;
              text?: string;
              source?: {type: string; media_type: string; data: string};
            }>;

        if (attachments && attachments.length > 0) {
          // 有图片附件，构建多模态内容
          userMessageContent = [
            {type: 'text', text: contextMessage},
            // 添加图片内容
            ...attachments.map((att) => ({
              type: 'image',
              source: {
                type: 'base64',
                media_type: att.mimeType,
                data: att.base64,
              },
            })),
          ];
          console.log(
            `${this.name}: 发送多模态消息，包含 ${attachments.length} 张图片`,
          );
        } else {
          // 纯文本消息
          userMessageContent = contextMessage;
        }

        console.log(userMessageContent, 'userMessageContent');

        // 使用 deep agent 的 stream 方法（传递 signal 给底层）
        const result = await this.agent!.stream(
          {
            messages: [{role: 'user', content: userMessageContent}],
          },
          {
            streamMode: 'messages',
            configurable: {
              thread_id: this.threadId,
            },
            signal, // 传递 AbortSignal，让 LangGraph 底层处理中断
          },
        );

        // Token 使用收集器（不累加 chunks，而是单独追踪）
        // Anthropic 流式响应中：message_start 有 input_tokens，message_delta 有 output_tokens 增量
        // 不要用 concat 累加，因为 LangGraph thinking 模式可能有多次 LLM 调用
        let lastInputTokens = 0;
        let accumulatedOutputTokens = 0;
        let lastCacheReadTokens = 0;
        let lastCacheCreationTokens = 0;

        for await (const [chunk] of result) {
          // 检查是否被中断
          if (signal?.aborted) {
            console.log(`${this.name}: 执行已被中断`);
            throw new DOMException('执行已被用户中断', 'AbortError');
          }

          const chunkAny = chunk as any;
          const chunkType = chunkAny._getType?.() || chunkAny.type || 'unknown';

          // 记录完整 chunk 数据（用于调试）
          try {
            const chunkJson = JSON.stringify(chunk, null, 2);
            agentLog(this.name, 'CHUNK', {rawChunk: JSON.parse(chunkJson)});
          } catch {
            // 如果序列化失败，记录基本信息
            agentLog(this.name, 'CHUNK', {
              type: chunkType,
              serializeError: true,
            });
          }

          // 处理 AIMessageChunk 的 usage_metadata
          if (chunkType === 'ai' || chunkType === 'AIMessageChunk') {
            // 检查 usage_metadata
            if (chunkAny.usage_metadata) {
              const meta = chunkAny.usage_metadata;

              // message_start: input_tokens 有值，output_tokens 为 0
              // message_delta: input_tokens 为 0，output_tokens 有增量值
              // 取最后一次非零的 input_tokens（message_start）
              if (meta.input_tokens > 0) {
                lastInputTokens = meta.input_tokens;
                lastCacheReadTokens = meta.input_token_details?.cache_read || 0;
                lastCacheCreationTokens =
                  meta.input_token_details?.cache_creation || 0;
              }
              // 累加 output_tokens（message_delta 的增量）
              if (meta.output_tokens > 0) {
                accumulatedOutputTokens += meta.output_tokens;
              }
            }

            // 处理 OpenAI reasoning 模型的 reasoning_content（如 DeepSeek R1、阿里云百炼 qwen3）
            // reasoning_content 通过原始响应的 delta 字段传递
            // LangChain 不处理这个字段，需要从 __raw_response 中提取
            let reasoningContent: string | undefined;

            // 优先从 additional_kwargs 直接获取（某些 SDK 可能处理）
            if (chunkAny.additional_kwargs?.reasoning_content) {
              reasoningContent = chunkAny.additional_kwargs.reasoning_content;
            }
            // 从原始响应中获取（启用 __includeRawResponse 后）
            else if (
              chunkAny.additional_kwargs?.__raw_response?.choices?.[0]?.delta
                ?.reasoning_content
            ) {
              reasoningContent =
                chunkAny.additional_kwargs.__raw_response.choices[0].delta
                  .reasoning_content;
            }

            if (typeof reasoningContent === 'string' && reasoningContent) {
              // 记录思考开始时间戳
              if (!messageCollector.thoughtTimestamp) {
                messageCollector.thoughtTimestamp = Date.now();
              }
              messageCollector.thought += reasoningContent;
              messageCollector.lastEventType = 'thinking';
              agentLog(this.name, 'OPENAI_REASONING', {
                text:
                  reasoningContent.substring(0, 200) +
                  (reasoningContent.length > 200 ? '...' : ''),
              });
              if (this.emitThinking) {
                this.emitThinking(reasoningContent);
              }
            }

            // 累积 AIMessageChunk（使用 concat 方法正确合并 tool_calls）
            if (
              chunkAny.tool_calls?.length > 0 ||
              chunkAny.tool_call_chunks?.length > 0
            ) {
              if (messageCollector.accumulatedAiChunk) {
                messageCollector.accumulatedAiChunk =
                  messageCollector.accumulatedAiChunk.concat(chunkAny);
              } else {
                messageCollector.accumulatedAiChunk = chunkAny;
              }
            }

            // 检查 stop_reason，如果是 'tool_use'，说明工具调用参数完整
            // 注意：stop_reason 可能在没有 tool_calls 的 chunk 中，所以单独检查
            if (chunkAny.additional_kwargs?.stop_reason === 'tool_use') {
              // 从累积的 chunk 中获取完整的 tool_calls
              const toolCalls =
                messageCollector.accumulatedAiChunk?.tool_calls || [];

              for (const tc of toolCalls) {
                const toolCallId = tc.id;
                const toolName = tc.name;

                if (!toolCallId || !toolName) continue;

                // 避免重复发送
                if (messageCollector.sentToolCalls.has(toolCallId)) continue;
                messageCollector.sentToolCalls.add(toolCallId);

                // 记录工具调用日志
                agentLog(this.name, 'TOOL_CALL', {
                  toolName,
                  toolCallId,
                  args: tc.args,
                });

                // 收集工具调用
                this.toolCalls.push({
                  name: toolName,
                  input: tc.args || {},
                  toolCallId,
                  status: 'in_progress',
                  timestamp: Date.now(),
                });

                // 发送工具调用开始事件
                if (this.emitToolCall) {
                  this.emitToolCall({
                    name: toolName,
                    input: tc.args || {},
                    toolCallId,
                    status: 'in_progress',
                  });
                }
                // 记录到 pending 列表（用于处理 middleware 工具如 write_todos）
                messageCollector.pendingToolCalls.set(toolCallId, {
                  name: toolName,
                  args: tc.args,
                });
                console.log(
                  `${this.name}: 工具调用开始 ${toolName}(${toolCallId})`,
                );
              }

              // 重置累积的 chunk
              messageCollector.accumulatedAiChunk = null;
            }
          }

          // 处理 ToolMessage（工具执行结果）
          // ToolMessage 包含 tool_call_id 和 content，以及 name 字段
          if (chunkType === 'tool' || chunkAny._getType?.() === 'tool') {
            const toolCallId = chunkAny.tool_call_id;
            const toolContent =
              typeof chunkAny.content === 'string'
                ? chunkAny.content
                : JSON.stringify(chunkAny.content);

            // ToolMessage 本身包含 name 字段，直接使用
            const toolName = chunkAny.name || 'unknown';

            // 从 pending 列表中移除
            messageCollector.pendingToolCalls.delete(toolCallId);

            // 查找原始工具调用数据，获取完整的 input
            const existingCall = this.toolCalls.find(
              (tc) => tc.toolCallId === toolCallId,
            );
            const originalInput = existingCall?.input || {};

            // 更新工具调用状态
            if (existingCall) {
              existingCall.status = 'completed';
              existingCall.output = toolContent;
            }

            // 记录工具结果日志
            agentLog(this.name, 'TOOL_RESULT', {
              toolCallId,
              toolName,
              output: toolContent.substring(0, 500),
            });

            // 发送工具完成事件
            if (this.emitToolCall) {
              this.emitToolCall({
                name: toolName,
                input: originalInput, // 保留原始 input，前端需要显示完整数据
                toolCallId,
                status: 'completed',
                output: toolContent,
              });
            }
            console.log(`${this.name}: 工具结果 ${toolName}(${toolCallId})`);
          }

          // 处理 contentBlocks（思考过程和文本输出）
          // 注意：跳过 ToolMessage 类型的 chunk，因为工具结果已经通过 TOOL_RESULT 事件发送
          const contentBlocks = chunk.contentBlocks;
          if (
            contentBlocks &&
            chunkType !== 'tool' &&
            chunkAny._getType?.() !== 'tool'
          ) {
            // 当检测到新的 LLM 输出时，将所有未完成的工具调用标记为完成
            // 这是处理 middleware 工具（如 write_todos）的情况，这些工具不会返回 ToolMessage
            const hasReasoningOrText = contentBlocks.some(
              (b: any) => b.type === 'reasoning' || b.type === 'text',
            );
            if (
              hasReasoningOrText &&
              messageCollector.pendingToolCalls.size > 0
            ) {
              for (const [
                toolCallId,
                {name, args},
              ] of messageCollector.pendingToolCalls) {
                agentLog(this.name, 'TOOL_RESULT_AUTO', {
                  toolCallId,
                  toolName: name,
                  reason: 'LLM output started',
                });
                if (this.emitToolCall) {
                  this.emitToolCall({
                    name,
                    input: args || {}, // 保留原始 args，前端需要显示完整数据
                    toolCallId,
                    status: 'completed',
                    output: '', // middleware 工具通常没有输出
                  });
                }
                console.log(
                  `${this.name}: 工具自动完成 ${name}(${toolCallId}) - LLM 输出已开始`,
                );
              }
              messageCollector.pendingToolCalls.clear();
            }

            agentLog(this.name, 'CONTENT_BLOCKS', {
              hasContentBlocks: true,
              blocksCount: contentBlocks.length,
              blocksTypes: contentBlocks.map((b: any) => b.type),
            });
            for (const msg of contentBlocks) {
              // 处理 reasoning
              if (msg.type === 'reasoning') {
                const thinkingText = String(msg.reasoning || '');
                if (thinkingText) {
                  // 记录思考开始时间戳
                  if (!messageCollector.thoughtTimestamp) {
                    messageCollector.thoughtTimestamp = Date.now();
                  }
                  messageCollector.thought += thinkingText;
                  messageCollector.lastEventType = 'thinking';
                  // 记录思考日志（截断长内容）
                  agentLog(this.name, 'THINKING', {
                    text:
                      thinkingText.substring(0, 200) +
                      (thinkingText.length > 200 ? '...' : ''),
                  });
                  if (this.emitThinking) {
                    this.emitThinking(thinkingText);
                  }
                }
              }
              // 处理 text
              else if (msg.type === 'text') {
                const textContent = String(msg.text || '');
                if (textContent) {
                  // 正常文本输出
                  if (messageCollector.lastEventType !== 'output') {
                    messageCollector.lastOutputStart =
                      messageCollector.content.length;
                  }
                  messageCollector.content += textContent;
                  messageCollector.lastEventType = 'output';
                  agentLog(this.name, 'TEXT_OUTPUT', {
                    text: textContent.substring(0, 100),
                    hasEmitStream: !!this.emitStream,
                  });
                  if (this.emitStream) {
                    this.emitStream(textContent);
                  }
                  process.stdout.write(textContent);
                }
              }
            }
          } else {
            // OpenAI 协议处理：直接从 content 获取文本
            const chunkContent = (chunk as any).content;
            if (
              typeof chunkContent === 'string' &&
              chunkContent &&
              chunkType !== 'tool'
            ) {
              // OpenAI 流式输出：content 是纯字符串
              if (messageCollector.lastEventType !== 'output') {
                messageCollector.lastOutputStart =
                  messageCollector.content.length;
              }
              messageCollector.content += chunkContent;
              messageCollector.lastEventType = 'output';
              agentLog(this.name, 'OPENAI_TEXT_OUTPUT', {
                text: chunkContent.substring(0, 100),
                hasEmitStream: !!this.emitStream,
              });
              if (this.emitStream) {
                this.emitStream(chunkContent);
              }
              process.stdout.write(chunkContent);
            } else if (Array.isArray(chunkContent) && chunkContent.length > 0) {
              agentLog(this.name, 'NO_CONTENT_BLOCKS', {
                chunkType,
                contentType: typeof chunkContent,
                contentLength: chunkContent.length,
                firstBlockType: chunkContent[0]?.type,
                firstBlockSample: JSON.stringify(chunkContent[0]).substring(
                  0,
                  200,
                ),
              });
            }
          }
        }

        // 清理状态
        messageCollector.sentToolCalls.clear();
        messageCollector.accumulatedAiChunk = null;

        // 输出换行
        if (messageCollector.content) {
          console.log(''); // 换行
        }

        // 流结束后，组装最终的 token 使用统计
        if (lastInputTokens > 0 || accumulatedOutputTokens > 0) {
          tokenUsage = {
            inputTokens: lastInputTokens,
            outputTokens: accumulatedOutputTokens,
            totalTokens: lastInputTokens + accumulatedOutputTokens,
            cacheReadTokens: lastCacheReadTokens,
            cacheCreationTokens: lastCacheCreationTokens,
          };
        }

        // 执行成功，处理响应
        if (messageCollector.content) {
          console.log(''); // 换行
        }

        const responseContent = messageCollector.content.slice(
          messageCollector.lastOutputStart,
        );
        const thinkingContent = messageCollector.thought;
        const thinkingTimestamp = messageCollector.thoughtTimestamp;

        // 保存上下文和结果用于调试
        this.lastContext = contextMessage;

        // 构建带时间戳的思考记录
        const thinkingRecord = thinkingContent
          ? {
              content: thinkingContent,
              timestamp: thinkingTimestamp || Date.now(),
            }
          : undefined;

        this.lastInvokeResult = JSON.stringify(
          {
            toolCalls: this.toolCalls,
            responseContent,
            thinking: thinkingRecord,
            contextMessage,
            fullContent: messageCollector.content,
            lastOutputStart: messageCollector.lastOutputStart,
          },
          null,
          2,
        );

        // 打印 Agent 输出详情
        console.log('\n========== Agent 输出 ==========');
        console.log(`Agent: ${this.name}`);
        if (thinkingContent) {
          console.log(`思考过程:`, thinkingContent.slice(0, 500) + '...');
        }
        console.log(`响应内容（最后一次输出）:`, responseContent);
        console.log(`完整输出:`, messageCollector.content);
        console.log('================================\n');

        // 记录执行结束日志
        agentLog(this.name, 'EXEC_END', {
          responseLength: responseContent?.length || 0,
          thinkingLength: thinkingContent?.length || 0,
          fullContentLength: messageCollector.content.length,
          tokenUsage,
        });

        // 发送响应消息（只发送最后一次输出）
        if (responseContent) {
          await emit(responseContent, originalMessageId);
        }

        // 成功返回，退出循环
        return {
          actions: responseContent
            ? [
                {
                  type: 'message',
                  content: responseContent,
                },
              ]
            : [],
          tokenUsage: tokenUsage || undefined, // Token 使用信息
        };
      } catch (error) {
        // 记录错误日志
        agentLog(this.name, 'EXEC_ERROR', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          retryCount,
        });

        // 检查是否是中断错误（不重试）
        if (error instanceof Error && error.name === 'AbortError') {
          console.log(`${this.name}: 执行已被中断`);
          throw error;
        }

        // 检查是否是不支持思考模式的错误，自动标记并禁用
        if (isThinkingUnsupportedError(error) && this.llmProvider) {
          console.warn(
            `${this.name}: 检测到模型不支持思考模式，自动标记 supportsThinking=false`,
          );
          agentLog(this.name, 'THINKING_UNSUPPORTED', {
            providerId: this.llmProvider.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // 更新数据库标记不支持思考模式
          try {
            await llmProviderService.update(this.llmProvider.id, {
              supportsThinking: false,
            } as any);
            console.log(
              `${this.name}: 已更新 LlmProvider ${this.llmProvider.name} 的 supportsThinking=false`,
            );
          } catch (updateError) {
            console.error(
              `${this.name}: 更新 supportsThinking 失败`,
              updateError,
            );
          }
          // 不重试，直接返回错误提示
          const errorMessage = `⚠️ 当前模型不支持思考模式，已自动禁用。请重新发送消息。`;
          await emit(errorMessage, originalMessageId);
          return {
            actions: [{type: 'message', content: errorMessage}],
          };
        }

        // 检查是否是 API 限流错误（需要重试）
        if (isRateLimitError(error) && retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount];
          console.warn(
            `${this.name}: API 限流，${delay / 1000}秒后重试 (第${retryCount + 1}次)`,
          );
          agentLog(this.name, 'API_RETRY', {
            retryCount: retryCount + 1,
            delayMs: delay,
            error: error instanceof Error ? error.message : String(error),
          });

          lastError = error instanceof Error ? error : new Error(String(error));
          retryCount++;

          // 等待后重试
          await sleep(delay);

          // 重置工具调用收集器（重试时重新开始）
          this.toolCalls = [];
          continue; // 继续重试循环
        }

        // 非限流错误或已达到最大重试次数，退出循环
        console.error(`${this.name}: 模型调用失败`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        break;
      } finally {
        this.emitStream = null;
        this.emitThinking = null;
        this.emitToolCall = null;
      }
    }

    // 重试失败后，记录错误并返回
    if (lastError) {
      agentLog(this.name, 'EXEC_FAILED', {
        error: lastError.message,
        totalRetries: retryCount,
      });

      console.error(`${this.name}: 重试 ${retryCount} 次后仍然失败`);

      // 发送错误提示消息
      const errorMessage = `⚠️ API 请求失败，已重试 ${retryCount} 次。请稍后重试。`;
      await emit(errorMessage, originalMessageId);
    }

    // 返回空结果
    return {
      actions: [],
      tokenUsage: undefined,
    };
  }

  private getSkillsDirForInstructions(): string | undefined {
    if (!this.agentId) return undefined;

    return skillInstallService.getAgentSkillsDir({
      id: this.agentId,
      type: 'builtin',
      workDir: this.agentWorkDir || null,
    });
  }

  private buildSkillsUpdateSection(): string {
    const skillsDir = this.getSkillsDirForInstructions();
    const currentSignature = buildInstalledSkillsSignature(this.agentId, skillsDir);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }

    this.lastInjectedSkillsSignature = currentSignature;
    return `【技能清单更新】
${buildInstalledSkillsInstructions(this.agentId, skillsDir)}`;
  }

  // 获取调试信息
  getDebugInfo(): AgentDebugInfo {
    return {
      name: this.name,
      type: 'langchain',
      systemPrompt: this.systemPrompt,
      lastContext: this.lastContext,
      lastInvokeResult: this.lastInvokeResult,
      lastHistory: this.lastHistory,
      threadId: this.threadId,
      chatRoomId: this.chatRoomId,
      injectGroupHistory: this.injectGroupHistory,
      chatRoomAgents: this.chatRoomAgents,
      workDir: this.workDir,
      llmProvider: this.llmProvider
        ? {
            id: this.llmProvider.id,
            name: this.llmProvider.name,
            type: this.llmProvider.type,
            model: this.llmProvider.model,
          }
        : undefined,
    };
  }
}
