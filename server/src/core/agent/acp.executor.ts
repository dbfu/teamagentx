import type {
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
  AcpRuntimeTurnAttachment
} from 'acpx/runtime';
import {
  AcpxRuntime,
  createAgentRegistry,
  createFileSessionStore,
} from 'acpx/runtime';
import type { LlmProvider } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { buildAgentLongTermMemorySection } from './agent-long-term-memory.js';
import { debugLog } from './agent-handler/debug.js';
import {
  createAcpProviderCommand,
  type AcpProviderInfo,
} from './acp-provider.adapter.js';
import {
  resolveAgentWorkDir,
} from './work-dir.js';
import {
  buildInstalledSkillsInstructions,
  buildInstalledSkillsSignature,
} from './skill-instructions.js';
import { getImageGenerationSkillInstructions } from './image-generation-config.js';
import type {
  AgentDebugInfo,
  AgentExecResult,
  ChatRoomAgentInfo,
  HistoryMessage,
  IAgentExecutor,
  MessageEmitCallback,
  StreamEmitCallback,
  ThinkingEmitCallback,
  ToolCall,
  ToolCallEmitCallback,
} from './executor.interface.js';

// Dynamic import of acpx/runtime to allow graceful degradation when the package is not available
async function getRuntimeModule(): Promise<{
  AcpxRuntime: typeof AcpxRuntime;
  createAgentRegistry: typeof createAgentRegistry;
  createFileSessionStore: typeof createFileSessionStore;
}> {
  const runtime = await import('acpx/runtime');
  return runtime;
}

function normalizeAcpToolTitle(title?: string): string | null {
  if (typeof title !== 'string') return null;

  let normalized = title.trim();
  if (!normalized) return null;

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  const hasMatchingQuotes =
    normalized.length >= 2 &&
    ((first === '"' && last === '"') ||
      (first === '\'' && last === '\'') ||
      (first === '`' && last === '`'));

  if (hasMatchingQuotes) {
    if (first === '"') {
      try {
        const parsed = JSON.parse(normalized);
        if (typeof parsed === 'string') {
          normalized = parsed.trim();
        }
      } catch {
        normalized = normalized.slice(1, -1).trim();
      }
    } else {
      normalized = normalized.slice(1, -1).trim();
    }
  }

  const lower = normalized.toLowerCase();
  if (
    !normalized ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'unknown' ||
    lower === 'tool call' ||
    lower === 'tool_call'
  ) {
    return null;
  }

  return normalized;
}

function mapAcpToolStatus(status?: string): ToolCall['status'] | undefined {
  if (!status) return undefined;

  const statusLower = status.toLowerCase();
  if (
    statusLower.includes('complete') ||
    statusLower.includes('done') ||
    statusLower.includes('success')
  ) {
    return 'completed';
  }
  if (
    statusLower.includes('error') ||
    statusLower.includes('fail')
  ) {
    return 'error';
  }
  if (
    statusLower.includes('pending') ||
    statusLower.includes('running') ||
    statusLower.includes('progress')
  ) {
    return 'in_progress';
  }

  return undefined;
}

export class AcpExecutor implements IAgentExecutor {
  readonly name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir: string;
  readonly agentWorkDir: string | null; // Agent 全局工作目录（用于 Skills）
  readonly chatRoomAgents: ChatRoomAgentInfo[]; // 群内所有助手信息列表
  readonly llmProvider?: LlmProvider; // 可选：由 TeamAgentX 注入到 ACP CLI 的模型供应商
  readonly imageGenerationProvider?: LlmProvider | null;

  // 上次注入群历史的最后消息 ID（用于增量注入）
  private _lastInjectedMessageId?: string;
  private lastInjectedSkillsSignature?: string;

  private systemPrompt: string;
  private acpTool: string;
  private agentCommand: string;
  private acpProviderInfo?: AcpProviderInfo;
  private agentId: string | null = null;
  private runtime: InstanceType<typeof AcpxRuntime> | null = null;
  private handle: AcpRuntimeHandle | null = null;
  private sessionKey: string | null = null;

