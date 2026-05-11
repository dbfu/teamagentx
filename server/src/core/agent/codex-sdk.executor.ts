import type { LlmProvider } from '@prisma/client';
import { Codex, type Thread, type ThreadEvent, type ThreadItem, type Usage } from '@openai/codex-sdk';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import { config as appConfig } from '../../config/index.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { buildAgentLongTermMemorySection } from './agent-long-term-memory.js';
import { debugLog } from './agent-handler/debug.js';
import { getInternalAgentToolToken } from './agent-handler/internal-agent-tool-auth.js';
import { buildAcpProviderEnv, type AcpProviderInfo } from './acp-provider.adapter.js';
import {
  resolveAgentWorkDir,
} from './work-dir.js';
import {
  buildInstalledSkillsInstructions,
  buildInstalledSkillsSignature,
} from './skill-instructions.js';
import type {
  AgentDebugInfo,
  AgentExecResult,
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

function getMessageWithoutMentions(message: string): string {
  const mentionRegex =
    /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_]+)(?=\s|$)/g;
  return message.trim().replace(mentionRegex, '').trim();
}

function normalizeUsage(usage: Usage | null | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const cacheReadTokens = Number(usage.cached_input_tokens || 0);
  const reasoningTokens = Number(usage.reasoning_output_tokens || 0);

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens,
    cacheReadTokens,
  };
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function attachmentExtension(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.jpg';
}

function getDefaultCodexAuthStatus(): { available: boolean; path: string } {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    if (!fs.existsSync(authPath)) return { available: false, path: authPath };
    const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    const hasApiKey = typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.length > 0;
    const hasChatGptTokens =
      data.tokens &&
      typeof data.tokens === 'object' &&
      typeof data.tokens.access_token === 'string' &&
      typeof data.tokens.refresh_token === 'string';
    return { available: Boolean(data.auth_mode && (hasApiKey || hasChatGptTokens)), path: authPath };
  } catch {
    return { available: false, path: authPath };
  }
}

const CODEX_THREAD_STATE_VERSION = 2;

export class CodexSdkExecutor implements IAgentExecutor {
  readonly name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir: string;
  readonly agentWorkDir: string | null;
  readonly chatRoomAgents: ChatRoomAgentInfo[];
  readonly llmProvider?: LlmProvider;

  private _lastInjectedMessageId?: string;
  private systemPrompt: string;
  private agentId: string | null = null;
  private threadId: string | null;
  private lastInjectedSkillsSignature?: string;
  private acpProviderInfo?: AcpProviderInfo;
  private currentAbortController: AbortController | null = null;
  private thread: Thread | null = null;

  private content = '';
  private thinking = '';
  private toolCalls: ToolCall[] = [];

  private lastContext: string | null = null;
  private lastResponse: string | null = null;
  private lastInvokeResult: string | null = null;

  private emitStream: StreamEmitCallback | null = null;
  private emitThinking: ThinkingEmitCallback | null = null;
  private emitToolCall: ToolCallEmitCallback | null = null;

  constructor(
    name: string,
    systemPrompt: string,
    chatRoomId: string,
    workDir: string | null,
    injectGroupHistory: boolean = true,
    agentId?: string,
    sessionDir?: string,
    customWorkDir?: string,
    lastInjectedMessageId?: string,
    chatRoomAgents?: ChatRoomAgentInfo[],
    llmProvider?: LlmProvider,
  ) {
    this.name = name;
    this.chatRoomId = chatRoomId;
    this.injectGroupHistory = injectGroupHistory;
    this.agentId = agentId || null;
    this.agentWorkDir = workDir || null;
    this._lastInjectedMessageId = lastInjectedMessageId;
    this.chatRoomAgents = chatRoomAgents || [];
    this.llmProvider = llmProvider;

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

    this.systemPrompt = `${modelInfo}
${systemPrompt}

## 工作目录
你的工作目录是：${this.workDir}
执行文件操作和命令时，默认在此目录下操作。使用相对路径时，基于此目录解析。`;

    this.ensureWorkDirectory();
    this.threadId = this.loadThreadId();
    this.lastInjectedSkillsSignature = this.loadSkillsSignature();
  }

