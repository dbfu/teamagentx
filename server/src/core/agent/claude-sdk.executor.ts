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
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { backgroundCommandService } from '../shell/background-command.service.js';
import {
    buildAcpProviderEnv,
    type AcpProviderInfo,
} from './acp-provider.adapter.js';
import { debugLog } from './agent-handler/debug.js';
import { buildAgentLongTermMemorySection } from './agent-long-term-memory.js';
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
import { getImageGenerationSkillInstructions } from './image-generation-config.js';
import { generateImageForAgent } from './image-generation.service.js';
import {
    buildInstalledSkillsInstructions,
    buildInstalledSkillsSignature,
} from './skill-instructions.js';
import { syncGlobalClaudeLocalConfig } from './claude-local-config.js';
import { getSystemAssistantTools } from './tools/index.js';
import {
  DEFAULT_AGENT_THINKING_MODE,
  type AgentThinkingMode,
} from './thinking-mode.js';
import { getDefaultChatRoomWorkDir, resolveAgentWorkDir } from './work-dir.js';

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function sanitizeClaudeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getMessageWithoutMentions(message: string): string {
  const mentionRegex =
    /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_]+)(?=\s|$)/g;
  return message.trim().replace(mentionRegex, '').trim();
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
  if (!rawValue) return 100;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 100;

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
      low: 4000,
      medium: 10000,
      high: 16000,
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
    isSessionAlreadyInUseError(message)
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