  // 消息收集器
  private messageCollector = {
    content: '',
    thought: '',
    thoughtTimestamp: 0, // 思考开始时间戳
    lastOutputStart: 0, // 最后一次 output 开始的位置
    lastEventType: '', // 上一个事件类型
    statusText: '', // status 事件的文本（用于捕获 /context 等命令的输出）
    reset() {
      this.content = '';
      this.thought = '';
      this.thoughtTimestamp = 0;
      this.lastOutputStart = 0;
      this.lastEventType = '';
      this.statusText = '';
    },
  };

  // 工具调用收集器
  private toolCalls: ToolCall[] = [];

  // 调试信息
  private lastContext: string | null = null;
  private lastResponse: string | null = null;
  private lastInvokeResult: string | null = null;

  // 流式输出回调
  private emitStream: StreamEmitCallback | null = null;

  // 思考过程回调
  private emitThinking: ThinkingEmitCallback | null = null;

  // 工具调用回调
  private emitToolCall: ToolCallEmitCallback | null = null;

  constructor(
    name: string,
    systemPrompt: string,
    chatRoomId: string,
    workDir: string | null,
    injectGroupHistory: boolean = true,
    agentId?: string,
    acpTool?: string,
    agentCommand?: string,
    sessionDir?: string, // 快速对话会话工作目录
    customWorkDir?: string, // 群聊工作目录
    lastInjectedMessageId?: string, // 上次注入群历史的最后消息 ID
    chatRoomAgents?: ChatRoomAgentInfo[], // 群内助手列表
    llmProvider?: LlmProvider,
    imageGenerationProvider?: LlmProvider | null,
  ) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.chatRoomId = chatRoomId;
    this.injectGroupHistory = injectGroupHistory;
    this.agentId = agentId || null;
    this.agentWorkDir = workDir || null; // Agent 原始 workDir（用于全局 Skills 目录）
    this.acpTool = acpTool || 'unknown';
    if (!agentCommand) {
      throw new Error(`ACP tool ${this.acpTool} is missing agent command`);
    }
    this.agentCommand = agentCommand;
    this._lastInjectedMessageId = lastInjectedMessageId;
    this.chatRoomAgents = chatRoomAgents || [];
    this.llmProvider = llmProvider;
    this.imageGenerationProvider = imageGenerationProvider;

    this.workDir = resolveAgentWorkDir({
      chatRoomId,
      sessionDir,
      customWorkDir,
      agentWorkDir: workDir,
    });

    const modelInfo = this.llmProvider
      ? `
## 当前模型
你正在使用 ${this.llmProvider.name} 提供的模型服务。
- 模型名称：${this.llmProvider.model}
- 供应商类型：${this.llmProvider.type}`
      : '';

    // 在系统提示中注入模型和工作目录信息（一次性注入，避免每次消息重复）
    this.systemPrompt = `${modelInfo}
${systemPrompt}

${getImageGenerationSkillInstructions(this.imageGenerationProvider)}

## 工作目录
你的工作目录是：${this.workDir}
执行文件操作和命令时，默认在此目录下操作。使用相对路径时，基于此目录解析。`;

    // 确保目录存在
    this.ensureWorkDirectory();

