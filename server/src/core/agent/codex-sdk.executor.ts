import type { LlmProvider } from '@prisma/client';
import type { ThreadEvent, ThreadItem, Usage } from '@openai/codex-sdk';
import { createInterface } from 'readline';
import { createRequire } from 'module';
import { createHash, randomUUID } from 'crypto';
import { execFileSync, execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config as appConfig } from '../../config/index.js';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { buildAgentLongTermMemorySection } from './agent-long-term-memory.js';
import { debugLog } from './agent-handler/debug.js';
import { getInternalAgentToolToken } from './agent-handler/internal-agent-tool-auth.js';
import { buildAcpProviderEnv, type AcpProviderInfo } from './acp-provider.adapter.js';
import { parseProxyConfigEnv } from './proxy-config.js';
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

const TEAMAGENTX_CODEX_PROVIDER_ID = 'teamagentx_openai';
const INTERNAL_ORIGINATOR_ENV = 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE';
const TYPESCRIPT_SDK_ORIGINATOR = 'codex_sdk_ts';
const CODEX_NPM_NAME = '@openai/codex';
const moduleRequire = createRequire(import.meta.url);

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

type CodexConfigValue = string | number | boolean | CodexConfigValue[] | CodexConfigObject;
type CodexConfigObject = { [key: string]: CodexConfigValue | undefined };

interface CodexThreadOptions {
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  networkAccessEnabled?: boolean;
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
}

interface CodexRunOptions extends CodexThreadOptions {
  input: string;
  images: string[];
  threadId: string | null;
  apiKey?: string;
  signal?: AbortSignal;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

function formatTomlKey(key: string): string {
  return TOML_BARE_KEY.test(key) ? key : JSON.stringify(key);
}

function toTomlValue(value: CodexConfigValue, pathName: string): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Codex config override at ${pathName} must be a finite number`);
    }
    return `${value}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => toTomlValue(item, `${pathName}[${index}]`)).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    const parts: string[] = [];
    for (const [key, child] of Object.entries(value)) {
      if (!key) throw new Error('Codex config override keys must be non-empty strings');
      if (child === undefined) continue;
      parts.push(`${formatTomlKey(key)} = ${toTomlValue(child as CodexConfigValue, `${pathName}.${key}`)}`);
    }
    return `{${parts.join(', ')}}`;
  }
  throw new Error(`Unsupported Codex config override value at ${pathName}: ${typeof value}`);
}

function flattenConfigOverrides(value: CodexConfigObject, prefix: string, overrides: string[]): void {
  const entries = Object.entries(value);
  if (!prefix && entries.length === 0) return;
  if (prefix && entries.length === 0) {
    overrides.push(`${prefix}={}`);
    return;
  }

  for (const [key, child] of entries) {
    if (!key) throw new Error('Codex config override keys must be non-empty strings');
    if (child === undefined) continue;
    const pathName = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) && !Array.isArray(child)) {
      flattenConfigOverrides(child as CodexConfigObject, pathName, overrides);
    } else {
      overrides.push(`${pathName}=${toTomlValue(child as CodexConfigValue, pathName)}`);
    }
  }
}

function serializeConfigOverrides(configOverrides: CodexConfigObject): string[] {
  const overrides: string[] = [];
  flattenConfigOverrides(configOverrides, '', overrides);
  return overrides;
}

function getCodexTargetTriple(): string {
  if (process.platform === 'linux' || process.platform === 'android') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-musl';
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-musl';
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'x86_64-apple-darwin';
    if (process.arch === 'arm64') return 'aarch64-apple-darwin';
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc';
  }
  throw new Error(`Unsupported platform: ${process.platform} (${process.arch})`);
}

