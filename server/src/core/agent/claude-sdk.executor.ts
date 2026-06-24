import type {
    HookCallbackMatcher,
    HookEvent,
    SDKMessage,
    SDKUserMessage,
    SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import {
    createSdkMcpServer,
    query,
    tool as sdkTool,
} from '@anthropic-ai/claude-agent-sdk';
import type { LlmProvider } from '@prisma/client';
import { execFileSync, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import treeKill from 'tree-kill';
import { z } from 'zod/v4';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { buildRoomMessageIndexSection } from '../../modules/message/room-message-index.service.js';
import { quickChatSessionService } from '../../modules/quick-chat-session/quick-chat-session.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { backgroundCommandService } from '../shell/background-command.service.js';
import { getDefaultShell } from '../shell/default-shell.js';
import {
    buildAcpProviderEnv,
    type AcpProviderInfo,
} from './acp-provider.adapter.js';
import {
  buildAgentBaseSystemPrompt,
  buildGroupChatMemberInfoSection,
  buildHandoffTurnReminder,
  buildNoAssistantHandoffTurnReminder,
  getClaudeShellCommandsSection,
  getResponseStyleInstruction,
} from './agent-system-prompt.js';
import { normalizeLocale, pickLocaleText, type Locale } from './agent-handler/locale.js';
import { debugLog } from './agent-handler/debug.js';
import {
  buildShellEnvFromRoomEnvVars,
  type RoomEnvVar,
} from './room-env-vars.js';
import {
  buildAgentLongTermMemoryContentSection,
  buildAgentLongTermMemoryInstructions,
} from './agent-long-term-memory.js';
import type {
    AgentDebugInfo,
    AgentExecOptions,
    AgentExecResult,
    AgentSessionSnapshot,
    AgentTriggerMode,
    ChatRoomAgentInfo,
    HistoryMessage,
    IAgentExecutor,
    MessageEmitCallback,
    RecordEmitCallback,
    StreamEmitCallback,
    ThinkingEmitCallback,
    TokenUsage,
    ToolCall,
    ToolCallEmitCallback,
} from './executor.interface.js';
import { coerceThinkingText } from './executor.interface.js';
import { generateImageForAgent } from './image-generation.service.js';
import { buildInstalledSkillNames } from './skill-instructions.js';
import { getContextResetCommand } from './context-reset-command.js';
import {
  syncGlobalClaudeLocalConfig,
  stripProviderConflictingClaudeSettings,
} from './claude-local-config.js';
import { getSystemAssistantTools } from './tools/index.js';
import {
  DEFAULT_AGENT_THINKING_MODE,
  type AgentThinkingMode,
} from './thinking-mode.js';
import { getDefaultChatRoomWorkDir, resolveAgentWorkDir } from './work-dir.js';
import { getAgentConnectors, toClaudeMcpServers } from './connector.adapter.js';

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function sanitizeClaudeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block: any) => {
      if (block?.type === 'text' && typeof block.text === 'string')
        return block.text;
      return '';
    })
    .join('');
}

function extractThinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';

  return content
    .map((block: any) => {
      if (block?.type === 'thinking' && typeof block.thinking === 'string')
        return block.thinking;
      return '';
    })
    .join('');
}

function normalizeUsage(usage: any): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  const cacheReadTokens = Number(
    usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0,
  );
  const cacheCreationTokens = Number(
    usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0,
  );

  if (
    !inputTokens &&
    !outputTokens &&
    !cacheReadTokens &&
    !cacheCreationTokens
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    cacheReadTokens,
    cacheCreationTokens,
  };
}

function stringifyMcpToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined) return '';
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function toStructuredContent(value: unknown): Record<string, unknown> {
  try {
    const plain = JSON.parse(JSON.stringify(value ?? {}));
    if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
      return plain as Record<string, unknown>;
    }
    return {value: plain};
  } catch {
    return {value: stringifyMcpToolResult(value)};
  }
}

const requireFromServerBundle = createRequire(import.meta.url);
const requireFromClaudeSdk = (() => {
  try {
    return createRequire(
      requireFromServerBundle.resolve('@anthropic-ai/claude-agent-sdk'),
    );
  } catch {
    return requireFromServerBundle;
  }
})();

function redactValue(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.length <= 12) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function logClaudeSdkDebug(
  message: string,
  details?: Record<string, unknown>,
): void {
  if (details) {
    console.log(`[ClaudeSDK] ${message}`, details);
    return;
  }
  console.log(`[ClaudeSDK] ${message}`);
}

function getClaudeMaxTurns(): number {
  const rawValue = process.env.CLAUDE_AGENT_MAX_TURNS;
  if (!rawValue) return 200;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 200;

  return parsed;
}

function getClaudeThinkingOptions(
  provider?: LlmProvider,
  thinkingMode?: AgentThinkingMode | null,
):
  | {type: 'adaptive'}
  | {type: 'enabled'; budgetTokens?: number}
  | {type: 'disabled'}
  | undefined {
  if ((provider as any)?.supportsThinking === false) {
    return {type: 'disabled'};
  }

  if (thinkingMode) {
    const mode = thinkingMode || DEFAULT_AGENT_THINKING_MODE;
    if (mode === 'off') return {type: 'disabled'};
    const budgetTokensByMode: Record<Exclude<AgentThinkingMode, 'off'>, number> = {
      minimal: 2000,
      low: 4000,
      medium: 10000,
      high: 16000,
      xhigh: 24000,
      max: 32000,
    };
    return {type: 'enabled', budgetTokens: budgetTokensByMode[mode]};
  }

  const mode = (process.env.CLAUDE_AGENT_THINKING || 'enabled').toLowerCase();

  if (
    mode === 'disabled' ||
    mode === 'off' ||
    mode === '0'
  ) {
    return {type: 'disabled'};
  }

  if (mode === 'adaptive') {
    return {type: 'adaptive'};
  }

  const rawBudget = process.env.CLAUDE_AGENT_THINKING_BUDGET_TOKENS;
  const budgetTokens = rawBudget ? Number.parseInt(rawBudget, 10) : 16000;
  if (!Number.isFinite(budgetTokens) || budgetTokens < 1) {
    return {type: 'enabled', budgetTokens: 16000};
  }

  return {type: 'enabled', budgetTokens};
}

// 根据自定义供应商的真实上下文窗口，计算 Claude SDK 的自动压缩窗口。
// SDK 的 autoCompactWindow 仅接受 100K~1M 的整数（超出会被静默丢弃），
// 因此这里夹取到该区间，让 Claude 在接近后端模型真实上限前提前压缩，避免撑爆卡死。
const CLAUDE_AUTO_COMPACT_MIN = 100_000;
const CLAUDE_AUTO_COMPACT_MAX = 1_000_000;

function getClaudeAutoCompactWindow(provider?: LlmProvider): number | undefined {
  // 仅在接入自定义供应商时覆盖；使用宿主机 Claude 默认配置时不干预其原生窗口
  if (!provider) return undefined;
  const raw = (provider as any).contextLength;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(CLAUDE_AUTO_COMPACT_MAX, Math.max(CLAUDE_AUTO_COMPACT_MIN, Math.floor(raw)));
}

function isSessionAlreadyInUseError(message: string): boolean {
  return (
    /Session ID .+ is already in use/.test(message) ||
    message.includes('session ID is already in use')
  );
}

function isRecoverableSessionError(message: string): boolean {
  return (
    message.includes('Claude Code process exited with code 1') ||
    message.includes('No conversation found with session ID') ||
    message.includes('has invalid role: system') ||
    isSessionAlreadyInUseError(message)
  );
}

// 会话本身已不可用，必须重置（新建 session），无法靠 resume 同一会话恢复。
// 注意：resetSession 会删除 jsonl 会话文件 = 丢掉整段对话历史，所以仅限这两类真正
// 损坏/丢失的情况。其余可恢复错误（如子进程瞬时崩溃 exited with code 1、会话被占用）
// 只应原样 resume 重试，绝不能删历史，否则长对话里会突然失忆。
function isSessionUnusableError(message: string): boolean {
  return (
    message.includes('No conversation found with session ID') ||
    message.includes('has invalid role: system')
  );
}

const DEFAULT_BACKGROUND_IDLE_FINISH_MS = 60 * 1000;
function getBackgroundIdleFinishMs(): number {
  const rawValue = process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
  if (!rawValue) return DEFAULT_BACKGROUND_IDLE_FINISH_MS;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return DEFAULT_BACKGROUND_IDLE_FINISH_MS;
  }

  return parsed;
}