export const __claudeSdkTestUtils = {
  getBackgroundIdleFinishMs,
  shouldApplyBackgroundIdleFinish,
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

  // 1. 查找 SDK 自带的原生二进制（打包后通常被 yml filter 排除以减小体积，
  //    所以这里多半失败，是预期的；下方 step 2/3 会找用户本地安装的 claude）
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

  // 2. 查找应用本地安装目录（TOOLS_DIR）
  const toolsDir = process.env.TOOLS_DIR;
  if (toolsDir) {
    // 2a. @anthropic-ai/claude-code 包的 bin/claude(.exe) —— postinstall 复制的真 native binary，最优
    const claudeCodePkgBin = path.join(
      toolsDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude' + extension,
    );
    const v2a = tryPathStrict(
      'tools-dir/@anthropic-ai/claude-code/bin',
      claudeCodePkgBin,
    );
    if (v2a) return v2a;

    // 2b. .bin shim：非 Windows 走这里（Windows 上 .bin/claude.cmd 不可直接 spawn，跳过）
    if (!isWindows) {
      const localBin = path.join(toolsDir, 'node_modules', '.bin', 'claude');
      const v2b = tryPathStrict('tools-dir/node_modules/.bin', localBin);
      if (v2b) return v2b;
    }

    // 2c. Windows 上 npm global-style --prefix 直接根目录有 .exe 的情况（少见但兜底）
    if (isWindows) {
      const v2c = tryPathStrict(
        'tools-dir/claude.exe',
        path.join(toolsDir, 'claude.exe'),
      );
      if (v2c) return v2c;
    }

    // 2d. cli-wrapper.cjs —— postinstall 失败时的兜底，SDK 会用 node 执行 .cjs
    const cliWrapper = path.join(
      toolsDir,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli-wrapper.cjs',
    );
    const v2d = tryPathStrict(
      'tools-dir/@anthropic-ai/claude-code/cli-wrapper.cjs',
      cliWrapper,
    );
    if (v2d) return v2d;
  } else {
    tried.push('TOOLS_DIR: <unset>');
  }

  // 3. 在 PATH 中查找系统安装的 claude CLI
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

  private _lastInjectedMessageId?: string;
  private systemPrompt: string;
  private agentId: string | null = null;
  private sessionId: string;
  private hasStartedSession = false;
  private lastInjectedSkillsSignature?: string;
  private acpProviderInfo?: AcpProviderInfo;
  private currentAbortController: AbortController | null = null;

  private content = '';
  private thinking = '';
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
    imageGenerationProvider?: LlmProvider | null,
    thinkingMode?: AgentThinkingMode | null,
    chatRoomRules?: string,
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
    this.workDir = resolveAgentWorkDir({
      chatRoomId,
      sessionDir,
      customWorkDir,
      agentWorkDir: workDir,
    });
    const savedSession = this.loadSessionState();
    this.sessionId = savedSession?.sessionId || randomUUID();
    this.hasStartedSession = savedSession?.hasStartedSession ?? false;
    this.lastInjectedSkillsSignature = savedSession?.skillsSignature;

    const modelInfo = this.llmProvider
      ? `
## Current Model
You are using the model service provided by ${this.llmProvider.name}.
- Model name: ${this.llmProvider.model}
- Provider type: ${this.llmProvider.type}`
      : '';
    const chatRoomRulesSection = chatRoomRules?.trim()
      ? `
## Group Rules
The following rules come from the current chatroom and apply to all assistants in this chatroom. You must follow them in replies and collaboration in this chatroom:
${chatRoomRules.trim()}`
      : '';

    this.systemPrompt = `${modelInfo}
${systemPrompt}
${chatRoomRulesSection}

${getImageGenerationSkillInstructions(this.imageGenerationProvider)}

## Working Directory
Your working directory is: ${this.workDir}
When you perform file operations or run commands, operate in this directory by default. Resolve relative paths from this directory.

## Shell Commands
Use TeamAgentX MCP shell tools for shell execution. For normal foreground shell commands, use \`mcp__tax__run_shell_command\`. For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use \`mcp__tax__start_background_command\`. Use \`mcp__tax__read_background_command_output\` to inspect logs, \`mcp__tax__list_background_commands\` to find existing tasks, and \`mcp__tax__stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`;

    this.ensureWorkDirectory();
  }

  get lastInjectedMessageId(): string | undefined {
    return this._lastInjectedMessageId;
  }

  setLastInjectedMessageId(id: string): void {
    this._lastInjectedMessageId = id;
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

  private loadSessionState(): {
    sessionId: string;
    hasStartedSession: boolean;
    skillsSignature?: string;
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
        skillsSignature:
          typeof state.skillsSignature === 'string'
            ? state.skillsSignature
            : undefined,
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
    try {
      const statePath = this.getSessionStatePath();
      fs.mkdirSync(path.dirname(statePath), {recursive: true});
      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            sessionId: this.sessionId,
            hasStartedSession: this.hasStartedSession,
            skillsSignature: this.lastInjectedSkillsSignature,
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
    }

    const providerEnv = this.llmProvider
      ? buildAcpProviderEnv('claude', this.llmProvider, this.agentId)
      : {CLAUDE_CONFIG_DIR: claudeConfigDir};

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

  private buildHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
    return {};
  }

  private buildFullMessage(
    message: string,
    history?: HistoryMessage[],
  ): string {
    let fullMessage = '';

    if (this.systemPrompt) {
      fullMessage += `[System Instructions]\n${this.systemPrompt}\n\n`;
    }

    const longTermMemorySection = buildAgentLongTermMemorySection(
      this.chatRoomId,
      this.agentId,
      this.name,
    );
    if (longTermMemorySection) {
      fullMessage += `${longTermMemorySection}\n\n`;
    }

    const skillsUpdateSection = this.buildSkillsUpdateSection();
    if (skillsUpdateSection) {
      fullMessage += `${skillsUpdateSection}\n\n`;
    }

    if (this.injectGroupHistory && history && history.length > 0) {
      const memorySummary = history.find(
        (msg) => msg.kind === 'memory_summary',
      )?.content;
      const recentHistory = history.filter(
        (msg) => msg.kind !== 'memory_summary',
      );

      if (memorySummary) {
        fullMessage += `[Group Chat Long-Term Memory Summary]
${memorySummary}

`;
      }

      if (recentHistory.length > 0) {
        const historyText = recentHistory
          .map((msg) => `[${msg.senderName}]: ${msg.content}`)
          .join('\n');

        fullMessage += `[Recent Group Chat Messages]
The following are the most recent group-chat messages before the current message (${recentHistory.length} total):
${historyText}

`;
      }
    }

    if (this.chatRoomAgents.length > 0) {
      const agentsInfo = this.chatRoomAgents
        .map((agent) => agent.name)
        .join(', ');
      const otherAgents = this.chatRoomAgents.filter(
        (agent) => agent.name !== this.name,
      );
      const otherAgentsList = otherAgents.map((agent) => agent.name).join(', ');
      const othersInfo = otherAgents.length > 0 ? otherAgentsList : 'none';
      const mentionTip =
        otherAgents.length > 0
          ? '\n[Tip]\nWhen you need to message another assistant, write "@assistant_name message content" directly in your final reply. You may also mention an assistant in body text when the @ is preceded by a space. A target assistant is triggered only when @ is at the start of a line or the previous character is a space; @ immediately after punctuation will not trigger. A single message may mention at most one assistant. If the user only asks you to send a message to another assistant, output only that @assistant message in the final reply, with no explanation, pleasantries, summary, or expanded collaboration invitation. Before sending such a message, decide whether triggering another assistant is actually necessary.'
          : '';

      fullMessage += `[Group Chat Member Info]
Chatroom working directory: ${this.workDir}
Assistants in the current chatroom: ${agentsInfo}
You are: ${this.name}
Other assistants: ${othersInfo}${mentionTip}

`;
    }

    fullMessage += `[Current Message]\n${message}`;
    return fullMessage;
  }

  private buildSkillsUpdateSection(): string {
    const currentSignature = buildInstalledSkillsSignature(this.agentId);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }

    this.lastInjectedSkillsSignature = currentSignature;
    this.saveSessionId();
    return `[Installed Skills Update]
${buildInstalledSkillsInstructions(this.agentId)}`;
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
    return getSystemAssistantTools(this.agentId, this.chatRoomId);
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
        shell: process.env.SHELL || '/bin/bash',
        env: process.env,
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

  private appendThinking(text: string | undefined): void {
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
          status: 'completed',
          timestamp: Date.now(),
        });
      }
    }

    if (!this.content) {
      const text = extractTextFromContent(content);
      if (text) this.content = text;
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
      if (shouldSaveSession) this.saveSessionId();
    }

    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message);
        return undefined;
      case 'assistant':
        this.handleAssistantMessage(message);
        return normalizeUsage((message as any).message?.usage);
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
          this.saveSessionId();
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
  ): Promise<TokenUsage | undefined> {
    const env = this.buildEnv();
    const maxTurns = getClaudeMaxTurns();
    const thinking = getClaudeThinkingOptions(this.llmProvider, this.thinkingMode);
    this.lastClaudeStderr = '';
    this.logQueryStart(env);
    const settingSources: SettingSource[] = this.llmProvider
      ? []
      : ['user', 'project', 'local'];
    const allowedTaxTools = this.getAllowedTaxTools();
    const q = query({
      prompt: this.buildPrompt(fullMessage, attachments),
      options: {
        cwd: this.workDir,
        env,
        model: this.llmProvider?.model,
        includePartialMessages: true,
        maxTurns,
        thinking,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(allowedTaxTools.length > 0
          ? {
              mcpServers: {
                tax: this.buildTeamAgentXMcpServer(),
              },
              allowedTools: allowedTaxTools,
              disallowedTools: ['Bash', 'TaskOutput'],
            }
          : {}),
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
  ): Promise<AgentExecResult> {
    this.emitStream = emitStream || null;
    this.emitToolCall = emitToolCall || null;
    this.emitThinking = emitThinking || null;
    this.ensureSkillsSymlink();
    this.resetCollectors();

    const messageWithoutMentions = getMessageWithoutMentions(message);
    if (messageWithoutMentions.startsWith('/')) {
      const command = messageWithoutMentions.toLowerCase().trim();
      if (command === '/clear' || command === '/new') {
        const resultMessage = await this.handleClearContext(
          emit,
          originalMessageId,
        );
        return {actions: [{type: 'message', content: resultMessage}]};
      }

      const unsupportedMessage = `暂不支持当前指令: ${command}`;
      await emit(unsupportedMessage, originalMessageId);
      return {actions: [{type: 'message', content: unsupportedMessage}]};
    }

    const fullMessage = this.buildFullMessage(message, history);
    this.lastContext = fullMessage;

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const abort = () => abortController.abort();
    signal?.addEventListener('abort', abort, {once: true});

    let tokenUsage: TokenUsage | undefined;

    try {
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      this.ensureResumableSessionExists();
      const shouldResume = this.hasStartedSession;
      try {
        tokenUsage = await this.runQuery(
          fullMessage,
          attachments,
          signal,
          abortController,
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

        const canRetryWithFreshSession =
          isRecoverableSessionError(errorDetails);
        if (!canRetryWithFreshSession) {
          throw error;
        }

        console.warn(
          `${this.name}: Claude SDK session 失败，清理 session 后重试一次`,
        );
        this.resetSession();
        this.resetCollectors();
        tokenUsage = await this.runQuery(
          fullMessage,
          attachments,
          signal,
          abortController,
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
      await emit(`claude 执行出错: ${errorMessage}`, originalMessageId);
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null;
      }
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