function findBundledCodexBinary(): string {
  const targetTriple = getCodexTargetTriple();
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  if (!platformPackage) throw new Error(`Unsupported target triple: ${targetTriple}`);

  try {
    const codexPackageJsonPath = moduleRequire.resolve(`${CODEX_NPM_NAME}/package.json`);
    const codexRequire = createRequire(codexPackageJsonPath);
    const platformPackageJsonPath = codexRequire.resolve(`${platformPackage}/package.json`);
    const vendorRoot = path.join(path.dirname(platformPackageJsonPath), 'vendor');
    const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
    return path.join(vendorRoot, targetTriple, 'codex', codexBinaryName);
  } catch {
    throw new Error(
      `Unable to locate Codex CLI binaries. Ensure ${CODEX_NPM_NAME} is installed with optional dependencies.`,
    );
  }
}

function findExecutableOnPath(commandName: string): string | undefined {
  try {
    const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(lookupCommand, [commandName], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result.split(/\r?\n/).find(Boolean)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function findGitNexusRepoRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, '.gitnexus'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function buildGitNexusMcpServerConfig(workDir: string): CodexConfigObject | undefined {
  if (!findGitNexusRepoRoot(workDir)) return undefined;

  const gitnexusCommand = findExecutableOnPath('gitnexus');
  if (!gitnexusCommand) return undefined;

  return {
    command: gitnexusCommand,
    args: ['mcp'],
  };
}

function getCodexBinaryFromPlatformPackageJson(platformPackageJsonPath: string): string | undefined {
  const targetTriple = getCodexTargetTriple();
  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const binaryPath = path.join(path.dirname(platformPackageJsonPath), 'vendor', targetTriple, 'codex', codexBinaryName);
  return fs.existsSync(binaryPath) ? binaryPath : undefined;
}

function getCodexBinaryFromCodexPackageJson(codexPackageJsonPath: string): string | undefined {
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[getCodexTargetTriple()];
  if (!platformPackage) return undefined;

  try {
    const codexRequire = createRequire(codexPackageJsonPath);
    const platformPackageJsonPath = codexRequire.resolve(`${platformPackage}/package.json`);
    return getCodexBinaryFromPlatformPackageJson(platformPackageJsonPath);
  } catch {
    const localVendorPath = getCodexBinaryFromPlatformPackageJson(codexPackageJsonPath);
    if (localVendorPath) return localVendorPath;
  }

  return undefined;
}

function getCodexBinaryFromCodexPackageDir(packageDir: string): string | undefined {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return undefined;
  return getCodexBinaryFromCodexPackageJson(packageJsonPath);
}

function getCodexBinaryFromBinShim(binPath: string): string | undefined {
  const normalized = path.normalize(binPath);
  const parts = normalized.split(path.sep);
  const nodeModulesIndex = parts.lastIndexOf('node_modules');
  if (nodeModulesIndex >= 0) {
    const packageDir = path.join(...parts.slice(0, nodeModulesIndex + 1), '@openai', 'codex');
    const fromPackageDir = getCodexBinaryFromCodexPackageDir(packageDir);
    if (fromPackageDir) return fromPackageDir;
  }

  try {
    const text = fs.readFileSync(binPath, 'utf-8');
    const match = text.match(/(?:^|["\s])([^"\r\n]+node_modules[\\/]@openai[\\/]codex[\\/]bin[\\/]codex\.js)/i);
    if (match?.[1]) {
      const packageDir = path.dirname(path.dirname(match[1]));
      return getCodexBinaryFromCodexPackageDir(packageDir);
    }
  } catch {
    // Ignore unreadable shims and keep looking.
  }

  return undefined;
}

export function buildCodexModelProviderConfig(provider?: LlmProvider | null): Record<string, unknown> {
  if (!provider) return {};

  const apiUrl = provider.apiUrl?.trim().replace(/\/+$/, '');
  if (!apiUrl) {
    return {
      model: provider.model,
      model_provider: 'openai',
    };
  }

  return {
    model: provider.model,
    model_provider: TEAMAGENTX_CODEX_PROVIDER_ID,
    model_providers: {
      [TEAMAGENTX_CODEX_PROVIDER_ID]: {
        name: provider.name || 'TeamAgentX OpenAI',
        base_url: apiUrl,
        env_key: 'CODEX_API_KEY',
        wire_api: 'responses',
        supports_websockets: false,
        requires_openai_auth: false,
      },
    },
  };
}

/**
 * 查找本地安装的 Codex CLI 可执行文件路径（TOOLS_DIR 或系统 PATH）。
 * 当 electron-builder 排除了 @openai/codex 原生二进制包时作为回退。
 */
function findLocalCodexBinary(): string | undefined {
  // 1. TOOLS_DIR 本地安装（npm install --prefix TOOLS_DIR @openai/codex）
  const toolsDir = process.env.TOOLS_DIR;
  if (toolsDir) {
    const extension = process.platform === 'win32' ? '.exe' : '';
    const localBin = path.join(toolsDir, 'node_modules', '.bin', 'codex' + extension);
    if (fs.existsSync(localBin)) return localBin;
  }

  // 2. 系统 PATH
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = execSync(`${which} codex 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (result) {
      const binPath = result.split('\n')[0].trim();
      if (binPath && fs.existsSync(binPath)) return binPath;
    }
  } catch {}

  return undefined;
}

function findSpawnableCodexBinary(): string | undefined {
  const isWindows = process.platform === 'win32';
  const extension = isWindows ? '.exe' : '';
  const tryPath = (candidate: string | undefined): string | undefined => {
    if (!candidate || !fs.existsSync(candidate)) return undefined;
    return candidate;
  };

  const toolsDir = process.env.TOOLS_DIR;
  if (toolsDir) {
    const fromPackage = getCodexBinaryFromCodexPackageDir(
      path.join(toolsDir, 'node_modules', '@openai', 'codex'),
    );
    if (fromPackage) return fromPackage;

    const directRootBinary = tryPath(path.join(toolsDir, 'codex' + extension));
    if (directRootBinary) return directRootBinary;

    const localBin = tryPath(path.join(toolsDir, 'node_modules', '.bin', 'codex' + extension));
    if (localBin) return localBin;

    if (isWindows) {
      const fromCmdShim =
        getCodexBinaryFromBinShim(path.join(toolsDir, 'node_modules', '.bin', 'codex.cmd')) ||
        getCodexBinaryFromBinShim(path.join(toolsDir, 'node_modules', '.bin', 'codex.CMD'));
      if (fromCmdShim) return fromCmdShim;
    } else {
      const unixShim = tryPath(path.join(toolsDir, 'node_modules', '.bin', 'codex'));
      if (unixShim) return unixShim;
    }
  }

  try {
    const which = isWindows ? 'where' : 'which';
    const result = execFileSync(which, ['codex'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
      windowsHide: true,
    }).trim();
    const candidates = result.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const candidate of candidates) {
      if (isWindows && /\.cmd$/i.test(candidate)) {
        const fromShim = getCodexBinaryFromBinShim(candidate);
        if (fromShim) return fromShim;
        continue;
      }
      const found = tryPath(candidate);
      if (found) return found;
    }
  } catch {
    // PATH lookup is best-effort; the bundled SDK path may still work in dev.
  }

  return findLocalCodexBinary();
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

type CodexInput = string | Array<{ type: 'text'; text: string } | { type: 'local_image'; path: string }>;

function normalizeCodexInput(input: CodexInput): { prompt: string; images: string[] } {
  if (typeof input === 'string') return { prompt: input, images: [] };

  const promptParts: string[] = [];
  const images: string[] = [];
  for (const item of input) {
    if (item.type === 'text') {
      promptParts.push(item.text);
    } else if (item.type === 'local_image') {
      images.push(item.path);
    }
  }
  return { prompt: promptParts.join('\n\n'), images };
}

function isMissingCodexThreadRolloutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /thread\/resume/i.test(error.message) && /no rollout found/i.test(error.message);
}

class TeamAgentXCodexRunner {
  constructor(
    private readonly executablePath: string,
    private readonly envOverride: Record<string, string>,
    private readonly configOverrides: CodexConfigObject,
  ) {}

  async *run(args: CodexRunOptions): AsyncGenerator<string> {
    const commandArgs = ['exec', '--experimental-json'];
    for (const override of serializeConfigOverrides(this.configOverrides)) {
      commandArgs.push('--config', override);
    }
    if (args.model) commandArgs.push('--model', args.model);
    if (args.sandboxMode) commandArgs.push('--sandbox', args.sandboxMode);
    if (args.workingDirectory) commandArgs.push('--cd', args.workingDirectory);
    if (args.skipGitRepoCheck) commandArgs.push('--skip-git-repo-check');
    if (args.networkAccessEnabled !== undefined) {
      commandArgs.push('--config', `sandbox_workspace_write.network_access=${args.networkAccessEnabled}`);
    }
    if (args.approvalPolicy) commandArgs.push('--config', `approval_policy="${args.approvalPolicy}"`);
    if (args.threadId) commandArgs.push('resume', args.threadId);
    for (const image of args.images) {
      commandArgs.push('--image', image);
    }

    const env = { ...this.envOverride };
    if (!env[INTERNAL_ORIGINATOR_ENV]) {
      env[INTERNAL_ORIGINATOR_ENV] = TYPESCRIPT_SDK_ORIGINATOR;
    }
    if (args.apiKey) {
      env.CODEX_API_KEY = args.apiKey;
    }

    const child = spawn(this.executablePath, commandArgs, { env, signal: args.signal });
    let spawnError: Error | null = null;
    child.once('error', (error) => {
      spawnError = error;
    });

    if (!child.stdin) {
      child.kill();
      throw new Error('Child process has no stdin');
    }
    child.stdin.write(args.input);
    child.stdin.end();

    if (!child.stdout) {
      child.kill();
      throw new Error('Child process has no stdout');
    }

    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        yield String(line);
      }
      if (spawnError) throw spawnError;

      const { code, signal } = await exitPromise;
      if (code !== 0 || signal) {
        const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
        throw new Error(`Codex Exec exited with ${detail}: ${Buffer.concat(stderrChunks).toString('utf8')}`);
      }
    } finally {
      rl.close();
      child.removeAllListeners();
      try {
        if (!child.killed) child.kill();
      } catch {
        // Ignore cleanup failures after process exit.
      }
    }
  }
}

class TeamAgentXCodexThread {
  constructor(
    private readonly runner: TeamAgentXCodexRunner,
    private readonly apiKey: string | undefined,
    private readonly options: CodexThreadOptions,
    private _id: string | null = null,
  ) {}

  get id(): string | null {
    return this._id;
  }

  async runStreamed(input: CodexInput, turnOptions: { signal?: AbortSignal } = {}): Promise<{ events: AsyncGenerator<ThreadEvent> }> {
    return { events: this.runStreamedInternal(input, turnOptions) };
  }

  private async *runStreamedInternal(
    input: CodexInput,
    turnOptions: { signal?: AbortSignal },
  ): AsyncGenerator<ThreadEvent> {
    const { prompt, images } = normalizeCodexInput(input);
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumeThreadId = this._id;
      const generator = this.runner.run({
        input: prompt,
        images,
        threadId: resumeThreadId,
        apiKey: this.apiKey,
        signal: turnOptions.signal,
        model: this.options.model,
        sandboxMode: this.options.sandboxMode,
        workingDirectory: this.options.workingDirectory,
        skipGitRepoCheck: this.options.skipGitRepoCheck,
        networkAccessEnabled: this.options.networkAccessEnabled,
        approvalPolicy: this.options.approvalPolicy,
      });

      try {
        for await (const line of generator) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (!trimmed.startsWith('{')) {
            debugLog('codexSdkIgnoredStdoutLine', { line: trimmed });
            continue;
          }

          let parsed: ThreadEvent;
          try {
            parsed = JSON.parse(trimmed) as ThreadEvent;
          } catch (error) {
            throw new Error(`Failed to parse item: ${line}`, { cause: error });
          }

          if (parsed.type === 'thread.started') {
            this._id = parsed.thread_id;
          }
          yield parsed;
        }
        return;
      } catch (error) {
        if (attempt === 0 && resumeThreadId && isMissingCodexThreadRolloutError(error)) {
          debugLog('codexSdkResumeThreadMissingRollout', {
            threadId: resumeThreadId,
            message: error instanceof Error ? error.message : String(error),
          });
          this._id = null;
          continue;
        }
        throw error;
      }
    }
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
  readonly imageGenerationProvider?: LlmProvider | null;
  readonly proxyConfig: string | null;
  readonly codexModel: string | null;

  private _lastInjectedMessageId?: string;
  private systemPrompt: string;
  private agentId: string | null = null;
  private threadId: string | null;
  private lastInjectedSkillsSignature?: string;
  private acpProviderInfo?: AcpProviderInfo;
  private currentAbortController: AbortController | null = null;
  private thread: TeamAgentXCodexThread | null = null;

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
    imageGenerationProvider?: LlmProvider | null,
    proxyConfig?: string | null,
    codexModel?: string | null,
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
    this.proxyConfig = proxyConfig || null;
    this.codexModel = codexModel || null;

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

${getImageGenerationSkillInstructions(this.imageGenerationProvider)}

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
const generateImageEndpoint = process.env.TEAMAGENTX_GENERATE_IMAGE_ENDPOINT;
const token = process.env.TEAMAGENTX_INTERNAL_TOOL_TOKEN;
const chatRoomId = process.env.TEAMAGENTX_CHAT_ROOM_ID;
const sourceAgentId = process.env.TEAMAGENTX_SOURCE_AGENT_ID;
const chatRoomAgents = JSON.parse(process.env.TEAMAGENTX_CHAT_ROOM_AGENTS || "[]");

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
  if (!chatRoomId || !sourceAgentId) {
    return toolResult("TeamAgentX 工具环境不完整，无法生成消息草稿。", {}, true);
  }

  const content = typeof args?.content === "string" ? args.content.trim() : "";

  function normalizeStringArray(value) {
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  const targetAgentIds = [
    ...normalizeStringArray(args?.targetAgentIds),
    ...normalizeStringArray(args?.targetAgentId),
  ];
  const targetAgentNames = [
    ...normalizeStringArray(args?.targetAgentNames),
    ...normalizeStringArray(args?.targetAgentName),
  ];
  const targets = [];
  const seen = new Set();

  for (const targetAgentId of targetAgentIds) {
    const targetAgent = chatRoomAgents.find((agent) => agent.agentId === targetAgentId);
    if (!targetAgent?.name || seen.has(targetAgent.name)) continue;
    seen.add(targetAgent.name);
    targets.push({ agentId: targetAgent.agentId, agentName: targetAgent.name });
  }

  for (const targetAgentName of targetAgentNames) {
    const targetAgent = chatRoomAgents.find((agent) => agent.name === targetAgentName);
    const resolvedName = targetAgent?.name || targetAgentName;
    if (seen.has(resolvedName)) continue;
    seen.add(resolvedName);
    targets.push({ agentId: targetAgent?.agentId, agentName: resolvedName });
  }

  if (!content || targets.length === 0) {
    return toolResult("参数错误：必须提供 content，以及至少一个可解析的 targetAgentId/targetAgentName 或 targetAgentIds/targetAgentNames。", {}, true);
  }

  const mentionPrefix = targets.map((agent) => "@" + agent.agentName).join(" ");
  const draftContent = mentionPrefix + " " + content;
  return toolResult("最终回复请只输出下面这段消息，不要添加其他内容：\\n" + draftContent, {
    targetAgentIds: targets.map((agent) => agent.agentId).filter(Boolean),
    targetAgentNames: targets.map((agent) => agent.agentName),
    targetAgents: targets,
    content,
    draftContent,
  }, false);
}

async function callGenerateImage(args) {
  if (!generateImageEndpoint || !token || !sourceAgentId) {
    return toolResult("当前助手未开启图片生成能力。", {}, true);
  }

  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  const n = Number.isInteger(args?.n) ? args.n : undefined;
  if (!prompt) {
    return toolResult("参数错误：必须提供 prompt。", {}, true);
  }
  if (n !== undefined && (n < 1 || n > 4)) {
    return toolResult("参数错误：n 必须在 1 到 4 之间。", {}, true);
  }

  try {
    const response = await fetch(generateImageEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        sourceAgentId,
        prompt,
        size: typeof args?.size === "string" ? args.size : undefined,
        n,
        filename: typeof args?.filename === "string" ? args.filename : undefined,
        extraJson: args?.extraJson && typeof args.extraJson === "object" ? args.extraJson : undefined,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "图片生成失败。", payload, true);
    }
    const result = payload.data || payload;
    const urls = Array.isArray(result.urls) ? result.urls : [];
    const files = Array.isArray(result.files) ? result.files : [];
    return toolResult("图片生成成功：" + (urls.join(", ") || files.join(", ")), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "图片生成失败。", {}, true);
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
    const tools = [{
      name: "send_message",
      description: "生成一段要放入最终回复的 TeamAgentX 助手消息草稿。消息内容可以是用户要求转达的任意内容，不一定是协作请求。工具支持一个或多个目标助手；不会直接发送消息，也不会直接触发任务。你必须把返回的 @目标助手 消息内容放入最终回复，最终回复落入群聊后才会在自动模式下触发目标助手。如果用户只是要求你给某个或多个助手发消息，最终回复只输出这条 @助手消息，不要添加解释、寒暄、总结，也不要擅自扩写成协作邀请。",
      inputSchema: {
        type: "object",
        properties: {
          targetAgentId: { type: "string", description: "目标助手 ID。已知 ID 时优先使用。" },
          targetAgentName: { type: "string", description: "目标助手名称。未提供 ID 时使用。" },
          targetAgentIds: { type: "array", items: { type: "string" }, description: "多个目标助手 ID。已知 ID 时优先使用。" },
          targetAgentNames: { type: "array", items: { type: "string" }, description: "多个目标助手名称。未提供 ID 时使用。" },
          content: { type: "string", description: "给目标助手的消息内容，不要包含 @目标助手名前缀。多个目标会自动生成 @助手1 @助手2 前缀。" },
        },
        required: ["content"],
        additionalProperties: false,
      },
    }];
    if (generateImageEndpoint) {
      tools.push({
        name: "generate_image",
        description: "通过 TeamAgentX 服务端受控图片模型生成图片。API Key 只在服务端使用。",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "详细图片提示词。应包含主体、风格、构图、色彩、用途等。" },
            size: { type: "string", description: "图片尺寸或比例，例如 1024x1024、1024x1792、1:1。" },
            n: { type: "number", description: "生成图片数量，默认 1，最多 4。" },
            filename: { type: "string", description: "可选文件名，不要包含路径。" },
            extraJson: { type: "object", description: "供应商特定额外参数。" },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      });
    }
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools,
      },
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === "send_message") {
      const result = await callSendMessage(args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "generate_image") {
      const result = await callGenerateImage(args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    write({
      jsonrpc: "2.0",
      id,
      result: toolResult("未知工具：" + name, {}, true),
    });
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
      ...parseProxyConfigEnv(this.proxyConfig),
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
        ? '\n【提示】\n需要给其他助手发任意消息时，调用 tax.send_message 工具生成消息草稿，并把工具返回的 @助手消息放入你的最终回复。工具本身不会直接发送消息；最终回复中的 @助手消息会在自动模式下触发目标助手。如果用户只是要求你给某个助手发消息，最终回复只输出这条 @助手消息，不要添加解释、寒暄、总结，也不要擅自扩写成协作邀请。'
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

  private getCodexRunner(): TeamAgentXCodexRunner {
    const env = this.buildEnv();
    const mcpServerPath = this.ensureTeamAgentXMcpServerFile();
    const generateImageEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/generate-image`;
    const gitNexusMcpServer = buildGitNexusMcpServerConfig(this.workDir);
    const config = {
      hide_agent_reasoning: false,
      show_raw_agent_reasoning: false,
      model_reasoning_summary: 'concise',
      skills: {
        include_instructions: false,
      },
      mcp_servers: {
        ...(gitNexusMcpServer ? { gitnexus: gitNexusMcpServer } : {}),
        tax: {
          command: process.execPath,
          args: [mcpServerPath],
          env: {
            TEAMAGENTX_CHAT_ROOM_ID: this.chatRoomId,
            TEAMAGENTX_SOURCE_AGENT_ID: this.agentId || '',
            TEAMAGENTX_SOURCE_AGENT_NAME: this.name,
            TEAMAGENTX_CHAT_ROOM_AGENTS: JSON.stringify(this.chatRoomAgents.map((agent) => ({
              agentId: agent.agentId,
              name: agent.name,
            }))),
            ...(this.imageGenerationProvider ? {
              TEAMAGENTX_GENERATE_IMAGE_ENDPOINT: generateImageEndpoint,
              TEAMAGENTX_INTERNAL_TOOL_TOKEN: getInternalAgentToolToken(),
            } : {}),
          },
        },
      },
      ...(this.llmProvider
        ? buildCodexModelProviderConfig(this.llmProvider)
        : {}),
    } as CodexConfigObject;

    return new TeamAgentXCodexRunner(
      findSpawnableCodexBinary() || findBundledCodexBinary(),
      env,
      config,
    );
  }

  private getThread(): TeamAgentXCodexThread {
    const runner = this.getCodexRunner();
    const options = {
      model: this.llmProvider?.model || this.codexModel || undefined,
      workingDirectory: this.workDir,
      skipGitRepoCheck: true,
      sandboxMode: 'danger-full-access' as const,
      approvalPolicy: 'never' as const,
      networkAccessEnabled: true,
    };

    if (this.thread) return this.thread;
    this.thread = this.threadId
      ? new TeamAgentXCodexThread(runner, this.llmProvider?.apiKey, options, this.threadId)
      : new TeamAgentXCodexThread(runner, this.llmProvider?.apiKey, options);
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

/**
 * 清理 ACP 助手（Codex SDK）的文件系统上下文
 * 用于清空群聊消息时，即使没有 executor 缓存也能清理 session 状态文件
 *
 * @param agentId 助手 ID
 * @param chatRoomId 群聊 ID
 */
export function clearCodexSdkFileSystemContext(agentId: string, chatRoomId: string): void {
  const codexHome = path.join(os.homedir(), '.teamagentx', 'acp-config', agentId, 'codex');

  if (!fs.existsSync(codexHome)) {
    return;
  }

  // 计算 scope（与 getSessionStatePath 一致）
  const workDir = path.join(os.homedir(), '.teamagentx', 'workspace', chatRoomId);
  const scope = createHash('sha256')
    .update(`${chatRoomId}:${workDir}`)
    .digest('hex')
    .slice(0, 16);

  // 删除 session 状态文件
  const sessionStatePath = path.join(codexHome, `teamagentx-codex-sdk-session-${scope}.json`);
  if (fs.existsSync(sessionStatePath)) {
    try {
      fs.unlinkSync(sessionStatePath);
      console.log(`[ClearCodexContext] 已删除 session 状态文件: ${sessionStatePath}`);
    } catch (error) {
      console.warn(`[ClearCodexContext] 删除 session 状态文件失败: ${sessionStatePath}`, error);
    }
  }

  // 删除旧版 session 文件（兼容）
  const legacySessionPath = path.join(codexHome, 'teamagentx-codex-sdk-session.json');
  if (fs.existsSync(legacySessionPath)) {
    try {
      fs.unlinkSync(legacySessionPath);
      console.log(`[ClearCodexContext] 已删除旧版 session 文件: ${legacySessionPath}`);
    } catch (error) {
      console.warn(`[ClearCodexContext] 删除旧版 session 文件失败: ${legacySessionPath}`, error);
    }
  }

  console.log(`[ClearCodexContext] 已清理 Codex SDK 上下文: agentId=${agentId}, chatRoomId=${chatRoomId}`);
}
