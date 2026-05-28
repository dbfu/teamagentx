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
import { buildRoomMessageIndexSection } from '../../modules/message/room-message-index.service.js';
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
import {
  DEFAULT_AGENT_THINKING_MODE,
  type AgentThinkingMode,
} from './thinking-mode.js';
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
const DEFAULT_CODEX_SDK_MAX_THREAD_TURNS = 8;
const DEFAULT_CODEX_SDK_MAX_SESSION_BYTES = 2 * 1024 * 1024;
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

interface CodexBuiltinMcpServerContext {
  workDir: string;
  teamAgentXMcpServerPath: string;
  chatRoomId: string;
  agentId?: string;
  agentName: string;
  chatRoomAgents: ChatRoomAgentInfo[];
  generateImageEndpoint?: string;
  systemToolsListEndpoint?: string;
  systemToolsCallEndpoint?: string;
  backgroundCommandStartEndpoint?: string;
  backgroundCommandReadEndpoint?: string;
  backgroundCommandStopEndpoint?: string;
  backgroundCommandListEndpoint?: string;
}

interface CodexBuiltinMcpServerDefinition {
  name: string;
  build: (context: CodexBuiltinMcpServerContext) => CodexConfigObject | undefined;
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

function getPositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : defaultValue;
}

type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