    // OpenClaw ACP 需要设置 Gateway Token 环境变量
    // 必须在构造函数中设置，因为 executor 实例会被缓存
    if (this.acpTool === 'openclaw') {
      const gatewayToken = this.getOpenClawGatewayToken();
      if (gatewayToken) {
        process.env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
      } else {
        console.warn(
          `${this.name}: 未找到 OpenClaw Gateway Token，可能无法正常连接`,
        );
      }
    }
  }

  private ensureWorkDirectory(): void {
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, {recursive: true});
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

  /**
   * 处理 /clear 和 /new 命令：清除上下文，创建新 session
   *
   * 根据 acpx 官方文档，推荐使用 "软关闭" 方案：
   * - 调用 runtime.close() 正确关闭旧会话
   * - 更新 sessionKey 以创建新会话
   * - 新会话会是一个全新的上下文
   */
  private async handleClearContext(
    emit: MessageEmitCallback,
    originalMessageId: string,
  ): Promise<string> {
    try {
      console.log(`${this.name}: 开始清除上下文（软关闭方案）...`);

      // 1. 正确关闭旧会话（调用 runtime.close）
      if (this.runtime && this.handle) {
        try {
          console.log(`${this.name}: 调用 runtime.close() 关闭旧会话...`);
          await this.runtime.close({
            handle: this.handle,
            reason: 'clear_context',
          });
          console.log(`${this.name}: 旧会话已软关闭`);
        } catch (closeError) {
          console.warn(`${this.name}: 关闭旧会话失败（可能是会话已结束）:`, closeError);
        }
      }

      // 2. 清空 handle 和 runtime，强制下次创建新会话
      this.handle = null;
      this.runtime = null;
      this._lastInjectedMessageId = undefined;
      if (this.agentId) {
        await agentMemoryService.clear(this.chatRoomId, this.agentId);
      }

      // 3. 更新 sessionKey：添加时间戳后缀，确保创建新会话而不是恢复旧会话
      // 这是关键！通过改变 sessionKey，ensureSession 会创建全新的 session
      const timestamp = Date.now();
      this.sessionKey = `${this.chatRoomId}-${this.agentId || 'default'}-${timestamp}`;
      console.log(`${this.name}: 新 sessionKey = ${this.sessionKey}`);

      // 4. 发送确认消息
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

  /**
   * 确保 Skills symlink 存在
   * ACP agent（如 Claude Code）会读取 CLAUDE_CONFIG_DIR 下的 skills/
   * 我们将全局 Skills 目录 symlink 到 CLAUDE_CONFIG_DIR
   */
  private ensureSkillsSymlink(): void {
    if (!this.agentId) return;

    // 全局 Skills 目录（固定位置，不受工作目录变化影响）
    const globalSkillsDir = skillInstallService.getGlobalAgentSkillsDir(
      this.agentId,
    );

    // 如果全局目录不存在（没有安装过 skills），不需要创建 symlink
    if (!fs.existsSync(globalSkillsDir)) return;

    // CLAUDE_CONFIG_DIR 下的 skills 路径（Claude-compatible ACP runtimes 会从这里读取）
    // 与 acp-provider.adapter.ts 中的路径保持一致
    const claudeConfigDir = path.join(os.homedir(), '.teamagentx', 'acp-config', this.agentId);
    const configSkillsDir = path.join(claudeConfigDir, 'skills');

    // 检查是否已经是正确的 symlink
    try {
      if (fs.existsSync(configSkillsDir)) {
        const existingTarget = fs.readlinkSync(configSkillsDir);
        if (existingTarget === globalSkillsDir) {
          // 已经是正确的 symlink，无需更新
          return;
        }
      }
    } catch {
      // 不是 symlink 或读取失败，继续创建
    }

    // 删除旧的（可能是错误的 symlink 或目录）
    try {
      fs.rmSync(configSkillsDir, {recursive: true, force: true});
    } catch {
      // 忽略删除失败
    }

    // 确保 CLAUDE_CONFIG_DIR 目录存在
    if (!fs.existsSync(claudeConfigDir)) {
      fs.mkdirSync(claudeConfigDir, {recursive: true});
    }

    // 创建 symlink
    try {
      fs.symlinkSync(globalSkillsDir, configSkillsDir);
      console.log(
        `${this.name}: Skills symlink 已创建 ${configSkillsDir} → ${globalSkillsDir}`,
      );
    } catch (error) {
      console.error(`${this.name}: 创建 Skills symlink 失败:`, error);
    }
  }

  private async initRuntime(): Promise<void> {
    if (this.runtime) return;

    // 确保环境变量已设置（备用检查，以防构造函数没有设置）
    if (this.acpTool === 'openclaw' && !process.env.OPENCLAW_GATEWAY_TOKEN) {
      const gatewayToken = this.getOpenClawGatewayToken();
      if (gatewayToken) {
        process.env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
      }
    }

    const module = await getRuntimeModule();

    const providerCommand = createAcpProviderCommand({
      acpTool: this.acpTool,
      agentCommand: this.agentCommand,
      provider: this.llmProvider,
      agentId: this.agentId,
      agentName: this.name,
    });
    this.acpProviderInfo = providerCommand.providerInfo;

    // 创建 agent registry，始终使用传入的 agentCommand（可能包含自定义参数如 --session）
    const agentRegistry = module.createAgentRegistry({
      overrides: {
        // 使用传入的 agentCommand 覆盖默认 registry
        ...(providerCommand.command ? {[this.acpTool]: providerCommand.command} : {}),
      },
    });

    // 创建 session store
    const sessionDir = path.join(this.workDir, '.acpx-sessions');
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, {recursive: true});
    }
    const sessionStore = module.createFileSessionStore({stateDir: sessionDir});

    // Runtime options
    const options: AcpRuntimeOptions = {
      cwd: this.workDir,
      sessionStore,
      agentRegistry,
      mcpServers: [], // 必须提供空数组，否则 OpenClaw ACP session/new 会失败
      permissionMode: 'approve-all',
      probeAgent: this.acpTool,
    };

    this.runtime = new module.AcpxRuntime(options);

    // 确保 runtime 可用
    await this.runtime.probeAvailability();
  }

  /**
   * 从 OpenClaw 配置文件读取 Gateway Token
   */
  private getOpenClawGatewayToken(): string | null {
    try {
      const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      return config?.gateway?.auth?.token || null;
    } catch (error) {
      console.error(`${this.name}: 读取 OpenClaw 配置失败:`, error);
      return null;
    }
  }

  private isBuiltinAgent(tool: string): boolean {
    const builtinAgents = [
      'claude',
      'codex',
      'pi',
      'openclaw',
      'gemini',
      'cursor',
      'copilot',
    ];
    return builtinAgents.includes(tool);
  }

  private async ensureSession(): Promise<void> {
    if (!this.runtime) {
      await this.initRuntime();
    }

    if (this.handle) return;

    // 固定 session key（重启后可恢复）
    this.sessionKey = `${this.chatRoomId}-${this.agentId || 'default'}`;

    this.handle = await this.runtime!.ensureSession({
      sessionKey: this.sessionKey,
      agent: this.acpTool,
      mode: 'persistent',
      cwd: this.workDir,
    });
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
    // 设置流式输出回调
    this.emitStream = emitStream || null;
    this.emitToolCall = emitToolCall || null;
    this.emitThinking = emitThinking || null;

    // 确保 Skills symlink 存在（每次执行时检查，确保新安装的 skills 立即生效）
    this.ensureSkillsSymlink();

    try {
      await this.ensureSession();
    } catch (error) {
      this.emitStream = null;
      this.emitToolCall = null;
      this.emitThinking = null;
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit(
        `${this.acpTool} 初始化出错: ${errorMessage}`,
        originalMessageId,
      );
      throw error;
    }

    // 重置消息收集器
    this.messageCollector.reset();
    this.toolCalls = [];

    // 构建完整消息上下文
    let fullMessage = '';

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
        // 拦截 /clear 和 /new 命令：清除上下文，创建新 session
        console.log(`${this.name}: 拦截命令 ${command}，清除上下文`);

        const resultMessage = await this.handleClearContext(emit, originalMessageId);

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
    } else {
      // 正常模式：添加系统提示
      if (this.systemPrompt) {
        fullMessage += `【系统指令】\n${this.systemPrompt}\n\n`;
      }

      const longTermMemorySection = buildAgentLongTermMemorySection(this.chatRoomId, this.agentId, this.name);
      if (longTermMemorySection) {
        fullMessage += `${longTermMemorySection}\n\n`;
      }

      const skillsUpdateSection = this.buildSkillsUpdateSection();
      if (skillsUpdateSection) {
        fullMessage += `${skillsUpdateSection}\n\n`;
      }

      // 添加群历史摘要和最近消息
      if (this.injectGroupHistory && history && history.length > 0) {
        const memorySummary = history.find((msg) => msg.kind === 'memory_summary')?.content;
        const recentHistory = history.filter((msg) => msg.kind !== 'memory_summary');

        if (memorySummary) {
          fullMessage += `【群聊长期记忆摘要】
${memorySummary}

`;
        }

        if (recentHistory.length > 0) {
          const historyText = recentHistory
            .map((msg) => `[${msg.senderName}]: ${msg.content}`)
            .join('\n');

          fullMessage += `【最近群聊消息】以下是当前消息之前最近的群聊消息（共 ${recentHistory.length} 条）：
${historyText}

`;
        }
      }

      // 注入群内助手列表信息
      if (this.chatRoomAgents.length > 0) {
        const agentsInfo = this.chatRoomAgents.map(a => a.name).join('、');
        const otherAgents = this.chatRoomAgents.filter(
          (agent) => agent.name !== this.name,
        );

        const otherAgentsList = otherAgents.map(agent => agent.name).join('、');
        const othersInfo = otherAgents.length > 0 ? otherAgentsList : '无';
        const mentionTip =
          otherAgents.length > 0
            ? '\n【提示】\n直接输出 @助手名称 不会触发其他助手任务。需要协作时，请让用户在群聊中 @ 对应助手，或使用当前执行器支持的平台协作工具。'
            : '';

        fullMessage += `【群聊成员信息】
群聊工作目录：${this.workDir}
当前群聊中的助手有：${agentsInfo}
你是：${this.name}
其他助手：${othersInfo}${mentionTip}

`;
      }

      // 添加当前消息
      fullMessage += `【当前消息】\n${message}`;
    }

    // 保存上下文用于调试
    this.lastContext = fullMessage;

    try {
      // 检查是否已被中断
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      // 构建附件数组
      const runtimeAttachments: AcpRuntimeTurnAttachment[] = [];
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          runtimeAttachments.push({
            mediaType: att.mimeType,
            data: att.base64,
          });
        }
      }

      // 生成 request ID
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      console.log('fullMessage', fullMessage);
      // 执行 turn（传递 signal，让 acpx 内部处理中断）
      const eventStream = this.runtime!.runTurn({
        handle: this.handle!,
        text: fullMessage,
        attachments: runtimeAttachments,
        mode: 'prompt',
        requestId,
        signal,
      });

      // 处理事件流
      for await (const event of eventStream) {
        // 检查是否已被中断
        if (signal?.aborted) {
          throw new DOMException('执行已被用户中断', 'AbortError');
        }

        this.handleEvent(event);
      }

      // 检查是否在执行过程中被中断（acpx 返回 cancelled）
      if (this.messageCollector.lastEventType === 'cancelled') {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      const responseContent = this.messageCollector.content.slice(
        this.messageCollector.lastOutputStart,
      );
      const thinkingContent = this.messageCollector.thought;
      const thinkingTimestamp = this.messageCollector.thoughtTimestamp;
      const statusContent = this.messageCollector.statusText; // status 事件的内容

      // 清空流式回调
      this.emitStream = null;
      this.emitToolCall = null;

      // 保存工具调用信息和思考过程（带时间戳）
      const thinkingRecord = thinkingContent
        ? {
            content: thinkingContent,
            timestamp: thinkingTimestamp || Date.now(),
          }
        : undefined;

      this.lastInvokeResult = JSON.stringify(
        {
          toolCalls: this.toolCalls,
          responseLength: responseContent.length,
          statusLength: statusContent.length,
          thinking: thinkingRecord,
          fullContent: this.messageCollector.content,
          statusContent,
          lastOutputStart: this.messageCollector.lastOutputStart,
        },
        null,
        2,
      );

      // 确定最终响应内容：优先使用 output，其次使用 status 内容
      const finalResponse =
        responseContent || statusContent || `${this.acpTool} 执行完成`;
      await emit(finalResponse, originalMessageId);

      this.lastResponse = finalResponse;

      return {
        actions: [
          {
            type: 'message',
            content: finalResponse,
          },
        ],
      };
    } catch (error) {
      // 清空回调
      this.emitStream = null;
      this.emitToolCall = null;

      // 检查是否是中断错误
      if (error instanceof Error && error.name === 'AbortError') {
        // 不发送中断消息，直接抛出
        throw error;
      }
      console.error(`${this.name}: ${this.acpTool} 执行失败`, error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit(
        `${this.acpTool} 执行出错: ${errorMessage}`,
        originalMessageId,
      );
      throw error;
    }
  }

  private buildSkillsUpdateSection(): string {
    const currentSignature = buildInstalledSkillsSignature(this.agentId);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }

    this.lastInjectedSkillsSignature = currentSignature;
    return `【技能清单更新】
${buildInstalledSkillsInstructions(this.agentId)}`;
  }

  private handleEvent(event: AcpRuntimeEvent): void {
    // 详细日志：记录所有事件类型和内容到 debug 日志
    debugLog('acpEvent', {
      agentName: this.name,
      eventType: event.type,
      event: event as Record<string, unknown>,
    });

    switch (event.type) {
      case 'text_delta':
        this.handleTextDelta(event);
        break;
      case 'status':
        this.handleStatus(event);
        break;
      case 'tool_call':
        this.handleToolCall(event);
        break;
      case 'done':
        // 记录 stopReason（用于检测是否被取消）
        this.messageCollector.lastEventType = event.stopReason || 'done';
        break;
      case 'error':
        this.handleError(event);
        break;
    }
  }

  private handleTextDelta(
    event: Extract<AcpRuntimeEvent, {type: 'text_delta'}>,
  ): void {
    const {text, stream} = event;

    if (stream === 'thought') {
      // 思考内容
      // 记录思考开始时间戳
      if (!this.messageCollector.thoughtTimestamp) {
        this.messageCollector.thoughtTimestamp = Date.now();
      }
      this.messageCollector.thought += text;
      this.messageCollector.lastEventType = 'thinking';
      if (this.emitThinking) {
        this.emitThinking(text);
      }
    } else {
      // 输出内容
      // 如果从其他类型切换到 output，记录新的起始位置
      if (this.messageCollector.lastEventType !== 'output') {
        this.messageCollector.lastOutputStart =
          this.messageCollector.content.length;
      }
      this.messageCollector.content += text;
      this.messageCollector.lastEventType = 'output';
      if (this.emitStream) {
        this.emitStream(text);
      }
    }
  }

  private handleStatus(
    event: Extract<AcpRuntimeEvent, {type: 'status'}>,
  ): void {
    // status 事件可能包含命令输出（如 /context、/help 等）
    if (event.text) {
      this.messageCollector.statusText += event.text;
      this.messageCollector.lastEventType = 'status';
      console.log(`${this.name}: [status] ${event.text.substring(0, 100)}...`);
    }
  }

  private handleToolCall(
    event: Extract<AcpRuntimeEvent, {type: 'tool_call'}>,
  ): void {
    const {toolCallId, status, title} = event;
    const normalizedTitle = normalizeAcpToolTitle(title);
    const mappedStatus = mapAcpToolStatus(status);

    // 查找是否已存在该工具调用
    const existingToolCall = this.toolCalls.find(
      (tc) => tc.toolCallId === toolCallId,
    );

    if (!existingToolCall) {
      // 新工具调用
      const toolCall: ToolCall = {
        name: normalizedTitle || 'tool_call',
        input: {},
        toolCallId: toolCallId || 'unknown',
        status: mappedStatus || 'in_progress',
        timestamp: Date.now(), // 添加时间戳
      };
      this.toolCalls.push(toolCall);
      if (this.emitToolCall) {
        this.emitToolCall(toolCall);
      }
    } else if (existingToolCall) {
      // 状态更新
      let changed = false;

      if (normalizedTitle && existingToolCall.name !== normalizedTitle) {
        existingToolCall.name = normalizedTitle;
        changed = true;
      }

      if (mappedStatus && existingToolCall.status !== mappedStatus) {
        existingToolCall.status = mappedStatus;
        changed = true;
      }

      // 如果没有时间戳，添加完成时间戳
      if (!existingToolCall.timestamp) {
        existingToolCall.timestamp = Date.now();
        changed = true;
      }

      if (changed && this.emitToolCall) {
        this.emitToolCall(existingToolCall);
      }
    }
  }

  private handleError(event: Extract<AcpRuntimeEvent, {type: 'error'}>): void {
    console.error(
      `${this.name}: [error] ${event.message} (code=${event.code})`,
    );
  }

  getDebugInfo(): AgentDebugInfo {
    return {
      name: this.name,
      type: 'acp',
      systemPrompt: this.systemPrompt,
      chatRoomId: this.chatRoomId,
      acpTool: this.acpTool,
      workDir: this.workDir,
      injectGroupHistory: this.injectGroupHistory,
      lastContext: this.lastContext,
      lastInvokeResult: this.lastInvokeResult,
      lastResponse: this.lastResponse,
      lastHistory: null,
      agentId: this.agentId,
      chatRoomAgents: this.chatRoomAgents,
      llmProvider: this.acpProviderInfo || (this.llmProvider
        ? {
            id: this.llmProvider.id,
            name: this.llmProvider.name,
            type: this.llmProvider.type,
            model: this.llmProvider.model,
          }
        : undefined),
    };
  }

  async cleanup(): Promise<void> {
    if (this.runtime && this.handle) {
      try {
        await this.runtime.close({
          handle: this.handle,
          reason: 'cleanup',
        });
      } catch (error) {
        console.error(`${this.name}: 关闭 ${this.acpTool} 会话失败`, error);
      }
      this.handle = null;
      this.sessionKey = null;
    }
    this.runtime = null;
  }
}
