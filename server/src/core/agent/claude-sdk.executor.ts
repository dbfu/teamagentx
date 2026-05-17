import type {
    HookCallbackMatcher,
    HookEvent,
    SDKMessage,
    SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
    createSdkMcpServer,
    query,
    tool as sdkTool,
} from '@anthropic-ai/claude-agent-sdk';
import type { LlmProvider } from '@prisma/client';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod/v4';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
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
import {
    AGENT_CREATOR_AGENT_ID,
    agentCreatorTools,
    CHATROOM_HELPER_AGENT_ID,
    chatroomHelperTools,
    createExternalPlatformHelperTools,
    CRON_TASK_HELPER_AGENT_ID,
    cronTaskHelperTools,
    EXTERNAL_PLATFORM_HELPER_AGENT_ID,
    SKILL_MANAGER_AGENT_ID,
    skillManagerTools,
} from './tools/index.js';
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
  if (!rawValue) return 50;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;

  return parsed;
}

function getClaudeThinkingOptions(
  provider?: LlmProvider,
):
  | {type: 'adaptive'}
  | {type: 'enabled'; budgetTokens?: number}
  | {type: 'disabled'}
  | undefined {
  const mode = (process.env.CLAUDE_AGENT_THINKING || 'enabled').toLowerCase();

  if (
    (provider as any)?.supportsThinking === false ||
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

const DEFAULT_LONG_RUNNING_BASH_TIMEOUT_MS = 15 * 1000;
const DEFAULT_BACKGROUND_IDLE_FINISH_MS = 20 * 1000;

const LONG_RUNNING_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|preview|start)\b/i,
  /\b(?:vite|next|nuxt|astro|remix|webpack-dev-server|storybook)\b/i,
  /\b(?:tsx|ts-node|node)\b.*\b(?:dev|serve|server|watch)\b/i,
  /\b(?:python|python3)\s+-m\s+(?:http\.server|uvicorn)\b/i,
  /\b(?:uvicorn|fastapi\s+dev|flask\s+run|django-admin\s+runserver)\b/i,
  /\b(?:rails|bin\/rails)\s+(?:s|server)\b/i,
  /\b(?:php\s+-S|air|reflex)\b/i,
  /\b(?:docker\s+compose|docker-compose)\s+up\b/i,
] as const;

function getLongRunningBashTimeoutMs(): number {
  const rawValue = process.env.CLAUDE_AGENT_LONG_RUNNING_BASH_TIMEOUT_MS;
  if (!rawValue) return DEFAULT_LONG_RUNNING_BASH_TIMEOUT_MS;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return DEFAULT_LONG_RUNNING_BASH_TIMEOUT_MS;
  }

  return parsed;
}

function getBackgroundIdleFinishMs(): number {
  const rawValue = process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
  if (!rawValue) return DEFAULT_BACKGROUND_IDLE_FINISH_MS;

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return DEFAULT_BACKGROUND_IDLE_FINISH_MS;
  }

  return parsed;
}

function normalizeBashCommand(command: string): string {
  return command.replace(/^\s*(?:cd\s+[^;&|]+\s*&&\s*)+/i, '').trim();
}

function shouldRunBashInBackground(command: string): boolean {
  const normalizedCommand = normalizeBashCommand(command);
  if (
    !normalizedCommand ||
    /(?:^|\s)(?:&|nohup|disown)(?:\s|$)/.test(normalizedCommand)
  ) {
    return false;
  }

  return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) =>
    pattern.test(normalizedCommand),
  );
}

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
## 当前模型
你正在使用 ${this.llmProvider.name} 提供的模型服务。
- 模型名称：${this.llmProvider.model}
- 供应商类型：${this.llmProvider.type}`
      : '';

    this.systemPrompt = `${modelInfo}
${systemPrompt}

${getImageGenerationSkillInstructions(this.imageGenerationProvider)}