function getCodexReasoningEffort(thinkingMode?: AgentThinkingMode | null): CodexReasoningEffort {
  if (thinkingMode) {
    return thinkingMode === 'off' ? 'minimal' : thinkingMode;
  }

  const value = process.env.CODEX_SDK_REASONING_EFFORT?.trim().toLowerCase();
  if (value && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(value)) {
    return value as CodexReasoningEffort;
  }
  return DEFAULT_AGENT_THINKING_MODE;
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

const BUILTIN_CODEX_MCP_SERVERS: CodexBuiltinMcpServerDefinition[] = [
  {
    name: 'gitnexus',
    build: ({ workDir }) => {
      if (!findGitNexusRepoRoot(workDir)) return undefined;

      const gitnexusCommand = findExecutableOnPath('gitnexus');
      if (!gitnexusCommand) return undefined;

      return {
        command: gitnexusCommand,
        args: ['mcp'],
      };
    },
  },
  {
    name: 'tax',
    build: ({
      workDir,
      teamAgentXMcpServerPath,
      chatRoomId,
      agentId,
      generateImageEndpoint,
      systemToolsListEndpoint,
      systemToolsCallEndpoint,
      backgroundCommandStartEndpoint,
      backgroundCommandReadEndpoint,
      backgroundCommandStopEndpoint,
      backgroundCommandListEndpoint,
    }) => {
      if (!generateImageEndpoint && !systemToolsListEndpoint && !backgroundCommandStartEndpoint) return undefined;

      return {
        command: process.execPath,
        args: [teamAgentXMcpServerPath],
        env: {
          TEAMAGENTX_CHAT_ROOM_ID: chatRoomId,
          TEAMAGENTX_SOURCE_AGENT_ID: agentId || '',
          TEAMAGENTX_WORK_DIR: workDir,
          TEAMAGENTX_GENERATE_IMAGE_ENDPOINT: generateImageEndpoint,
          TEAMAGENTX_SYSTEM_TOOLS_LIST_ENDPOINT: systemToolsListEndpoint,
          TEAMAGENTX_SYSTEM_TOOLS_CALL_ENDPOINT: systemToolsCallEndpoint,
          TEAMAGENTX_BACKGROUND_COMMAND_START_ENDPOINT: backgroundCommandStartEndpoint,
          TEAMAGENTX_BACKGROUND_COMMAND_READ_ENDPOINT: backgroundCommandReadEndpoint,
          TEAMAGENTX_BACKGROUND_COMMAND_STOP_ENDPOINT: backgroundCommandStopEndpoint,
          TEAMAGENTX_BACKGROUND_COMMAND_LIST_ENDPOINT: backgroundCommandListEndpoint,
          TEAMAGENTX_INTERNAL_TOOL_TOKEN: getInternalAgentToolToken(),
        },
      };
    },
  },
];

export function buildBuiltinCodexMcpServerConfigs(
  context: CodexBuiltinMcpServerContext,
): CodexConfigObject {
  const mcpServers: CodexConfigObject = {};
  for (const definition of BUILTIN_CODEX_MCP_SERVERS) {
    const config = definition.build(context);
    if (config) {
      mcpServers[definition.name] = config;
    }
  }
  return mcpServers;
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
    return { available: hasApiKey || hasChatGptTokens, path: authPath };
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
  readonly codexFastMode: boolean;
  readonly thinkingMode: AgentThinkingMode;
  readonly stateless: boolean;

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
    injectGroupHistory: boolean = false,
    agentId?: string,
    sessionDir?: string,
    customWorkDir?: string,
    lastInjectedMessageId?: string,
    chatRoomAgents?: ChatRoomAgentInfo[],
    llmProvider?: LlmProvider,
    imageGenerationProvider?: LlmProvider | null,
    proxyConfig?: string | null,
    codexModel?: string | null,
    codexFastMode?: boolean,
    thinkingMode?: AgentThinkingMode | null,
    chatRoomRules?: string,
    stateless: boolean = false,
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
    this.codexFastMode = Boolean(codexFastMode);
    this.thinkingMode = thinkingMode || DEFAULT_AGENT_THINKING_MODE;
    this.stateless = stateless;

    this.workDir = resolveAgentWorkDir({
      chatRoomId,
      sessionDir,
      customWorkDir,
      agentWorkDir: workDir,
    });

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

## Assistant Mentions
In TeamAgentX, an @assistant mention can trigger another assistant task. A single message may contain at most one triggerable @assistant mention. When handing off or asking another assistant, choose one target assistant and mention only that assistant. If multiple assistants could help, choose the best next assistant or ask the user to choose; refer to any additional assistants by name without @.

## Working Directory
Your working directory is: ${this.workDir}
When you perform file operations or run commands, operate in this directory by default. Resolve relative paths from this directory.

## Background Commands
For long-running services or commands that should keep running after this turn, such as \`pnpm dev\`, \`npm run dev\`, \`vite\`, \`next dev\`, watch modes, servers, listeners, and \`tail -f\`, use the MCP tool \`start_background_command\` instead of running the command directly in the shell. Use \`read_background_command_output\` to inspect logs, \`list_background_commands\` to find existing tasks, and \`stop_background_command\` when the user asks to stop one. Do not block the turn waiting for a dev server to exit.`;

    this.ensureWorkDirectory();
    this.threadId = this.stateless ? null : this.loadThreadId();
    this.lastInjectedSkillsSignature = this.stateless ? undefined : this.loadSkillsSignature();
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
const systemToolsListEndpoint = process.env.TEAMAGENTX_SYSTEM_TOOLS_LIST_ENDPOINT;
const systemToolsCallEndpoint = process.env.TEAMAGENTX_SYSTEM_TOOLS_CALL_ENDPOINT;
const backgroundCommandStartEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_START_ENDPOINT;
const backgroundCommandReadEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_READ_ENDPOINT;
const backgroundCommandStopEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_STOP_ENDPOINT;
const backgroundCommandListEndpoint = process.env.TEAMAGENTX_BACKGROUND_COMMAND_LIST_ENDPOINT;
const token = process.env.TEAMAGENTX_INTERNAL_TOOL_TOKEN;
const sourceAgentId = process.env.TEAMAGENTX_SOURCE_AGENT_ID;
const chatRoomId = process.env.TEAMAGENTX_CHAT_ROOM_ID;
const workDir = process.env.TEAMAGENTX_WORK_DIR;

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

function stringifyPayload(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function callGenerateImage(args) {
  if (!generateImageEndpoint || !token || !sourceAgentId) {
    return toolResult("The current assistant does not have image generation enabled.", {}, true);
  }

  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  const n = Number.isInteger(args?.n) ? args.n : undefined;
  if (!prompt) {
    return toolResult("Parameter error: prompt is required.", {}, true);
  }
  if (n !== undefined && (n < 1 || n > 4)) {
    return toolResult("Parameter error: n must be between 1 and 4.", {}, true);
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
      return toolResult(payload.error || "Image generation failed.", payload, true);
    }
    const result = payload.data || payload;
    const urls = Array.isArray(result.urls) ? result.urls : [];
    const files = Array.isArray(result.files) ? result.files : [];
    return toolResult("Image generation succeeded: " + (urls.join(", ") || files.join(", ")), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Image generation failed.", {}, true);
  }
}

async function listSystemTools() {
  if (!systemToolsListEndpoint || !token || !sourceAgentId || !chatRoomId) return [];

  try {
    const response = await fetch(systemToolsListEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({ sourceAgentId, chatRoomId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) return [];
    return Array.isArray(payload.data?.tools) ? payload.data.tools : [];
  } catch {
    return [];
  }
}

async function callSystemTool(name, args) {
  if (!systemToolsCallEndpoint || !token || !sourceAgentId || !chatRoomId) {
    return toolResult("The current assistant has no available system tools.", {}, true);
  }

  try {
    const response = await fetch(systemToolsCallEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({ sourceAgentId, chatRoomId, name, args }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "Tool execution failed.", payload, true);
    }
    const result = payload.data ?? payload;
    return toolResult(stringifyPayload(result), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Tool execution failed.", {}, true);
  }
}

async function callBackgroundCommand(endpoint, args) {
  if (!endpoint || !token || !sourceAgentId || !chatRoomId) {
    return toolResult("Background command tools are not available.", {}, true);
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        sourceAgentId,
        chatRoomId,
        workDir,
        ...args,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      return toolResult(payload.error || "Background command operation failed.", payload, true);
    }
    const result = payload.data ?? payload;
    return toolResult(stringifyPayload(result), result, false);
  } catch (error) {
    return toolResult(error instanceof Error ? error.message : "Background command operation failed.", {}, true);
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
    const tools = [];
    if (generateImageEndpoint) {
      tools.push({
        name: "generate_image",
        description: "Generate images through the TeamAgentX server-controlled image model. API keys are used only on the server.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Detailed image prompt. Include subject, style, composition, colors, intended use, and other relevant details." },
            size: { type: "string", description: "Image size or aspect ratio, for example 1024x1024, 1024x1792, or 1:1." },
            n: { type: "number", description: "Number of images to generate. Default 1, maximum 4." },
            filename: { type: "string", description: "Optional filename. Do not include a path." },
            extraJson: { type: "object", description: "Provider-specific extra parameters." },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      });
    }
    if (backgroundCommandStartEndpoint) {
      tools.push({
        name: "start_background_command",
        description: "Start a long-running shell command in the TeamAgentX background task manager. Use this for dev servers, watch commands, tail -f, and services that should keep running after this turn.",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run in the current working directory." },
          },
          required: ["command"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "read_background_command_output",
        description: "Read the latest stdout and stderr from a background command started with start_background_command.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Background task ID returned by start_background_command." },
            tailBytes: { type: "number", description: "Maximum bytes to read from the end of each output stream. Default 12288." },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "stop_background_command",
        description: "Stop a running background command by task ID.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Background task ID returned by start_background_command." },
          },
          required: ["taskId"],
          additionalProperties: false,
        },
      });
      tools.push({
        name: "list_background_commands",
        description: "List recent background commands started by this assistant in this chatroom.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      });
    }
    const systemTools = await listSystemTools();
    for (const systemTool of systemTools) {
      if (!systemTool?.name || tools.some((tool) => tool.name === systemTool.name)) continue;
      tools.push({
        name: systemTool.name,
        description: systemTool.description || systemTool.name,
        inputSchema: systemTool.inputSchema || { type: "object", additionalProperties: true },
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
    if (name === "generate_image") {
      const result = await callGenerateImage(args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "start_background_command") {
      const result = await callBackgroundCommand(backgroundCommandStartEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "read_background_command_output") {
      const result = await callBackgroundCommand(backgroundCommandReadEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "stop_background_command") {
      const result = await callBackgroundCommand(backgroundCommandStopEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    if (name === "list_background_commands") {
      const result = await callBackgroundCommand(backgroundCommandListEndpoint, args);
      write({ jsonrpc: "2.0", id, result });
      return;
    }
    const result = await callSystemTool(name, args);
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
    if (this.stateless) return;

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

  private resetThreadState(reason: string, details: Record<string, unknown> = {}): void {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    this.thread = null;
    this.threadId = null;
    this.lastInjectedSkillsSignature = undefined;
    this.saveThreadId();
    debugLog('codexSdkThreadReset', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      reason,
      ...details,
    });
  }

  private findThreadSessionPath(threadId: string): string | undefined {
    const sessionsDir = path.join(this.getCodexHome(), 'sessions');
    if (!fs.existsSync(sessionsDir)) return undefined;

    const stack = [sessionsDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name.includes(threadId) && entry.name.endsWith('.jsonl')) {
          return fullPath;
        }
      }
    }

    return undefined;
  }

  private getThreadSessionStats(threadId: string): { path?: string; bytes: number; turns: number } {
    const sessionPath = this.findThreadSessionPath(threadId);
    if (!sessionPath) return { bytes: 0, turns: 0 };

    try {
      const text = fs.readFileSync(sessionPath, 'utf-8');
      const turns = (text.match(/"type":"turn_context"/g) || []).length;
      return {
        path: sessionPath,
        bytes: Buffer.byteLength(text),
        turns,
      };
    } catch {
      return { path: sessionPath, bytes: 0, turns: 0 };
    }
  }

  private resetOvergrownThreadIfNeeded(): void {
    if (!this.threadId) return;

    const maxTurns = getPositiveIntegerEnv('CODEX_SDK_MAX_THREAD_TURNS', DEFAULT_CODEX_SDK_MAX_THREAD_TURNS);
    const maxBytes = getPositiveIntegerEnv('CODEX_SDK_MAX_SESSION_BYTES', DEFAULT_CODEX_SDK_MAX_SESSION_BYTES);
    if (maxTurns === 0 && maxBytes === 0) return;

    const stats = this.getThreadSessionStats(this.threadId);
    const exceedsTurns = maxTurns > 0 && stats.turns >= maxTurns;
    const exceedsBytes = maxBytes > 0 && stats.bytes >= maxBytes;
    if (!exceedsTurns && !exceedsBytes) return;

    this.resetThreadState('sessionLimitExceeded', {
      previousThreadId: this.threadId,
      sessionPath: stats.path,
      sessionTurns: stats.turns,
      sessionBytes: stats.bytes,
      maxTurns,
      maxBytes,
    });
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
    const responseStyleInstruction =
      'Write the final answer in human-readable Markdown. Do not explain the internal steps, context assembly, or tools used unless the user explicitly asks for that.';

    if (this.systemPrompt) {
      fullMessage += `[System Instructions]\n${this.systemPrompt}\n\n${responseStyleInstruction}\n\n`;
    } else {
      fullMessage += `[System Instructions]\n${responseStyleInstruction}\n\n`;
    }

    const longTermMemorySection = buildAgentLongTermMemorySection(this.chatRoomId, this.agentId, this.name);
    if (longTermMemorySection) {
      fullMessage += `${longTermMemorySection}\n\n`;
    }

    const skillsUpdateSection = this.buildSkillsUpdateSection();
    if (skillsUpdateSection) {
      fullMessage += `${skillsUpdateSection}\n\n`;
    }

    if (this.injectGroupHistory) {
      const messageIndexSection = buildRoomMessageIndexSection(history);
      if (messageIndexSection) {
        fullMessage += `${messageIndexSection}\n\n`;
      }

      fullMessage += `[Group History Access]
You may access current chatroom history through tools. Use \`get_recent_room_messages\` for recent context, \`search_room_messages\` to search messages by keyword, or \`get_room_message_detail\` to inspect exact message content by messageId. These tools automatically use the current chatroom; do not ask for or provide a chatRoomId. If the current request depends on prior discussion, use these tools instead of guessing from previews or memory.

`;
    }

    if (this.chatRoomAgents.length > 0) {
      const agentsInfo = this.chatRoomAgents.map((agent) => agent.name).join(', ');
      const otherAgents = this.chatRoomAgents.filter((agent) => agent.name !== this.name);
      const otherAgentsList = otherAgents.map((agent) => agent.name).join(', ');
      const othersInfo = otherAgents.length > 0 ? otherAgentsList : 'none';
      const mentionTip = otherAgents.length > 0
        ? '\n[Tip]\nWhen you need to message another assistant, write "@assistant_name message content" directly in your final reply. You may also mention an assistant in body text when the @ is preceded by a space. A target assistant is triggered only when @ is at the start of a line or the previous character is a space; @ immediately after punctuation will not trigger. A single message may contain at most one triggerable @assistant mention. If you need to refer to additional assistants, write their names without @. If the user only asks you to send a message to another assistant, output only that @assistant message in the final reply, with no explanation, pleasantries, summary, or expanded collaboration invitation.'
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
    if (this.stateless) {
      return `[Installed Skills Update]
${buildInstalledSkillsInstructions(this.agentId)}`;
    }

    const currentSignature = buildInstalledSkillsSignature(this.agentId);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }

    this.lastInjectedSkillsSignature = currentSignature;
    if (this.threadId) {
      this.saveThreadId();
    }
    return `[Installed Skills Update]
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
    const generateImageEndpoint = this.imageGenerationProvider
      ? `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/generate-image`
      : undefined;
    const systemToolsListEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/system-tools/list`;
    const systemToolsCallEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/system-tools/call`;
    const backgroundCommandStartEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/start`;
    const backgroundCommandReadEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/read`;
    const backgroundCommandStopEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/stop`;
    const backgroundCommandListEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/list`;
    const builtinMcpServers = buildBuiltinCodexMcpServerConfigs({
      workDir: this.workDir,
      teamAgentXMcpServerPath: mcpServerPath,
      chatRoomId: this.chatRoomId,
      agentId: this.agentId || undefined,
      agentName: this.name,
      chatRoomAgents: this.chatRoomAgents,
      generateImageEndpoint,
      systemToolsListEndpoint,
      systemToolsCallEndpoint,
      backgroundCommandStartEndpoint,
      backgroundCommandReadEndpoint,
      backgroundCommandStopEndpoint,
      backgroundCommandListEndpoint,
    });
    const config = {
      hide_agent_reasoning: this.thinkingMode === 'off',
      show_raw_agent_reasoning: this.thinkingMode !== 'off',
      model_reasoning_effort: getCodexReasoningEffort(this.thinkingMode),
      model_reasoning_summary: 'concise',
      ...(this.codexFastMode ? { service_tier: 'fast' } : {}),
      skills: {
        include_instructions: false,
      },
      mcp_servers: builtinMcpServers,
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
    if (this.thread) return this.thread;

    const runner = this.getCodexRunner();
    const options = {
      model: this.llmProvider?.model || this.codexModel || undefined,
      workingDirectory: this.workDir,
      skipGitRepoCheck: true,
      sandboxMode: 'danger-full-access' as const,
      approvalPolicy: 'never' as const,
      networkAccessEnabled: true,
    };

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
        if (!this.stateless) this.saveThreadId();
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
    this.lastInjectedSkillsSignature = undefined;
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

    if (this.stateless) {
      this.thread = null;
      this.threadId = null;
    } else {
      this.resetOvergrownThreadIfNeeded();
    }
    this.lastContext = this.buildFullMessage(message, history);
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const abort = () => abortController.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let tokenUsage: TokenUsage | undefined;
    const { input, cleanup } = this.writeAttachments(attachments);
    const execStartTime = Date.now();
    let firstEventLogged = false;
    let firstVisibleOutputLogged = false;

    try {
      if (signal?.aborted) {
        throw new DOMException('执行已被用户中断', 'AbortError');
      }

      debugLog('codexSdkExecStart', {
        agentName: this.name,
        agentId: this.agentId,
        chatRoomId: this.chatRoomId,
        messageId: originalMessageId,
        threadId: this.threadId,
        contextLength: this.lastContext.length,
      });

      const thread = this.getThread();
      const { events } = await thread.runStreamed(input, { signal: abortController.signal });

      for await (const event of events) {
        if (signal?.aborted) {
          throw new DOMException('执行已被用户中断', 'AbortError');
        }
        if (!firstEventLogged) {
          firstEventLogged = true;
          debugLog('codexSdkFirstEvent', {
            agentName: this.name,
            agentId: this.agentId,
            chatRoomId: this.chatRoomId,
            messageId: originalMessageId,
            eventType: event.type,
            elapsedMs: Date.now() - execStartTime,
          });
        }
        const usage = this.handleEvent(event);
        if (usage) tokenUsage = usage;
        if (!firstVisibleOutputLogged && (this.content || this.thinking || this.toolCalls.length > 0)) {
          firstVisibleOutputLogged = true;
          debugLog('codexSdkFirstVisibleOutput', {
            agentName: this.name,
            agentId: this.agentId,
            chatRoomId: this.chatRoomId,
            messageId: originalMessageId,
            eventType: event.type,
            elapsedMs: Date.now() - execStartTime,
            hasContent: !!this.content,
            hasThinking: !!this.thinking,
            toolCallCount: this.toolCalls.length,
          });
        }
      }

      if (thread.id && thread.id !== this.threadId) {
        this.threadId = thread.id;
        if (!this.stateless) this.saveThreadId();
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
      if (this.stateless) {
        this.thread = null;
        this.threadId = null;
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