  get lastInjectedMessageId(): string | undefined {
    return this._lastInjectedMessageId;
  }

  setLastInjectedMessageId(id: string): void {
    this._lastInjectedMessageId = id;
  }

  private ensureWorkDirectory(): void {
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  private getCodexHome(): string {
    return path.join(os.homedir(), '.teamagentx', 'acp-config', this.agentId || 'default', 'codex');
  }

  private ensureCodexAuthLink(): void {
    const sourceAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(sourceAuthPath)) return;

    const codexHome = this.getCodexHome();
    const targetAuthPath = path.join(codexHome, 'auth.json');
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });

    try {
      if (fs.existsSync(targetAuthPath)) {
        const stat = fs.lstatSync(targetAuthPath);
        if (stat.isSymbolicLink()) {
          const existingTarget = fs.readlinkSync(targetAuthPath);
          if (existingTarget === sourceAuthPath) return;
        } else {
          return;
        }
      }

      try {
        fs.rmSync(targetAuthPath, { force: true });
      } catch {
        // 忽略删除失败，后续 symlink 会报出真实错误。
      }
      fs.symlinkSync(sourceAuthPath, targetAuthPath);
    } catch (error) {
      console.warn(`${this.name}: 链接 Codex auth.json 失败:`, error);
    }
  }

  private ensureInstalledSkillsDirectory(): void {
    if (!this.agentId) return;

    const sourceSkillsDir = skillInstallService.getGlobalAgentSkillsDir(this.agentId);
    const codexHome = this.getCodexHome();
    const codexSkillsDir = path.join(codexHome, 'skills');

    try {
      fs.rmSync(codexSkillsDir, { recursive: true, force: true });
      fs.mkdirSync(codexSkillsDir, { recursive: true, mode: 0o700 });

      if (fs.existsSync(sourceSkillsDir)) {
        const entries = fs.readdirSync(sourceSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

          const sourceSkillPath = path.join(sourceSkillsDir, entry.name);
          if (!fs.existsSync(path.join(sourceSkillPath, 'SKILL.md'))) continue;

          const targetSkillPath = path.join(codexSkillsDir, entry.name);
          try {
            fs.symlinkSync(sourceSkillPath, targetSkillPath);
          } catch {
            fs.cpSync(sourceSkillPath, targetSkillPath, {
              recursive: true,
              dereference: true,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`${this.name}: 同步 Codex Skills 失败:`, error);
    }
  }

  private getTeamAgentXMcpServerPath(): string {
    return path.join(this.getCodexHome(), 'teamagentx-agent-tools-mcp.mjs');
  }

  private ensureTeamAgentXMcpServerFile(): string {
    const serverPath = this.getTeamAgentXMcpServerPath();
    const script = `#!/usr/bin/env node
const endpoint = process.env.TEAMAGENTX_SEND_MESSAGE_ENDPOINT;
const token = process.env.TEAMAGENTX_INTERNAL_TOOL_TOKEN;
const chatRoomId = process.env.TEAMAGENTX_CHAT_ROOM_ID;
const sourceAgentId = process.env.TEAMAGENTX_SOURCE_AGENT_ID;

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function toolResult(text, structuredContent, isError = false) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError,
  };
}

async function callSendMessage(args) {
  if (!endpoint || !token || !chatRoomId || !sourceAgentId) {
    return toolResult("TeamAgentX 工具环境不完整，无法发送助手消息。", {}, true);
  }

  const content = typeof args?.content === "string" ? args.content.trim() : "";
  const targetAgentId = typeof args?.targetAgentId === "string" ? args.targetAgentId.trim() : "";
  const targetAgentName = typeof args?.targetAgentName === "string" ? args.targetAgentName.trim() : "";
  if (!content || (!targetAgentId && !targetAgentName)) {
    return toolResult("参数错误：必须提供 content，以及 targetAgentId 或 targetAgentName。", {}, true);
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        chatRoomId,
        sourceAgentId,
        targetAgentId: targetAgentId || undefined,
        targetAgentName: targetAgentName || undefined,
        content,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "发送助手消息失败。", payload, true);
    }
    return toolResult("已发送给目标助手并加入任务队列。", payload.data || payload, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "发送助手消息失败。", {}, true);
  }
}

async function handle(request) {
  const { id, method, params } = request;
  if (!method) return;

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "tax", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [{
          name: "send_message",
          description: "向当前 TeamAgentX 群聊中的另一个助手发送公开消息，并触发该助手处理任务。消息会以 @目标助手名 消息内容 的格式显示在群聊中。",
          inputSchema: {
            type: "object",
            properties: {
              targetAgentId: { type: "string", description: "目标助手 ID。已知 ID 时优先使用。" },
              targetAgentName: { type: "string", description: "目标助手名称。未提供 ID 时使用。" },
              content: { type: "string", description: "发送给目标助手的消息内容，不要包含 @目标助手名前缀。" },
            },
            required: ["content"],
            additionalProperties: false,
          },
        }],
      },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name !== "send_message") {
      write({
        jsonrpc: "2.0",
        id,
        result: toolResult("未知工具：" + name, {}, true),
      });
      return;
    }
    const result = await callSendMessage(args);
    write({ jsonrpc: "2.0", id, result });
    return;
  }

  if (id !== undefined) {
    write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found: " + method },
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    Promise.resolve()
      .then(() => handle(JSON.parse(line)))
      .catch((error) => {
        write({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        });
      });
  }
});
`;

    fs.mkdirSync(path.dirname(serverPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(serverPath, script, { mode: 0o700 });
    return serverPath;
  }

  private getSessionStatePath(): string {
    const scope = createHash('sha256')
      .update(`${this.chatRoomId}:${this.workDir}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(this.getCodexHome(), `teamagentx-codex-sdk-session-${scope}.json`);
  }

  private getLegacySessionStatePath(): string {
    return path.join(this.getCodexHome(), 'teamagentx-codex-sdk-session.json');
  }

  private loadThreadId(): string | null {
    try {
      const statePath = this.getSessionStatePath();
      if (!fs.existsSync(statePath)) return null;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.version !== CODEX_THREAD_STATE_VERSION) {
        fs.rmSync(statePath, { force: true });
        return null;
      }
      return typeof state.threadId === 'string' ? state.threadId : null;
    } catch {
      return null;
    }
  }

  private loadSkillsSignature(): string | undefined {
    try {
      const statePath = this.getSessionStatePath();
      if (!fs.existsSync(statePath)) return undefined;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      return typeof state.skillsSignature === 'string' ? state.skillsSignature : undefined;
    } catch {
      return undefined;
    }
  }

  private saveThreadId(): void {
    try {
      const statePath = this.getSessionStatePath();
      if (!this.threadId) {
        fs.rmSync(statePath, { force: true });
        fs.rmSync(this.getLegacySessionStatePath(), { force: true });
        return;
      }
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            version: CODEX_THREAD_STATE_VERSION,
            threadId: this.threadId,
            skillsSignature: this.lastInjectedSkillsSignature,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      console.warn(`${this.name}: 保存 Codex SDK threadId 失败:`, error);
    }
  }

  private buildEnv(): Record<string, string> {
    if (!this.llmProvider) {
      const authStatus = getDefaultCodexAuthStatus();
      if (!authStatus.available) {
        throw new Error(`未检测到可用的本地 Codex auth.json: ${authStatus.path}`);
      }
    }
    this.ensureCodexAuthLink();

    const cleanEnv = sanitizeEnv(process.env);
    const keysToClear = [
      'CODEX_API_KEY',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENAI_MODEL',
    ];
    keysToClear.forEach((key) => delete cleanEnv[key]);

    const providerEnv = this.llmProvider
      ? buildAcpProviderEnv('codex', this.llmProvider, this.agentId)
      : {};

    if (this.llmProvider) {
      this.acpProviderInfo = {
        id: this.llmProvider.id,
        name: this.llmProvider.name,
        type: this.llmProvider.type,
        model: this.llmProvider.model,
        apiProtocol: ((this.llmProvider as any).apiProtocol || 'openai').toLowerCase(),
      };
    }

    return {
      ...cleanEnv,
      ...providerEnv,
      CODEX_HOME: this.getCodexHome(),
    };
  }

  private buildFullMessage(message: string, history?: HistoryMessage[]): string {
    let fullMessage = '';

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

    if (this.chatRoomAgents.length > 0) {
      const agentsInfo = this.chatRoomAgents.map((agent) => agent.name).join('、');
      const otherAgents = this.chatRoomAgents.filter((agent) => agent.name !== this.name);
      const otherAgentsList = otherAgents.map((agent) => agent.name).join('、');
      const othersInfo = otherAgents.length > 0 ? otherAgentsList : '无';
      const mentionTip = otherAgents.length > 0
        ? '\n【提示】\n需要把任务交给其他助手时，调用 tax.send_message 工具。不要通过直接输出 @助手名称 来触发其他助手。'
        : '';

      fullMessage += `【群聊成员信息】
群聊工作目录：${this.workDir}
当前群聊中的助手有：${agentsInfo}
你是：${this.name}
其他助手：${othersInfo}${mentionTip}

`;
    }

    fullMessage += `【当前消息】\n${message}`;
    return fullMessage;
  }

  private buildSkillsUpdateSection(): string {
    const currentSignature = buildInstalledSkillsSignature(this.agentId);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }

    this.lastInjectedSkillsSignature = currentSignature;
    if (this.threadId) {
      this.saveThreadId();
    }
    return `【技能清单更新】
${buildInstalledSkillsInstructions(this.agentId)}`;
  }

  private resetCollectors(): void {
    this.content = '';
    this.thinking = '';
    this.toolCalls = [];
  }

  private getCodex(): Codex {
    const env = this.buildEnv();
    const mcpServerPath = this.ensureTeamAgentXMcpServerFile();
    const sendMessageEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/send-message-to-agent`;
    const config = {
      hide_agent_reasoning: false,
      show_raw_agent_reasoning: false,
      model_reasoning_summary: 'concise',
      skills: {
        include_instructions: false,
      },
      mcp_servers: {
        tax: {
          command: process.execPath,
          args: [mcpServerPath],
          env: {
            TEAMAGENTX_SEND_MESSAGE_ENDPOINT: sendMessageEndpoint,
            TEAMAGENTX_INTERNAL_TOOL_TOKEN: getInternalAgentToolToken(),
            TEAMAGENTX_CHAT_ROOM_ID: this.chatRoomId,
            TEAMAGENTX_SOURCE_AGENT_ID: this.agentId || '',
            TEAMAGENTX_SOURCE_AGENT_NAME: this.name,
          },
        },
      },
      ...(this.llmProvider
        ? {
            model: this.llmProvider.model,
            model_provider: 'openai',
          }
        : {}),
    };

    return new Codex({
      env,
      apiKey: this.llmProvider?.apiKey,
      baseUrl: this.llmProvider?.apiUrl || undefined,
      config,
    });
  }

  private getThread(): Thread {
    const codex = this.getCodex();
    const options = {
      model: this.llmProvider?.model,
      workingDirectory: this.workDir,
      skipGitRepoCheck: true,
      sandboxMode: 'danger-full-access' as const,
      approvalPolicy: 'never' as const,
      networkAccessEnabled: true,
    };

    if (this.thread) return this.thread;
    this.thread = this.threadId
      ? codex.resumeThread(this.threadId, options)
      : codex.startThread(options);
    return this.thread;
  }

  private writeAttachments(attachments?: AttachmentData[]): { input: string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>; cleanup: () => void } {
    if (!attachments || attachments.length === 0) {
      return { input: this.lastContext || '', cleanup: () => undefined };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-images-'));
    const input: Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }> = [
      { type: 'text', text: this.lastContext || '' },
    ];

    attachments.forEach((attachment, index) => {
      const filePath = path.join(tempDir, `attachment-${index}${attachmentExtension(attachment.mimeType)}`);
      fs.writeFileSync(filePath, Buffer.from(attachment.base64, 'base64'));
      input.push({ type: 'local_image', path: filePath });
    });

    return {
      input,
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // 忽略临时文件清理失败。
        }
      },
    };
  }

  private upsertToolCall(toolCall: ToolCall): void {
    const existing = this.toolCalls.find((item) => item.toolCallId === toolCall.toolCallId);
    if (!existing) {
      this.toolCalls.push(toolCall);
      this.emitToolCall?.(toolCall);
      return;
    }

    let changed = false;
    for (const key of ['name', 'status', 'output'] as const) {
      if (toolCall[key] && existing[key] !== toolCall[key]) {
        (existing as any)[key] = toolCall[key];
        changed = true;
      }
    }
    if (toolCall.input && JSON.stringify(existing.input) !== JSON.stringify(toolCall.input)) {
      existing.input = toolCall.input;
      changed = true;
    }
    if (changed) this.emitToolCall?.(existing);
  }

  private appendContent(text: string): void {
    if (!text) return;
    if (text.startsWith(this.content)) {
      const delta = text.slice(this.content.length);
      if (delta) this.emitStream?.(delta);
      this.content = text;
      return;
    }
    this.content += text;
    this.emitStream?.(text);
  }

  private appendThinking(text: string): void {
    if (!text) return;
    if (text.startsWith(this.thinking)) {
      const delta = text.slice(this.thinking.length);
      if (delta) this.emitThinking?.(delta);
      this.thinking = text;
      return;
    }
    this.thinking += text;
    this.emitThinking?.(text);
  }

  private statusFromItem(item: ThreadItem): ToolCall['status'] {
    if ('status' in item && item.status === 'failed') return 'error';
    if ('status' in item && item.status === 'completed') return 'completed';
    return 'in_progress';
  }

  private handleItem(item: ThreadItem): void {
    switch (item.type) {
      case 'agent_message':
        this.appendContent(item.text);
        return;
      case 'reasoning':
        this.appendThinking(item.text);
        return;
      case 'command_execution':
        this.upsertToolCall({
          name: 'shell',
          input: { command: item.command },
          toolCallId: item.id,
          status: this.statusFromItem(item),
          output: item.aggregated_output,
          timestamp: Date.now(),
        });
        return;
      case 'file_change':
        this.upsertToolCall({
          name: 'file_change',
          input: { changes: item.changes },
          toolCallId: item.id,
          status: this.statusFromItem(item),
          timestamp: Date.now(),
        });
        return;
      case 'mcp_tool_call':
        this.upsertToolCall({
          name: `${item.server}.${item.tool}`,
          input: { arguments: item.arguments },
          toolCallId: item.id,
          status: this.statusFromItem(item),
          output: item.error?.message || JSON.stringify(item.result || {}),
          timestamp: Date.now(),
        });
        return;
      case 'web_search':
        this.upsertToolCall({
          name: 'web_search',
          input: { query: item.query },
          toolCallId: item.id,
          status: 'completed',
          timestamp: Date.now(),
        });
        return;
      case 'todo_list':
        this.appendThinking(
          item.items.map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`).join('\n'),
        );
        return;
      case 'error':
        this.upsertToolCall({
          name: 'error',
          input: {},
          toolCallId: item.id,
          status: 'error',
          output: item.message,
          timestamp: Date.now(),
        });
        return;
      default:
        return;
    }
  }

  private handleEvent(event: ThreadEvent): TokenUsage | undefined {
    debugLog('codexSdkEvent', {
      agentName: this.name,
      eventType: event.type,
      event: event as Record<string, unknown>,
    });

    switch (event.type) {
      case 'thread.started':
        this.threadId = event.thread_id;
        this.saveThreadId();
        return undefined;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItem(event.item);
        return undefined;
      case 'turn.completed':
        return normalizeUsage(event.usage);
      case 'turn.failed':
        throw new Error(event.error.message);
      case 'error':
        throw new Error(event.message);
      default:
        return undefined;
    }
  }

  private async handleClearContext(
    emit: MessageEmitCallback,
    originalMessageId: string,
  ): Promise<string> {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    this.thread = null;
    this.threadId = null;
    this._lastInjectedMessageId = undefined;
    if (this.agentId) {
      await agentMemoryService.clear(this.chatRoomId, this.agentId);
    }
    this.resetCollectors();
    this.lastContext = null;
    this.lastResponse = null;
    this.lastInvokeResult = null;
    this.saveThreadId();
    const resultMessage = '✅ 上下文已清除，开始新的对话';
    await emit(resultMessage, originalMessageId);
    return resultMessage;
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
    attachments?: AttachmentData[],
  ): Promise<AgentExecResult> {
    this.emitStream = emitStream || null;
    this.emitToolCall = emitToolCall || null;
    this.emitThinking = emitThinking || null;
    this.resetCollectors();
    this.ensureInstalledSkillsDirectory();

    const messageWithoutMentions = getMessageWithoutMentions(message);
    if (messageWithoutMentions.startsWith('/')) {
      const command = messageWithoutMentions.toLowerCase().trim();
      if (command === '/clear' || command === '/new') {
        const resultMessage = await this.handleClearContext(emit, originalMessageId);
        return { actions: [{ type: 'message', content: resultMessage }] };
      }

      const unsupportedMessage = `暂不支持当前指令: ${command}`;
      await emit(unsupportedMessage, originalMessageId);
      return { actions: [{ type: 'message', content: unsupportedMessage }] };
    }

    this.lastContext = this.buildFullMessage(message, history);
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const abort = () => abortController.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let tokenUsage: TokenUsage | undefined;
    const { input, cleanup } = this.writeAttachments(attachments);

    try {
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      const thread = this.getThread();
      const { events } = await thread.runStreamed(input, { signal: abortController.signal });

      for await (const event of events) {
        if (signal?.aborted) {
          throw new DOMException('执行已被用户中断', 'AbortError');
        }
        const usage = this.handleEvent(event);
        if (usage) tokenUsage = usage;
      }

      if (thread.id && thread.id !== this.threadId) {
        this.threadId = thread.id;
        this.saveThreadId();
      }

      const finalResponse = this.content || 'codex 执行完成';
      await emit(finalResponse, originalMessageId);
      this.lastResponse = finalResponse;
      this.lastInvokeResult = JSON.stringify(
        {
          toolCalls: this.toolCalls,
          responseLength: finalResponse.length,
          thinking: this.thinking ? { content: this.thinking, timestamp: Date.now() } : undefined,
          threadId: this.threadId,
        },
        null,
        2,
      );

      return {
        actions: [{ type: 'message', content: finalResponse }],
        tokenUsage,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      console.error(`${this.name}: codex sdk 执行失败`, error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await emit(`codex 执行出错: ${errorMessage}`, originalMessageId);
      throw error;
    } finally {
      cleanup();
      signal?.removeEventListener('abort', abort);
      this.currentAbortController = null;
      this.emitStream = null;
      this.emitToolCall = null;
      this.emitThinking = null;
    }
  }

  getDebugInfo(): AgentDebugInfo {
    return {
      name: this.name,
      type: 'acp',
      systemPrompt: this.systemPrompt,
      chatRoomId: this.chatRoomId,
      acpTool: 'codex',
      workDir: this.workDir,
      injectGroupHistory: this.injectGroupHistory,
      lastContext: this.lastContext,
      lastInvokeResult: this.lastInvokeResult,
      lastResponse: this.lastResponse,
      lastHistory: null,
      threadId: this.threadId || undefined,
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
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    this.thread = null;
    this.threadId = null;
    this.resetCollectors();
    this.lastContext = null;
    this.lastResponse = null;
    this.lastInvokeResult = null;
    this.saveThreadId();
  }
}