## 工作目录
你的工作目录是：${this.workDir}
执行文件操作和命令时，默认在此目录下操作。使用相对路径时，基于此目录解析。`;

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
      if (syncResult.settings.copied || syncResult.state.copied) {
        logClaudeSdkDebug('synced global Claude settings', {
          agentName: this.name,
          agentId: this.agentId,
          settings: syncResult.settings,
          state: syncResult.state,
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
      thinking: getClaudeThinkingOptions(this.llmProvider),
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
    return {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              if (
                input.hook_event_name !== 'PreToolUse' ||
                input.tool_name !== 'Bash'
              ) {
                return {continue: true};
              }

              const toolInput = input.tool_input;
              if (!toolInput || typeof toolInput !== 'object') {
                return {continue: true};
              }

              const command = (toolInput as {command?: unknown}).command;
              if (
                typeof command !== 'string' ||
                !shouldRunBashInBackground(command)
              ) {
                return {continue: true};
              }

              this.hasBackgroundedLongRunningCommand = true;

              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  updatedInput: {
                    ...(toolInput as Record<string, unknown>),
                    timeout: getLongRunningBashTimeoutMs(),
                    run_in_background: true,
                  },
                  additionalContext:
                    'TeamAgentX detected a long-running service command and started it in the background so the conversation can continue.',
                },
              };
            },
          ],
        },
      ],
    };
  }

  private buildFullMessage(
    message: string,
    history?: HistoryMessage[],
  ): string {
    let fullMessage = '';

    if (this.systemPrompt) {
      fullMessage += `【系统指令】\n${this.systemPrompt}\n\n`;
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
      const agentsInfo = this.chatRoomAgents
        .map((agent) => agent.name)
        .join('、');
      const otherAgents = this.chatRoomAgents.filter(
        (agent) => agent.name !== this.name,
      );
      const otherAgentsList = otherAgents.map((agent) => agent.name).join('、');
      const othersInfo = otherAgents.length > 0 ? otherAgentsList : '无';
      const mentionTip =
        otherAgents.length > 0
          ? '\n【提示】\n需要给其他助手发任意消息时，必须调用 mcp__tax__send_message 工具生成消息草稿，并把工具返回的 @助手消息放入你的最终回复。工具本身不会直接发送消息；最终回复中的 @助手消息会在自动模式下触发目标助手。如果用户只是要求你给某个助手发消息，最终回复只输出这条 @助手消息，不要添加解释、寒暄、总结，也不要擅自扩写成协作邀请。再发消息之前，你需要判断一下是否真的需要发消息给某个助手。'
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
    this.saveSessionId();
    return `【技能清单更新】
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
    switch (this.agentId) {
      case AGENT_CREATOR_AGENT_ID:
        return agentCreatorTools;
      case SKILL_MANAGER_AGENT_ID:
        return skillManagerTools;
      case CRON_TASK_HELPER_AGENT_ID:
        return cronTaskHelperTools;
      case CHATROOM_HELPER_AGENT_ID:
        return chatroomHelperTools;
      case EXTERNAL_PLATFORM_HELPER_AGENT_ID:
        return createExternalPlatformHelperTools(this.chatRoomId);
      default:
        return [];
    }
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
                    error instanceof Error ? error.message : '工具执行失败。',
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

  private getAllowedTaxTools(): string[] {
    const systemToolNames = this.getSystemAssistantTools()
      .map((tool) => tool.name)
      .filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      );

    return [
      'mcp__tax__send_message',
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
        sdkTool(
          'send_message',
          '生成一段要放入最终回复的 TeamAgentX 助手消息草稿。消息内容可以是用户要求转达的任意内容，不一定是协作请求。工具支持一个或多个目标助手；不会直接发送消息，也不会直接触发任务。你必须把返回的 @目标助手 消息内容放入最终回复，最终回复落入群聊后才会在自动模式下触发目标助手。如果用户只是要求你给某个或多个助手发消息，最终回复只输出这条 @助手消息，不要添加解释、寒暄、总结，也不要擅自扩写成协作邀请。',
          {
            targetAgentId: z
              .string()
              .optional()
              .describe('目标助手 ID。已知 ID 时优先使用。'),
            targetAgentName: z
              .string()
              .optional()
              .describe('目标助手名称。未提供 ID 时使用。'),
            targetAgentIds: z
              .array(z.string())
              .optional()
              .describe('多个目标助手 ID。已知 ID 时优先使用。'),
            targetAgentNames: z
              .array(z.string())
              .optional()
              .describe('多个目标助手名称。未提供 ID 时使用。'),
            content: z
              .string()
              .describe(
                '给目标助手的消息内容，不要包含 @目标助手名前缀。多个目标会自动生成 @助手1 @助手2 前缀。',
              ),
          },
          async (args) => {
            if (!this.agentId) {
              return {
                content: [
                  {
                    type: 'text',
                    text: '当前助手缺少 agentId，无法生成消息草稿。',
                  },
                ],
                isError: true,
              };
            }

            try {
              const content = args.content.trim();
              const normalizeStringArray = (
                value: string | string[] | undefined,
              ) => {
                if (Array.isArray(value)) {
                  return value.map((item) => item.trim()).filter(Boolean);
                }
                return value?.trim() ? [value.trim()] : [];
              };
              const targetAgentIds = [
                ...normalizeStringArray(args.targetAgentIds),
                ...normalizeStringArray(args.targetAgentId),
              ];
              const targetAgentNames = [
                ...normalizeStringArray(args.targetAgentNames),
                ...normalizeStringArray(args.targetAgentName),
              ];
              const targets: {agentId?: string; agentName: string}[] = [];
              const seen = new Set<string>();

              for (const targetAgentId of targetAgentIds) {
                const targetAgent = this.chatRoomAgents.find(
                  (agent) => agent.agentId === targetAgentId,
                );
                if (!targetAgent?.name || seen.has(targetAgent.name)) continue;
                seen.add(targetAgent.name);
                targets.push({
                  agentId: targetAgent.agentId,
                  agentName: targetAgent.name,
                });
              }

              for (const targetAgentName of targetAgentNames) {
                const targetAgent = this.chatRoomAgents.find(
                  (agent) => agent.name === targetAgentName,
                );
                const resolvedName = targetAgent?.name || targetAgentName;
                if (seen.has(resolvedName)) continue;
                seen.add(resolvedName);
                targets.push({
                  agentId: targetAgent?.agentId,
                  agentName: resolvedName,
                });
              }

              if (!content || targets.length === 0) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: '参数错误：必须提供 content，以及至少一个可解析的 targetAgentId/targetAgentName 或 targetAgentIds/targetAgentNames。',
                    },
                  ],
                  isError: true,
                };
              }

              const mentionPrefix = targets
                .map((agent) => `@${agent.agentName}`)
                .join(' ');
              const draftContent = `${mentionPrefix} ${content}`;

              return {
                content: [
                  {
                    type: 'text',
                    text: `最终回复请只输出下面这段消息，不要添加其他内容：\n${draftContent}`,
                  },
                ],
                structuredContent: {
                  targetAgentIds: targets
                    .map((agent) => agent.agentId)
                    .filter(Boolean),
                  targetAgentNames: targets.map((agent) => agent.agentName),
                  targetAgents: targets,
                  content,
                  draftContent,
                },
              };
            } catch (error) {
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      error instanceof Error
                        ? error.message
                        : '生成消息草稿失败。',
                  },
                ],
                isError: true,
              };
            }
          },
          {alwaysLoad: true},
        ),
        ...(this.imageGenerationProvider
          ? [
              sdkTool(
                'generate_image',
                '通过 TeamAgentX 服务端受控图片模型生成图片。API Key 只在服务端使用。用户明确要求生成图片、海报、插画、产品图或视觉稿时使用。',
                {
                  prompt: z
                    .string()
                    .describe(
                      '详细图片提示词。应包含主体、风格、构图、色彩、用途等。',
                    ),
                  size: z
                    .string()
                    .optional()
                    .describe(
                      '图片尺寸或比例，例如 1024x1024、1024x1792、1:1。',
                    ),
                  n: z
                    .number()
                    .int()
                    .min(1)
                    .max(4)
                    .optional()
                    .describe('生成图片数量，默认 1，最多 4。'),
                  filename: z
                    .string()
                    .optional()
                    .describe('可选文件名，不要包含路径。'),
                  extraJson: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe('供应商特定额外参数。'),
                },
                async (args) => {
                  if (!this.agentId) {
                    return {
                      content: [
                        {
                          type: 'text',
                          text: '当前助手缺少 agentId，无法生成图片。',
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
                          text: `图片生成成功：${result.urls.join(', ') || result.files.join(', ')}`,
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
                              : '图片生成失败。',
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

    for (const block of content) {
      if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        this.appendThinking(block.thinking);
      }

      if (block?.type === 'tool_use') {
        this.upsertToolCall({
          name: this.stripMcpTaxPrefix(block.name || 'tool_call'),
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
  }

  private handleUserMessage(message: any): void {
    const content = message.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block?.type === 'tool_result') {
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
    const thinking = getClaudeThinkingOptions(this.llmProvider);
    this.lastClaudeStderr = '';
    this.logQueryStart(env);
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
        mcpServers: {
          tax: this.buildTeamAgentXMcpServer(),
        },
        allowedTools: this.getAllowedTaxTools(),
        settingSources: ['user', 'project', 'local'],
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
        this.hasBackgroundedLongRunningCommand && this.content.trim()
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
          `${this.name}: Claude SDK query 已中止，重置 session 供下一轮使用`,
        );
        this.resetSession();
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
          const workDir = getDefaultChatRoomWorkDir(chatRoomId);
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
    const workDir = getDefaultChatRoomWorkDir(chatRoomId);
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