function shouldApplyBackgroundIdleFinish(state: {
  hasBackgroundedLongRunningCommand: boolean;
  waitingForTaskOutput: boolean;
  waitingForAssistantAfterToolResult: boolean;
}): boolean {
  return (
    state.hasBackgroundedLongRunningCommand &&
    !state.waitingForTaskOutput &&
    !state.waitingForAssistantAfterToolResult
  );
}

function getClaudeSettingSources(hasLlmProvider: boolean): SettingSource[] {
  return hasLlmProvider ? ['user'] : ['user', 'project', 'local'];
}

export const __claudeSdkTestUtils = {
  getClaudeSettingSources,
  getBackgroundIdleFinishMs,
  shouldApplyBackgroundIdleFinish,
  getClaudeAutoCompactWindow,
};

function resolveClaudeCodeExecutable(): string | undefined {
  const isWindows = process.platform === 'win32';
  const extension = isWindows ? '.exe' : '';
  const packageNames =
    process.platform === 'linux'
      ? [
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl`,
          `@anthropic-ai/claude-agent-sdk-linux-${process.arch}`,
        ]
      : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];

  const tried: string[] = [];

  // SDK 直接 spawn 该路径，且非 .js/.mjs/.cjs/.ts/.tsx/.jsx 都被当成 native binary 执行。
  // 这意味着 Windows 上的 .cmd/.ps1 shim 不能作为 pathToClaudeCodeExecutable —— spawn
  // 不走 shell，会直接 ENOENT。我们只接受真正的 native binary 或 JS 文件。
  const isAcceptableExecutable = (candidate: string): boolean => {
    if (isWindows) {
      // Windows: 接受 .exe（native binary）或 .cjs/.js/.mjs（用 node 解释执行）
      return /\.(exe|cjs|js|mjs)$/i.test(candidate);
    }
    return true;
  };

  const tryPathStrict = (
    label: string,
    candidate: string | undefined,
  ): string | undefined => {
    if (!candidate) {
      tried.push(`${label}: <empty>`);
      return undefined;
    }
    if (!fs.existsSync(candidate)) {
      tried.push(`${label}: ${candidate} (missing)`);
      return undefined;
    }
    if (!isAcceptableExecutable(candidate)) {
      tried.push(
        `${label}: ${candidate} (rejected: cannot be spawned directly on Windows)`,
      );
      return undefined;
    }
    console.log(
      `[ClaudeSDK] resolved claude executable via ${label}: ${candidate}`,
    );
    return candidate;
  };

  // 1. 优先使用用户本地（PATH）安装的 claude CLI —— 让桌面版的「claude 原生」
  //    与用户在终端里直接跑 claude 的行为保持一致：模型别名（如 opus）解析、新特性
  //    都跟随用户自己安装的 CLI 版本，避免内置旧 CLI 把别名解析成与终端不同的具体
  //    模型。找不到 PATH 里的 claude 时，再回退到下方的内置/SDK 自带版本。
  try {
    const cmd = isWindows ? 'where' : 'which';
    const result = execFileSync(cmd, ['claude'], {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    }).trim();
    const lines = result
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // Windows where 通常按 PATHEXT 顺序返回多行：.exe / .cmd / .ps1 / 无扩展名；
    // 我们只接受 .exe（直接 spawn 可工作）。.cmd 在 Windows 上 spawn 会失败。
    for (const line of lines) {
      const found = tryPathStrict(`PATH(${cmd})`, line);
      if (found) return found;
    }
    // 如果 PATH 只能找到 .cmd shim，尝试解析它指向的真实包，再用 cli-wrapper.cjs 兜底
    if (isWindows) {
      const cmdShim = lines.find((line) => line.toLowerCase().endsWith('.cmd'));
      if (cmdShim) {
        const wrapperFromShim = resolveCliWrapperFromCmdShim(cmdShim);
        const found = tryPathStrict(
          'PATH(.cmd → cli-wrapper.cjs)',
          wrapperFromShim,
        );
        if (found) return found;
      }
    }
  } catch (error) {
    tried.push(
      `PATH lookup threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2. 回退：SDK 自带的原生二进制（打包后通常被 yml filter 排除以减小体积，
  //    所以这里多半失败，是预期的）
  for (const packageName of packageNames) {
    try {
      const resolved = requireFromClaudeSdk.resolve(
        `${packageName}/claude${extension}`,
      );
      if (fs.existsSync(resolved)) {
        console.log(
          `[ClaudeSDK] resolved claude executable via sdk-native[${packageName}]: ${resolved}`,
        );
        return resolved;
      }
      tried.push(
        `sdk-native[${packageName}]: ${resolved} (missing — 通常是因为打包阶段排除了 native 子包)`,
      );
    } catch (error) {
      tried.push(
        `sdk-native[${packageName}]: resolve threw ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 3. 回退：应用本地安装目录（TOOLS_DIR，桌面版打包内置的 claude）
  const toolsDir = process.env.TOOLS_DIR;
  if (toolsDir) {
    // 3a. @anthropic-ai/claude-code 包的 bin/claude(.exe) —— postinstall 复制的真 native binary，最优
    const claudeCodePkgBin = path.join(
      toolsDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude' + extension,
    );
    const v3a = tryPathStrict(
      'tools-dir/@anthropic-ai/claude-code/bin',
      claudeCodePkgBin,
    );
    if (v3a) return v3a;

    // 3b. .bin shim：非 Windows 走这里（Windows 上 .bin/claude.cmd 不可直接 spawn，跳过）
    if (!isWindows) {
      const localBin = path.join(toolsDir, 'node_modules', '.bin', 'claude');
      const v3b = tryPathStrict('tools-dir/node_modules/.bin', localBin);
      if (v3b) return v3b;
    }

    // 3c. Windows 上 npm global-style --prefix 直接根目录有 .exe 的情况（少见但兜底）
    if (isWindows) {
      const v3c = tryPathStrict(
        'tools-dir/claude.exe',
        path.join(toolsDir, 'claude.exe'),
      );
      if (v3c) return v3c;
    }

    // 3d. cli-wrapper.cjs —— postinstall 失败时的兜底，SDK 会用 node 执行 .cjs
    const cliWrapper = path.join(
      toolsDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli-wrapper.cjs',
    );
    const v3d = tryPathStrict(
      'tools-dir/@anthropic-ai/claude-code/cli-wrapper.cjs',
      cliWrapper,
    );
    if (v3d) return v3d;
  } else {
    tried.push('TOOLS_DIR: <unset>');
  }

  console.warn(
    '[ClaudeSDK] 找不到可直接 spawn 的 claude 可执行文件，已尝试：\n  - ' +
      tried.join('\n  - '),
  );
  return undefined;
}

/**
 * 从 npm 在 Windows 生成的 claude.cmd shim 解析出对应的 @anthropic-ai/claude-code
 * 包根目录，再返回其 cli-wrapper.cjs。这是当用户全局/局部安装但 SDK 不能直接
 * spawn .cmd 时的兜底：用 cli-wrapper.cjs 让 SDK 用 node 执行。
 */
function resolveCliWrapperFromCmdShim(cmdShimPath: string): string | undefined {
  try {
    const content = fs.readFileSync(cmdShimPath, 'utf-8');
    // npm shim 形如：node "%~dp0\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
    // 或：node "%~dp0\..\@anthropic-ai\claude-code\bin\claude.exe"
    const match = content.match(/[%~dp0\\\/.][^"\r\n]*claude-code[^"\r\n]*/i);
    if (!match) return undefined;
    const relative = match[0]
      .replace(/^%~dp0[\\/]/i, '')
      .replace(/\\/g, path.sep);
    const shimDir = path.dirname(cmdShimPath);
    const resolved = path.resolve(shimDir, relative);
    // 从 bin/claude.exe 回退到包根，再到 cli-wrapper.cjs
    const claudeCodeRoot = resolved.split(
      /[\\/]@anthropic-ai[\\/]claude-code/,
    )[0];
    const wrapper = path.join(
      claudeCodeRoot,
      '@anthropic-ai',
      'claude-code',
      'cli-wrapper.cjs',
    );
    return fs.existsSync(wrapper) ? wrapper : undefined;
  } catch {
    return undefined;
  }
}

export class ClaudeAgentSdkExecutor implements IAgentExecutor {
  readonly name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir: string;
  readonly agentWorkDir: string | null;
  readonly chatRoomAgents: ChatRoomAgentInfo[];
  readonly llmProvider?: LlmProvider;
  readonly imageGenerationProvider?: LlmProvider | null;
  readonly thinkingMode: AgentThinkingMode;
  readonly stateless: boolean;
  readonly roomEnvVars: RoomEnvVar[];

  private _lastInjectedMessageId?: string;
  private systemPrompt: string;
  private systemPromptWithoutAssistantHandoff: string;
  private agentTriggerMode?: AgentTriggerMode;
  private locale: Locale = 'zh-CN';
  private agentId: string | null = null;
  private sessionId: string;
  private hasStartedSession = false;
  private acpProviderInfo?: AcpProviderInfo;
  private currentAbortController: AbortController | null = null;

  private content = '';
  private thinking = '';
  private runtimeModel: string | null = null; // SDK 返回的实际模型名称
  private toolCalls: ToolCall[] = [];
  private hasBackgroundedLongRunningCommand = false;
  private waitingForTaskOutput = false;
  private waitingForAssistantAfterToolResult = false;
  private receivedAssistantEndTurn = false;

  private lastContext: string | null = null;
  private lastResponse: string | null = null;
  private lastInvokeResult: string | null = null;
  private lastClaudeStderr = '';
  // 懒解析：每次访问都查一次（几次 fs.existsSync，开销极小），避免实例化时
  // 用户尚未装 claude，后续装好仍因为缓存了 undefined 而继续报错。
  private get claudeCodeExecutable(): string | undefined {
    return resolveClaudeCodeExecutable();
  }

  private emitStream: StreamEmitCallback | null = null;
  private emitThinking: ThinkingEmitCallback | null = null;
  private emitToolCall: ToolCallEmitCallback | null = null;
  private emitRecord: RecordEmitCallback | null = null;
  // 当前文本段是否已记入执行详情（避免同一段在多个 tool_use 块上重复记录）
  private pendingSegmentRecorded = false;

  constructor(
    name: string,
    systemPrompt: string,
    chatRoomId: string,
    workDir: string | null,
    injectGroupHistory: boolean = false,
    agentId?: string,
    sessionDir?: string,
    customWorkDir?: string,
    lastInjectedMessageId?: string,
    chatRoomAgents?: ChatRoomAgentInfo[],
    llmProvider?: LlmProvider,
    imageGenerationProvider?: LlmProvider | null,
    thinkingMode?: AgentThinkingMode | null,
    chatRoomRules?: string,
    stateless: boolean = false,
    agentTriggerMode?: AgentTriggerMode,
    roomEnvVars: RoomEnvVar[] = [],
    locale?: string,
  ) {
    this.name = name;
    this.chatRoomId = chatRoomId;
    this.injectGroupHistory = injectGroupHistory;
    this.agentId = agentId || null;
    this.agentWorkDir = workDir || null;
    this._lastInjectedMessageId = lastInjectedMessageId;
    this.chatRoomAgents = chatRoomAgents || [];
    this.llmProvider = llmProvider;
    this.imageGenerationProvider = imageGenerationProvider;
    this.thinkingMode = thinkingMode || DEFAULT_AGENT_THINKING_MODE;
    this.stateless = stateless;
    this.roomEnvVars = roomEnvVars;
    this.agentTriggerMode = agentTriggerMode;
    this.locale = normalizeLocale(locale);
    this.workDir = resolveAgentWorkDir({
      chatRoomId,
      sessionDir,
      customWorkDir,
      agentWorkDir: workDir,
    });
    const savedSession = this.stateless ? null : this.loadSessionState();
    this.sessionId = savedSession?.sessionId || randomUUID();
    this.hasStartedSession = savedSession?.hasStartedSession ?? false;

    this.systemPrompt = buildAgentBaseSystemPrompt({
      agentPrompt: systemPrompt,
      llmProvider: this.llmProvider,
      imageGenerationProvider: this.imageGenerationProvider,
      chatRoomRules,
      workDir: this.workDir,
      agentTriggerMode,
      commandSection: getClaudeShellCommandsSection(this.locale),
      roomEnvVars: this.roomEnvVars,
      locale: this.locale,
    });
    this.systemPromptWithoutAssistantHandoff = buildAgentBaseSystemPrompt({
      agentPrompt: systemPrompt,
      llmProvider: this.llmProvider,
      imageGenerationProvider: this.imageGenerationProvider,
      chatRoomRules,
      workDir: this.workDir,
      agentTriggerMode,
      commandSection: getClaudeShellCommandsSection(this.locale),
      roomEnvVars: this.roomEnvVars,
      locale: this.locale,
      includeAssistantHandoffRules: false,
    });

    this.ensureWorkDirectory();
  }

  get lastInjectedMessageId(): string | undefined {
    return this._lastInjectedMessageId;
  }

  setLastInjectedMessageId(id: string): void {
    this._lastInjectedMessageId = id;
  }

  getSessionSnapshot(): AgentSessionSnapshot | null {
    if (this.stateless || !this.sessionId) return null;
    return {
      type: 'claude',
      sessionId: this.sessionId,
      hasStartedSession: this.hasStartedSession,
    };
  }

  applySessionSnapshot(snapshot: AgentSessionSnapshot): boolean {
    if (this.stateless || snapshot.type !== 'claude') return false;
    if (!snapshot.sessionId) return false;
    this.sessionId = snapshot.sessionId;
    this.hasStartedSession = snapshot.hasStartedSession;
    this.saveSessionId();
    logClaudeSdkDebug('applied fallback session snapshot', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      sessionId: this.sessionId,
      hasStartedSession: this.hasStartedSession,
      statePath: this.getSessionStatePath(),
    });
    return true;
  }

  private ensureWorkDirectory(): void {
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, {recursive: true});
    }
  }

  private getClaudeConfigDir(): string {
    return path.join(
      os.homedir(),
      '.teamagentx',
      'acp-config',
      this.agentId || 'default',
    );
  }

  private getSessionStatePath(): string {
    const scope = `${this.chatRoomId}-${shortHash(this.workDir)}`;
    return path.join(this.getClaudeConfigDir(), 'sessions', `${scope}.json`);
  }

  private getClaudeConversationPath(sessionId: string): string {
    return path.join(
      this.getClaudeConfigDir(),
      'projects',
      sanitizeClaudeProjectPath(this.workDir),
      `${sessionId}.jsonl`,
    );
  }

  private ensureResumableSessionExists(): void {
    if (!this.hasStartedSession) return;

    const conversationPath = this.getClaudeConversationPath(this.sessionId);
    if (fs.existsSync(conversationPath)) return;

    console.warn(
      `${this.name}: Claude SDK session 文件不存在，创建新 session`,
      {
        sessionId: this.sessionId,
        conversationPath,
        statePath: this.getSessionStatePath(),
      },
    );
    this.resetSession();
  }

  private async applyLocalClaudeSessionBinding(): Promise<void> {
    if (this.stateless || !this.agentId) return;

    const binding = await quickChatSessionService.getClaudeSessionBindingByChatRoom(
      this.chatRoomId,
      this.agentId,
    );
    if (!binding?.sessionId) return;

    if (this.sessionId === binding.sessionId && this.hasStartedSession) return;

    this.sessionId = binding.sessionId;
    this.hasStartedSession = true;
    this.saveSessionId();
    logClaudeSdkDebug('applied local Claude session binding', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      sessionId: this.sessionId,
      title: binding.title,
    });
  }

  private loadSessionState(): {
    sessionId: string;
    hasStartedSession: boolean;
  } | null {
    try {
      const statePath = this.getSessionStatePath();
      if (!fs.existsSync(statePath)) {
        logClaudeSdkDebug('session state not found', {
          agentName: this.name,
          agentId: this.agentId,
          statePath,
        });
        return null;
      }
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (typeof state.sessionId !== 'string') {
        logClaudeSdkDebug('session state ignored: missing sessionId', {
          agentName: this.name,
          agentId: this.agentId,
          statePath,
        });
        return null;
      }
      const loaded = {
        sessionId: state.sessionId,
        hasStartedSession: state.hasStartedSession !== false,
      };
      const conversationPath = this.getClaudeConversationPath(loaded.sessionId);
      if (!loaded.hasStartedSession && fs.existsSync(conversationPath)) {
        logClaudeSdkDebug(
          'session state ignored: unstarted session already has conversation file',
          {
            agentName: this.name,
            agentId: this.agentId,
            statePath,
            sessionId: loaded.sessionId,
            conversationPath,
          },
        );
        return null;
      }
      if (loaded.hasStartedSession && !fs.existsSync(conversationPath)) {
        logClaudeSdkDebug(
          'session state ignored: conversation file not found',
          {
            agentName: this.name,
            agentId: this.agentId,
            statePath,
            sessionId: loaded.sessionId,
            conversationPath,
          },
        );
        return null;
      }
      logClaudeSdkDebug('session state loaded', {
        agentName: this.name,
        agentId: this.agentId,
        statePath,
        sessionId: loaded.sessionId,
        hasStartedSession: loaded.hasStartedSession,
      });
      return loaded;
    } catch {
      logClaudeSdkDebug('session state load failed', {
        agentName: this.name,
        agentId: this.agentId,
        statePath: this.getSessionStatePath(),
      });
      return null;
    }
  }

  private saveSessionId(): void {
    if (this.stateless) return;

    try {
      const statePath = this.getSessionStatePath();
      fs.mkdirSync(path.dirname(statePath), {recursive: true});
      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            sessionId: this.sessionId,
            hasStartedSession: this.hasStartedSession,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        {mode: 0o600},
      );
    } catch (error) {
      console.warn(`${this.name}: 保存 Claude SDK sessionId 失败:`, error);
    }
  }

  private ensureSkillsSymlink(): void {
    if (!this.agentId) return;

    const globalSkillsDir = skillInstallService.getGlobalAgentSkillsDir(
      this.agentId,
    );
    if (!fs.existsSync(globalSkillsDir)) return;

    const claudeConfigDir = this.getClaudeConfigDir();
    const configSkillsDir = path.join(claudeConfigDir, 'skills');

    try {
      if (fs.existsSync(configSkillsDir)) {
        const existingTarget = fs.readlinkSync(configSkillsDir);
        if (existingTarget === globalSkillsDir) return;
      }
    } catch {
      // 不是 symlink，继续重建。
    }

    try {
      fs.rmSync(configSkillsDir, {recursive: true, force: true});
    } catch {
      // 忽略删除失败。
    }

    fs.mkdirSync(claudeConfigDir, {recursive: true});
    try {
      fs.symlinkSync(globalSkillsDir, configSkillsDir);
      console.log(
        `${this.name}: Skills symlink 已创建 ${configSkillsDir} → ${globalSkillsDir}`,
      );
    } catch (error) {
      console.error(`${this.name}: 创建 Skills symlink 失败:`, error);
    }
  }

  private buildEnv(): Record<string, string | undefined> {
    const cleanEnv: Record<string, string | undefined> = {...process.env};
    const keysToClear = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_SMALL_FAST_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_REASONING_MODEL',
      'ACPX_AUTH_ANTHROPIC_API_KEY',
      'ACPX_AUTH_ANTHROPIC_AUTH_TOKEN',
    ];
    keysToClear.forEach((key) => delete cleanEnv[key]);

    const claudeConfigDir = this.getClaudeConfigDir();
    if (!this.llmProvider) {
      const syncResult = syncGlobalClaudeLocalConfig(claudeConfigDir);
      if (
        syncResult.settings.copied ||
        syncResult.state.copied ||
        syncResult.credentials.copied
      ) {
        logClaudeSdkDebug('synced global Claude settings', {
          agentName: this.name,
          agentId: this.agentId,
          settings: syncResult.settings,
          state: syncResult.state,
          credentials: {
            ...syncResult.credentials,
            // 不要把 token 内容写进日志
            sourcePath: syncResult.credentials.sourcePath,
            targetPath: syncResult.credentials.targetPath,
          },
        });
      }
    } else {
      // 绑定了自定义 LlmProvider 时，鉴权/模型/base_url 全部由下方 providerEnv
      // 注入。必须先抹掉 per-agent settings.json 里残留的冲突键（如旧供应商写下的
      // ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 和顶层 model），否则 Claude CLI 会读
      // settings.json 把注入值顶掉，导致请求被发到错误端点（例如 deepseek 模型名
      // 发到只认 GLM 的网关，返回 400 model not supported）。
      const stripResult = stripProviderConflictingClaudeSettings(claudeConfigDir);
      if (stripResult.changed) {
        logClaudeSdkDebug('stripped stale provider env from settings.json', {
          agentName: this.name,
          agentId: this.agentId,
          targetPath: stripResult.targetPath,
          removedEnvKeys: stripResult.removedEnvKeys,
          removedTopLevelKeys: stripResult.removedTopLevelKeys,
        });
      }
    }

    const providerEnv = this.llmProvider
      ? buildAcpProviderEnv('claude', this.llmProvider, this.agentId)
      : {
          CLAUDE_CONFIG_DIR: claudeConfigDir,
          // 本地配置（OAuth 订阅，不绑 LlmProvider）模式下，把子进程 HOME 隔离到
          // per-agent 配置目录。否则当该目录位于用户真实 HOME（~/.teamagentx/...）下时，
          // Claude CLI 会向上读到用户 home 的 ~/.claude.json，其登录/账号状态会顶掉我们
          // 写入 per-agent dir 的 .credentials.json，导致官方接口返回
          // “401 Invalid authentication credentials”。配置目录里已有一致的
          // .claude.json + .credentials.json，HOME 指向它即可让鉴权自洽。
          // 绑定 LlmProvider 的助手走 env 注入鉴权（ANTHROPIC_AUTH_TOKEN/BASE_URL），
          // 不受 home 污染影响，因此保持原行为。
          HOME: claudeConfigDir,
          USERPROFILE: claudeConfigDir,
        };

    if (this.llmProvider) {
      this.acpProviderInfo = {
        id: this.llmProvider.id,
        name: this.llmProvider.name,
        type: this.llmProvider.type,
        model: this.llmProvider.model,
        apiProtocol: (
          (this.llmProvider as any).apiProtocol || 'anthropic'
        ).toLowerCase(),
      };
    }

    return {
      ...cleanEnv,
      ...providerEnv,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'teamagentx/claude-sdk-executor',
      DEBUG_CLAUDE_AGENT_SDK: cleanEnv.DEBUG_CLAUDE_AGENT_SDK || '1',
    };
  }

  private logQueryStart(env: Record<string, string | undefined>): void {
    logClaudeSdkDebug('query start', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      cwd: this.workDir,
      cwdExists: fs.existsSync(this.workDir),
      claudeConfigDir: env.CLAUDE_CONFIG_DIR,
      claudeConfigDirExists: env.CLAUDE_CONFIG_DIR
        ? fs.existsSync(env.CLAUDE_CONFIG_DIR)
        : false,
      sessionStatePath: this.getSessionStatePath(),
      sessionStateExists: fs.existsSync(this.getSessionStatePath()),
      sessionId: this.sessionId,
      hasStartedSession: this.hasStartedSession,
      optionSessionId: this.hasStartedSession ? undefined : this.sessionId,
      optionResume: this.hasStartedSession ? this.sessionId : undefined,
      maxTurns: getClaudeMaxTurns(),
      thinking: getClaudeThinkingOptions(this.llmProvider, this.thinkingMode),
      model: this.llmProvider?.model,
      provider: this.llmProvider
        ? {
            id: this.llmProvider.id,
            name: this.llmProvider.name,
            type: this.llmProvider.type,
            apiProtocol: (
              (this.llmProvider as any).apiProtocol || 'anthropic'
            ).toLowerCase(),
            apiUrl: this.llmProvider.apiUrl,
          }
        : undefined,
      sdkImportUrl: import.meta.url,
      sdkPackagePath: (() => {
        try {
          return requireFromServerBundle.resolve(
            '@anthropic-ai/claude-agent-sdk',
          );
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      })(),
      claudeCodeExecutable: this.claudeCodeExecutable,
      claudeCodeExecutableExists: this.claudeCodeExecutable
        ? fs.existsSync(this.claudeCodeExecutable)
        : false,
      nodeExecPath: process.execPath,
      processCwd: process.cwd(),
      nodePath: process.env.NODE_PATH,
      pathHead: env.PATH?.split(path.delimiter).slice(0, 8),
      anthropicEnv: {
        key: redactValue(env.ANTHROPIC_API_KEY),
        authToken: redactValue(env.ANTHROPIC_AUTH_TOKEN),
        baseUrl: env.ANTHROPIC_BASE_URL,
        apiUrl: env.ANTHROPIC_API_URL,
        model: env.ANTHROPIC_MODEL,
      },
    });
  }

  private buildMcpCommandEnv(): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: this.getClaudeConfigDir(),
    };
    // 注入群聊环境变量，让 shell 脚本可以取值（跳过保留键，避免劫持执行器）
    const { env } = buildShellEnvFromRoomEnvVars(base, this.roomEnvVars);
    return env;
  }

  private buildHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {};
  }

  private buildSdkSystemPrompt(suppressAssistantHandoff = false): string {
    return [
      suppressAssistantHandoff
        ? this.systemPromptWithoutAssistantHandoff
        : this.systemPrompt,
      buildAgentLongTermMemoryInstructions(
        this.agentId,
        this.name,
      ),
      this.buildGroupChatMemberInfoSection(suppressAssistantHandoff),
      getResponseStyleInstruction(this.locale),
    ]
      .filter((section) => section.trim().length > 0)
      .join('\n\n');
  }

  private buildGroupChatMemberInfoSection(
    suppressAssistantHandoff = false,
  ): string {
    return buildGroupChatMemberInfoSection({
      chatRoomAgents: this.chatRoomAgents,
      agentName: this.name,
      workDir: this.workDir,
      includeAssistantTriggerNecessityReminder: true,
      includeAssistantHandoffGuidance: !suppressAssistantHandoff,
      locale: this.locale,
    });
  }

  private buildFullMessage(
    message: string,
    history?: HistoryMessage[],
    suppressAssistantHandoff = false,
  ): string {
    let fullMessage = '';

    const longTermMemorySection = buildAgentLongTermMemoryContentSection(
      this.agentId,
      this.name,
    );
    if (longTermMemorySection) {
      fullMessage += `${longTermMemorySection}\n\n`;
    }

    if (this.injectGroupHistory) {
      const messageIndexSection = buildRoomMessageIndexSection(history);
      if (messageIndexSection) {
        fullMessage += `${messageIndexSection}\n\n`;
      }

      fullMessage += pickLocaleText(
        {
          'zh-CN': `[群历史访问]
你可以通过工具访问当前群聊历史。用 \`get_recent_room_messages\` 获取消息索引，\`search_room_messages\` 按关键词搜索索引，\`get_room_message_detail\` 按 messageId 查看精确消息内容。这些工具自动作用于当前群聊；不要索取或提供 chatRoomId。每次最多获取 50 条消息索引；用 \`skip\` 分页，\`order\` 取 \`asc\` 或 \`desc\` 控制时间方向。最近/搜索结果只是导航预览，所以在依赖精确历史内容前先调用 \`get_room_message_detail\`。`,
          'en-US': `[Group History Access]
You may access current chatroom history through tools. Use \`get_recent_room_messages\` for message indexes, \`search_room_messages\` to search indexes by keyword, or \`get_room_message_detail\` to inspect exact message content by messageId. These tools automatically use the current chatroom; do not ask for or provide a chatRoomId. Fetch at most 50 message indexes per call; use \`skip\` for pagination and \`order\` as \`asc\` or \`desc\` for chronological direction. Recent/search results are navigation previews, so call \`get_room_message_detail\` before relying on exact prior content.`,
        },
        this.locale,
      ) + '\n\n';
    }

    const currentMessageLabel = pickLocaleText(
      { 'zh-CN': '[当前消息]', 'en-US': '[Current Message]' },
      this.locale,
    );
    fullMessage += `${currentMessageLabel}\n${message}`;

    const handoffReminder = suppressAssistantHandoff
      ? buildNoAssistantHandoffTurnReminder(this.locale)
      : buildHandoffTurnReminder(this.agentTriggerMode, this.locale);
    if (handoffReminder) {
      fullMessage += `\n\n${handoffReminder}`;
    }

    return fullMessage;
  }

  private buildPrompt(
    fullMessage: string,
    attachments?: AttachmentData[],
  ): string | AsyncIterable<SDKUserMessage> {
    if (!attachments || attachments.length === 0) {
      return fullMessage;
    }

    const userMessage = {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          {type: 'text', text: fullMessage},
          ...attachments.map((attachment) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.base64,
            },
          })),
        ],
      },
    } as SDKUserMessage;

    return (async function* () {
      yield userMessage;
    })();
  }

  private resetCollectors(): void {
    this.content = '';
    this.thinking = '';
    this.toolCalls = [];
    this.hasBackgroundedLongRunningCommand = false;
    this.waitingForTaskOutput = false;
    this.waitingForAssistantAfterToolResult = false;
    this.receivedAssistantEndTurn = false;
    this.pendingSegmentRecorded = false;
  }

  private resetSession(): void {
    // 删除旧的 conversation 文件，避免垃圾文件累积
    if (this.hasStartedSession && this.sessionId) {
      const oldConversationPath = this.getClaudeConversationPath(
        this.sessionId,
      );
      try {
        if (fs.existsSync(oldConversationPath)) {
          fs.unlinkSync(oldConversationPath);
          console.log(
            `${this.name}: 已删除旧 conversation 文件 ${oldConversationPath}`,
          );
        }
      } catch (error) {
        console.warn(`${this.name}: 删除旧 conversation 文件失败:`, error);
      }
    }

    this.sessionId = randomUUID();
    this.hasStartedSession = false;
    this.saveSessionId();
    logClaudeSdkDebug('session reset', {
      agentName: this.name,
      agentId: this.agentId,
      newSessionId: this.sessionId,
      statePath: this.getSessionStatePath(),
    });
  }

  private getSystemAssistantTools(): any[] {
    return getSystemAssistantTools(this.agentId, this.chatRoomId, {
      includeRoomContextTools: this.injectGroupHistory,
    });
  }

  private buildSystemAssistantMcpTools(): any[] {
    return this.getSystemAssistantTools().map((systemTool) => {
      const name = systemTool.name;
      return sdkTool(
        name,
        systemTool.description || name,
        systemTool.schema,
        async (args) => {
          try {
            const result = await systemTool.invoke(args ?? {});
            return {
              content: [
                {type: 'text' as const, text: stringifyMcpToolResult(result)},
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error ? error.message : 'Tool execution failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      );
    });
  }

  private async runShellCommandForMcp(
    command: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      throw new Error('command is required');
    }

    const timeout = Math.min(Math.max(timeoutMs || 120_000, 1_000), 600_000);
    const outputLimitBytes = 128 * 1024;
    let stdout = '';
    let stderr = '';

    const appendOutput = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf-8');
      if (Buffer.byteLength(next, 'utf-8') <= outputLimitBytes) return next;
      return Buffer.from(next, 'utf-8')
        .subarray(-outputLimitBytes)
        .toString('utf-8');
    };

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      const child = spawn(trimmedCommand, [], {
        cwd: this.workDir,
        shell: getDefaultShell(),
        env: this.buildMcpCommandEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (result: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        resolve(result);
      };

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          treeKill(child.pid, 'SIGKILL', () => {
            finish({
              command: trimmedCommand,
              workDir: this.workDir,
              exitCode: 124,
              timedOut,
              stdout,
              stderr,
            });
          });
          return;
        }
        finish({
          command: trimmedCommand,
          workDir: this.workDir,
          exitCode: 124,
          timedOut,
          stdout,
          stderr,
        });
      }, timeout);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendOutput(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendOutput(stderr, chunk);
      });
      child.once('error', (error) => {
        if (settled) return;
        clearTimeout(timeoutHandle);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        finish({
          command: trimmedCommand,
          workDir: this.workDir,
          exitCode: code ?? (signal === 'SIGTERM' ? 143 : 1),
          timedOut,
          stdout,
          stderr,
        });
      });
    });
  }

  private requireAgentIdForMcpTool(): string {
    if (!this.agentId) {
      throw new Error('The current assistant is missing agentId.');
    }
    return this.agentId;
  }

  private buildShellMcpTools(): any[] {
    return [
      sdkTool(
        'run_shell_command',
        'Run a foreground shell command in the current TeamAgentX working directory. Use start_background_command for dev servers, watch commands, listeners, and other long-running commands.',
        {
          command: z
            .string()
            .describe('Shell command to run in the current working directory.'),
          timeoutMs: z
            .number()
            .int()
            .min(1_000)
            .max(600_000)
            .optional()
            .describe('Maximum runtime in milliseconds. Default 120000.'),
        },
        async (args) => {
          try {
            const result = await this.runShellCommandForMcp(
              args.command,
              args.timeoutMs,
            );
            const exitCode = Number(result.exitCode ?? 0);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: stringifyMcpToolResult(result),
                },
              ],
              structuredContent: result,
              isError: exitCode !== 0,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error ? error.message : 'Shell command failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      ),
    ];
  }

  private buildBackgroundCommandMcpTools(): any[] {
    return [
      sdkTool(
        'start_background_command',
        'Start a long-running shell command in the TeamAgentX background task manager. Use this for dev servers, watch commands, tail -f, and services that should keep running after this turn.',
        {
          command: z
            .string()
            .describe('Shell command to run in the current working directory.'),
        },
        async (args) => {
          try {
            const agentId = this.requireAgentIdForMcpTool();
            const task = await backgroundCommandService.start({
              chatRoomId: this.chatRoomId,
              agentId,
              agentName: this.name,
              command: args.command,
              workDir: this.workDir,
              env: this.buildMcpCommandEnv(),
            });
            const structuredContent = toStructuredContent(task);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: stringifyMcpToolResult(structuredContent),
                },
              ],
              structuredContent,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error
                      ? error.message
                      : 'Background command start failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      ),
      sdkTool(
        'read_background_command_output',
        'Read the latest stdout and stderr from a background command started with start_background_command.',
        {
          taskId: z
            .string()
            .describe('Background task ID returned by start_background_command.'),
          tailBytes: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Maximum bytes to read from the end of each output stream.'),
        },
        async (args) => {
          try {
            const agentId = this.requireAgentIdForMcpTool();
            const task = await backgroundCommandService.read(
              args.taskId,
              this.chatRoomId,
              agentId,
              args.tailBytes,
            );
            const structuredContent = toStructuredContent(task);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: stringifyMcpToolResult(structuredContent),
                },
              ],
              structuredContent,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error
                      ? error.message
                      : 'Background command read failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      ),
      sdkTool(
        'stop_background_command',
        'Stop a running background command by task ID.',
        {
          taskId: z
            .string()
            .describe('Background task ID returned by start_background_command.'),
        },
        async (args) => {
          try {
            const agentId = this.requireAgentIdForMcpTool();
            const task = await backgroundCommandService.stop(
              args.taskId,
              this.chatRoomId,
              agentId,
            );
            const structuredContent = toStructuredContent(task);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: stringifyMcpToolResult(structuredContent),
                },
              ],
              structuredContent,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error
                      ? error.message
                      : 'Background command stop failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      ),
      sdkTool(
        'list_background_commands',
        'List recent background commands started by this assistant in this chatroom.',
        {},
        async () => {
          try {
            const agentId = this.requireAgentIdForMcpTool();
            const tasks = await backgroundCommandService.list(
              this.chatRoomId,
              agentId,
            );
            const structuredContent = toStructuredContent({tasks});
            return {
              content: [
                {
                  type: 'text' as const,
                  text: stringifyMcpToolResult(structuredContent),
                },
              ],
              structuredContent,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    error instanceof Error
                      ? error.message
                      : 'Background command list failed.',
                },
              ],
              isError: true,
            };
          }
        },
        {alwaysLoad: true},
      ),
    ];
  }

  private getAllowedTaxTools(): string[] {
    const systemToolNames = this.getSystemAssistantTools()
      .map((tool) => tool.name)
      .filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );

    return [
      'mcp__tax__run_shell_command',
      'mcp__tax__start_background_command',
      'mcp__tax__read_background_command_output',
      'mcp__tax__stop_background_command',
      'mcp__tax__list_background_commands',
      ...(this.imageGenerationProvider ? ['mcp__tax__generate_image'] : []),
      ...systemToolNames.map((name) => `mcp__tax__${name}`),
    ];
  }

  private buildTeamAgentXMcpServer() {
    return createSdkMcpServer({
      name: 'tax',
      version: '1.0.0',
      alwaysLoad: true,
      tools: [
        ...(this.imageGenerationProvider
          ? [
              sdkTool(
                'generate_image',
                'Generate images through the TeamAgentX server-controlled image model. API keys are used only on the server. Use this when the user explicitly asks for an image, poster, illustration, product visual, or visual draft.',
                {
                  prompt: z
                    .string()
                    .describe(
                      'Detailed image prompt. Include subject, style, composition, colors, intended use, and other relevant details.',
                    ),
                  size: z
                    .string()
                    .optional()
                    .describe(
                      'Image size or aspect ratio, for example 1024x1024, 1024x1792, or 1:1.',
                    ),
                  n: z
                    .number()
                    .int()
                    .min(1)
                    .max(4)
                    .optional()
                    .describe('Number of images to generate. Default 1, maximum 4.'),
                  filename: z
                    .string()
                    .optional()
                    .describe('Optional filename. Do not include a path.'),
                  extraJson: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe('Provider-specific extra parameters.'),
                },
                async (args) => {
                  if (!this.agentId) {
                    return {
                      content: [
                        {
                          type: 'text',
                          text: 'The current assistant is missing agentId and cannot generate images.',
                        },
                      ],
                      isError: true,
                    };
                  }

                  try {
                    const result = await generateImageForAgent(this.agentId, {
                      prompt: args.prompt,
                      size: args.size,
                      n: args.n,
                      filename: args.filename,
                      extraJson: args.extraJson,
                    });
                    return {
                      content: [
                        {
                          type: 'text',
                          text: `Image generation succeeded: ${result.urls.join(', ') || result.files.join(', ')}`,
                        },
                      ],
                      structuredContent: result as unknown as Record<
                        string,
                        unknown
                      >,
                    };
                  } catch (error) {
                    return {
                      content: [
                        {
                          type: 'text',
                          text:
                            error instanceof Error
                              ? error.message
                              : 'Image generation failed.',
                        },
                      ],
                      isError: true,
                    };
                  }
                },
                {alwaysLoad: true},
              ),
            ]
          : []),
        ...this.buildShellMcpTools(),
        ...this.buildBackgroundCommandMcpTools(),
        ...this.buildSystemAssistantMcpTools(),
      ],
    });
  }

  private stripMcpTaxPrefix(name: string): string {
    const MCP_TAX_PREFIX = 'mcp__tax__';
    if (name.startsWith(MCP_TAX_PREFIX)) {
      return name.slice(MCP_TAX_PREFIX.length);
    }
    return name;
  }

  private upsertToolCall(toolCall: ToolCall): void {
    const existing = this.toolCalls.find(
      (item) => item.toolCallId === toolCall.toolCallId,
    );
    if (!existing) {
      this.toolCalls.push(toolCall);
      this.emitToolCall?.(toolCall);
      return;
    }

    let changed = false;
    for (const key of ['name', 'status', 'output', 'input'] as const) {
      if (toolCall[key] && existing[key] !== toolCall[key]) {
        (existing as any)[key] = toolCall[key];
        changed = true;
      }
    }
    if (changed) this.emitToolCall?.(existing);
  }

  private handleStreamEvent(message: any): void {
    const event = message.event;
    if (!event || typeof event !== 'object') return;

    if (
      event.type === 'content_block_start' &&
      event.content_block?.type === 'thinking'
    ) {
      this.appendThinking(event.content_block.thinking);
      return;
    }

    if (
      event.type === 'content_block_start' &&
      event.content_block?.type === 'tool_use'
    ) {
      this.upsertToolCall({
        name: this.stripMcpTaxPrefix(event.content_block.name || 'tool_call'),
        input: event.content_block.input || {},
        toolCallId: event.content_block.id || message.uuid || randomUUID(),
        status: 'in_progress',
        timestamp: Date.now(),
      });
      return;
    }

    if (event.type === 'content_block_delta') {
      if (
        event.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string'
      ) {
        this.content += event.delta.text;
        this.emitStream?.(event.delta.text);
      }
      if (
        event.delta?.type === 'thinking_delta' &&
        typeof event.delta.thinking === 'string'
      ) {
        this.appendThinking(event.delta.thinking);
      }
    }
  }

  private appendThinking(raw: unknown): void {
    const text = coerceThinkingText(raw);
    if (!text) return;

    if (this.thinking && text.startsWith(this.thinking)) {
      const delta = text.slice(this.thinking.length);
      if (delta) this.emitThinking?.(delta);
      this.thinking = text;
      return;
    }

    if (this.thinking.endsWith(text)) return;

    this.thinking += text;
    this.emitThinking?.(text);
  }

  private handleAssistantMessage(message: any): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    this.waitingForAssistantAfterToolResult = false;
    const stopReason = message.message?.stop_reason;

    // 确保 this.content 已包含本条消息的文本（流式可能尚未累积）
    if (!this.content) {
      const text = extractTextFromContent(content);
      if (text) this.content = text;
    }

    // 工具调用会在 tool_result 到来时清空 this.content（只保留最后一段最终回答），
    // 这里先把「工具调用之前的这段文字」记入执行详情（仅记录，不发群消息），
    // 避免多次工具调用之间的中间文本段在执行记录里丢失。
    const hasToolUse = content.some(
      (block: any) => block?.type === 'tool_use',
    );
    if (hasToolUse && !this.pendingSegmentRecorded && this.content.trim()) {
      this.emitRecord?.(this.content);
      this.pendingSegmentRecorded = true;
    }

    for (const block of content) {
      if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        this.appendThinking(block.thinking);
      }

      if (block?.type === 'tool_use') {
        const toolName = this.stripMcpTaxPrefix(block.name || 'tool_call');
        if (toolName === 'TaskOutput') {
          this.waitingForTaskOutput = true;
        }
        this.upsertToolCall({
          name: toolName,
          input: block.input || {},
          toolCallId: block.id || randomUUID(),
          // assistant 消息在工具执行前到达，此时工具还未运行，不能标记为 completed
          status: 'in_progress',
          timestamp: Date.now(),
        });
      }
    }

    if (stopReason === 'end_turn' && this.content.trim()) {
      this.receivedAssistantEndTurn = true;
    }
  }

  private handleUserMessage(message: any): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block?.type === 'tool_result') {
        this.waitingForTaskOutput = false;
        this.waitingForAssistantAfterToolResult = true;
        // 工具结果返回意味着此前累积的文本只是中间过程，丢弃它，
        // 只保留最后一次工具调用之后产生的那段最终回答。
        // （该中间文本已在 handleAssistantMessage 里通过 emitRecord 记入执行详情）
        this.content = '';
        // 进入下一段，允许记录新的中间文本段
        this.pendingSegmentRecorded = false;
        const toolUseId = block.tool_use_id || message.uuid || randomUUID();
        const output = extractTextFromContent(block.content);
        const status = block.is_error ? 'error' : 'completed';
        const existing = this.toolCalls.find(
          (item) => item.toolCallId === toolUseId,
        );

        if (existing) {
          let changed = false;
          if (existing.status !== status) {
            existing.status = status;
            changed = true;
          }
          if (existing.output !== output) {
            existing.output = output;
            changed = true;
          }
          if (changed) this.emitToolCall?.(existing);
        } else {
          this.upsertToolCall({
            name: 'tool_result',
            input: {},
            toolCallId: toolUseId,
            status,
            output,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  private handleSdkMessage(message: SDKMessage): TokenUsage | undefined {
    debugLog('claudeSdkEvent', {
      agentName: this.name,
      eventType: message.type,
      event: message as Record<string, unknown>,
    });

    const sdkSessionId = (message as any).session_id;
    if (typeof sdkSessionId === 'string' && sdkSessionId) {
      const shouldSaveSession =
        this.sessionId !== sdkSessionId || !this.hasStartedSession;
      this.sessionId = sdkSessionId;
      this.hasStartedSession = true;
      if (shouldSaveSession && !this.stateless) this.saveSessionId();
    }

    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message);
        return undefined;
      case 'assistant': {
        const assistantModel = (message as any).message?.model;
        if (typeof assistantModel === 'string' && assistantModel) {
          this.runtimeModel = assistantModel;
        }
        this.handleAssistantMessage(message);
        return normalizeUsage((message as any).message?.usage);
      }
      case 'user':
        this.handleUserMessage(message);
        return undefined;
      case 'tool_progress':
        this.upsertToolCall({
          name: this.stripMcpTaxPrefix((message as any).tool_name || 'tool_call'),
          input: {},
          toolCallId: (message as any).tool_use_id || message.uuid,
          status: 'in_progress',
          timestamp: Date.now(),
        });
        return undefined;
      case 'system':
        if ((message as any).subtype === 'init') {
          const initModel = (message as any).model;
          if (typeof initModel === 'string' && initModel && !this.runtimeModel) {
            this.runtimeModel = initModel;
          }
        }
        if ((message as any).subtype === 'status') {
          const status =
            (message as any).status?.text || (message as any).status?.message;
          if (typeof status === 'string') {
            this.content += status;
          }
        }
        if (
          (message as any).subtype === 'task_updated' &&
          (message as any).patch?.is_backgrounded === true
        ) {
          this.hasBackgroundedLongRunningCommand = true;
        }
        return undefined;
      case 'result':
        if ((message as any).session_id) {
          this.sessionId = (message as any).session_id;
          this.hasStartedSession = true;
          if (!this.stateless) this.saveSessionId();
        }
        if (
          (message as any).subtype === 'success' &&
          typeof (message as any).result === 'string' &&
          !this.content
        ) {
          this.content = (message as any).result;
        }
        return normalizeUsage((message as any).usage);
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
    this._lastInjectedMessageId = undefined;
    if (this.agentId) {
      await agentMemoryService.clear(this.chatRoomId, this.agentId);
    }
    this.sessionId = randomUUID();
    this.hasStartedSession = false;
    this.saveSessionId();
    const resultMessage = '✅ 上下文已清除，开始新的对话';
    await emit(resultMessage, originalMessageId);
    return resultMessage;
  }

  private async runQuery(
    fullMessage: string,
    attachments: AttachmentData[] | undefined,
    signal: AbortSignal | undefined,
    abortController: AbortController,
    suppressAssistantHandoff = false,
  ): Promise<TokenUsage | undefined> {
    const env = this.buildEnv();
    const maxTurns = getClaudeMaxTurns();
    const thinking = getClaudeThinkingOptions(this.llmProvider, this.thinkingMode);
    const skills = buildInstalledSkillNames(this.agentId);
    this.lastClaudeStderr = '';
    this.logQueryStart(env);
    const settingSources = getClaudeSettingSources(Boolean(this.llmProvider));
    const autoCompactWindow = getClaudeAutoCompactWindow(this.llmProvider);
    const allowedTaxTools = this.getAllowedTaxTools();
    // 加载并合并用户启用的连接器（MCP server）
    const connectors = await getAgentConnectors(this.agentId);
    const connectorMcpServers = toClaudeMcpServers(connectors);
    const connectorToolPatterns = connectors.map((c) => `mcp__${c.name}__*`);
    const mcpServers: Record<string, unknown> = {
      ...(allowedTaxTools.length > 0 ? { tax: this.buildTeamAgentXMcpServer() } : {}),
      ...connectorMcpServers,
    };
    const hasMcpServers = Object.keys(mcpServers).length > 0;
    // allowedTools 仅在内置 tax 工具受限时设置；此时需放行连接器工具。
    // 若只有连接器而无 tax 限制，则不设置 allowedTools（默认全部放行）。
    const allowedTools =
      allowedTaxTools.length > 0
        ? [...allowedTaxTools, ...connectorToolPatterns]
        : undefined;
    const q = query({
      prompt: this.buildPrompt(fullMessage, attachments),
      options: {
        cwd: this.workDir,
        env,
        ...(autoCompactWindow ? { settings: { autoCompactEnabled: true, autoCompactWindow } } : {}),
        systemPrompt: this.buildSdkSystemPrompt(suppressAssistantHandoff),
        model: this.llmProvider?.model,
        includePartialMessages: true,
        maxTurns,
        thinking,
        skills,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // 始终禁用 plan 计划模式工具：ExitPlanMode（进入/退出 plan 计划模式）
        disallowedTools: [
          'ExitPlanMode',
          ...(allowedTaxTools.length > 0
            ? [
                'Bash',
                'TaskOutput',
                'ScheduleWakeup',
                'AskUserQuestion',
                'CronCreate',
              ]
            : []),
        ],
        ...(hasMcpServers ? { mcpServers: mcpServers as never } : {}),
        ...(allowedTools ? { allowedTools } : {}),
        settingSources,
        hooks: this.buildHooks(),
        sessionId: this.hasStartedSession ? undefined : this.sessionId,
        resume: this.hasStartedSession ? this.sessionId : undefined,
        abortController,
        pathToClaudeCodeExecutable: this.claudeCodeExecutable,
        stderr: (chunk: string) => {
          for (const line of chunk.split(/\r?\n/)) {
            if (line.trim()) {
              this.lastClaudeStderr = `${this.lastClaudeStderr}\n${line}`.slice(
                -4000,
              );
              console.error(`[ClaudeSDK stderr][${this.name}] ${line}`);
            }
          }
        },
      },
    });

    let tokenUsage: TokenUsage | undefined;
    const iterator = q[Symbol.asyncIterator]();
    const idleFinishMs = getBackgroundIdleFinishMs();

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      const nextMessage = iterator.next();
      const result =
        shouldApplyBackgroundIdleFinish({
          hasBackgroundedLongRunningCommand:
            this.hasBackgroundedLongRunningCommand,
          waitingForTaskOutput: this.waitingForTaskOutput,
          waitingForAssistantAfterToolResult:
            this.waitingForAssistantAfterToolResult,
        })
          ? await Promise.race([
              nextMessage,
              new Promise<{done: true; value: undefined; timedOut: true}>(
                (resolve) => {
                  setTimeout(
                    () =>
                      resolve({done: true, value: undefined, timedOut: true}),
                    idleFinishMs,
                  );
                },
              ),
            ])
          : await nextMessage;

      if ('timedOut' in result) {
        nextMessage.catch(() => undefined);
        console.warn(
          `${this.name}: Claude SDK 后台任务空闲 ${idleFinishMs}ms，主动结束本轮对话`,
        );
        abortController.abort('background-idle-finish');
        return tokenUsage;
      }

      if (result.done) break;

      const sdkMessage = result.value;
      const usage = this.handleSdkMessage(sdkMessage);
      if (usage) tokenUsage = usage;

      if (this.receivedAssistantEndTurn && this.content.trim()) {
        abortController.abort('assistant-end-turn');
        return tokenUsage;
      }
    }
    return tokenUsage;
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
    emitRecord?: RecordEmitCallback,
    options?: AgentExecOptions,
  ): Promise<AgentExecResult> {
    this.emitStream = emitStream || null;
    this.emitToolCall = emitToolCall || null;
    this.emitThinking = emitThinking || null;
    this.emitRecord = emitRecord || null;
    this.ensureSkillsSymlink();
    this.resetCollectors();

    const contextResetCommand = getContextResetCommand(message);
    if (contextResetCommand) {
      const resultMessage = await this.handleClearContext(
        emit,
        originalMessageId,
      );
      return {actions: [{type: 'message', content: resultMessage}]};
    }

    const suppressAssistantHandoff =
      options?.suppressAssistantHandoff === true;
    const fullMessage = this.buildFullMessage(
      message,
      history,
      suppressAssistantHandoff,
    );
    this.lastContext = fullMessage;
    if (this.stateless) {
      this.sessionId = randomUUID();
      this.hasStartedSession = false;
    }

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const abort = () => abortController.abort();
    signal?.addEventListener('abort', abort, {once: true});

    let tokenUsage: TokenUsage | undefined;

    try {
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      await this.applyLocalClaudeSessionBinding();
      this.ensureResumableSessionExists();
      const shouldResume = this.hasStartedSession;
      try {
        tokenUsage = await this.runQuery(
          fullMessage,
          attachments,
          signal,
          abortController,
          suppressAssistantHandoff,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const errorDetails = `${message}\n${this.lastClaudeStderr}`;
        console.error(`${this.name}: Claude SDK query failed`, {
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: message,
          stderrTail: this.lastClaudeStderr || undefined,
          shouldResume,
          sessionId: this.sessionId,
          hasStartedSession: this.hasStartedSession,
          claudeCodeExecutable: this.claudeCodeExecutable,
          cwd: this.workDir,
          configDir: this.getClaudeConfigDir(),
        });
        if (signal?.aborted) {
          console.warn(`${this.name}: Claude SDK query 已中止`);
          throw new DOMException('执行已被用户中断', 'AbortError');
        }

        const canRetry = isRecoverableSessionError(errorDetails);
        if (!canRetry) {
          throw error;
        }

        // 仅当会话确实不可用时才 resetSession（会删除 jsonl 历史文件）。
        // 其余瞬时/外部错误（如子进程 exited with code 1、会话被占用）保留历史、
        // 直接 resume 同一会话重试一次，避免误删导致助手在长对话中突然失忆。
        if (isSessionUnusableError(errorDetails)) {
          console.warn(
            `${this.name}: Claude SDK 会话不可用，重置 session 后重试一次`,
          );
          this.resetSession();
        } else {
          console.warn(
            `${this.name}: Claude SDK 执行失败（瞬时），保留会话历史并重试一次`,
          );
        }
        this.resetCollectors();
        tokenUsage = await this.runQuery(
          fullMessage,
          attachments,
          signal,
          abortController,
          suppressAssistantHandoff,
        );
      }

      const finalResponse = this.content || 'claude 执行完成';
      await emit(finalResponse, originalMessageId);
      this.lastResponse = finalResponse;
      this.lastInvokeResult = JSON.stringify(
        {
          toolCalls: this.toolCalls,
          responseLength: finalResponse.length,
          thinking: this.thinking
            ? {content: this.thinking, timestamp: Date.now()}
            : undefined,
          sessionId: this.sessionId,
        },
        null,
        2,
      );

      return {
        actions: [{type: 'message', content: finalResponse}],
        tokenUsage,
        model: this.runtimeModel ?? this.llmProvider?.model ?? undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(
          `${this.name}: Claude SDK query 已中止，保留 session 供下一轮继续使用`,
        );
        throw error;
      }
      console.error(`${this.name}: claude sdk 执行失败`, error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      if (!options?.suppressFailureMessage) {
        await emit(`claude 执行出错: ${errorMessage}`, originalMessageId);
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
      }
      this.emitStream = null;
      this.emitToolCall = null;
      this.emitThinking = null;
      this.emitRecord = null;
    }
  }

  getDebugInfo(): AgentDebugInfo {
    return {
      name: this.name,
      type: 'acp',
      systemPrompt: this.systemPrompt,
      chatRoomId: this.chatRoomId,
      acpTool: 'claude',
      workDir: this.workDir,
      injectGroupHistory: this.injectGroupHistory,
      lastContext: this.lastContext,
      lastInvokeResult: this.lastInvokeResult,
      lastResponse: this.lastResponse,
      lastHistory: null,
      agentId: this.agentId,
      chatRoomAgents: this.chatRoomAgents,
      llmProvider:
        this.acpProviderInfo ||
        (this.llmProvider
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
    this.resetSession();
  }
}

/**
 * 清理 ACP 助手（Claude SDK）的文件系统上下文
 * 用于清空群聊消息时，即使没有 executor 缓存也能清理 conversation 文件
 *
 * @param agentId 助手 ID
 * @param chatRoomId 群聊 ID
 */
export function clearClaudeSdkFileSystemContext(
  agentId: string,
  chatRoomId: string,
  workDirOverride?: string | null,
): void {
  const claudeConfigDir = path.join(
    os.homedir(),
    '.teamagentx',
    'acp-config',
    agentId,
  );

  if (!fs.existsSync(claudeConfigDir)) {
    return;
  }

  // 删除 sessions 目录下所有匹配该 chatRoomId 的 session 状态文件
  const sessionsDir = path.join(claudeConfigDir, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const sessionFiles = fs.readdirSync(sessionsDir);
    for (const file of sessionFiles) {
      if (file.startsWith(`${chatRoomId}-`) && file.endsWith('.json')) {
        const filePath = path.join(sessionsDir, file);
        try {
          // 读取 session 文件获取 sessionId，然后删除对应的 conversation 文件
          const content = fs.readFileSync(filePath, 'utf-8');
          const sessionState = JSON.parse(content);
          const sessionId = sessionState.sessionId;

          // 删除 conversation 文件
          const workDir = workDirOverride?.trim() || getDefaultChatRoomWorkDir(chatRoomId);
          const conversationPath = path.join(
            claudeConfigDir,
            'projects',
            sanitizeClaudeProjectPath(workDir),
            `${sessionId}.jsonl`,
          );
          if (fs.existsSync(conversationPath)) {
            fs.unlinkSync(conversationPath);
            console.log(
              `[ClearClaudeContext] 已删除 conversation 文件: ${conversationPath}`,
            );
          }

          // 删除 session 状态文件
          fs.unlinkSync(filePath);
          console.log(
            `[ClearClaudeContext] 已删除 session 状态文件: ${filePath}`,
          );
        } catch (error) {
          console.warn(
            `[ClearClaudeContext] 清理 session 文件失败: ${filePath}`,
            error,
          );
        }
      }
    }
  }

  // 删除 projects 目录下与该 chatRoomId workDir 相关的所有 conversation 文件
  const projectsDir = path.join(claudeConfigDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    const workDir = workDirOverride?.trim() || getDefaultChatRoomWorkDir(chatRoomId);
    const sanitizedWorkDir = sanitizeClaudeProjectPath(workDir);
    const projectDir = path.join(projectsDir, sanitizedWorkDir);

    if (fs.existsSync(projectDir)) {
      const conversationFiles = fs.readdirSync(projectDir);
      for (const file of conversationFiles) {
        if (file.endsWith('.jsonl')) {
          const filePath = path.join(projectDir, file);
          try {
            fs.unlinkSync(filePath);
            console.log(
              `[ClearClaudeContext] 已删除 conversation 文件: ${filePath}`,
            );
          } catch (error) {
            console.warn(
              `[ClearClaudeContext] 删除 conversation 文件失败: ${filePath}`,
              error,
            );
          }
        }
      }
    }
  }

  console.log(
    `[ClearClaudeContext] 已清理 Claude SDK 上下文: agentId=${agentId}, chatRoomId=${chatRoomId}`,
  );
}
