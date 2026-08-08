import type {
  AssistantMessage,
  Config,
  Event,
  McpLocalConfig,
  McpRemoteConfig,
  Session,
  ToolPart,
} from '@opencode-ai/sdk';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { config as appConfig } from '../../config/index.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';
import { agentMemoryService } from '../../modules/agent-memory/agent-memory.service.js';
import { buildRoomMessageIndexSection } from '../../modules/message/room-message-index.service.js';
import type { AttachmentData } from '../../modules/task-queue/task-queue.service.js';
import { buildAgentLongTermMemoryContentSection } from './agent-long-term-memory.js';
import { sanitizeAgentChildEnv } from './agent-child-env.js';
import {
  buildAgentBaseSystemPrompt,
  buildGroupChatMemberInfoSection,
  buildHandoffTurnReminder,
  buildNoAssistantHandoffTurnReminder,
  getOpencodeBackgroundCommandsSection,
  getResponseStyleInstruction,
} from './agent-system-prompt.js';
import { normalizeLocale, pickLocaleText, type Locale } from './agent-handler/locale.js';
import { debugLog } from './agent-handler/debug.js';
import { buildShellEnvFromRoomEnvVars, type RoomEnvVar } from './room-env-vars.js';
import { getInternalAgentToolToken } from './agent-handler/internal-agent-tool-auth.js';
import { buildAcpProviderEnv } from './acp-provider.adapter.js';
import { parseProxyConfigEnv } from './proxy-config.js';
import { resolveAgentWorkDir } from './work-dir.js';
import {
  buildInstalledSkillsInstructions,
  buildInstalledSkillsSignature,
} from './skill-instructions.js';
import {
  DEFAULT_AGENT_THINKING_MODE,
  type AgentThinkingMode,
} from './thinking-mode.js';
import { GROUP_COORDINATOR_ID } from './system-assistant.constants.js';
import { getContextResetCommand } from './context-reset-command.js';
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
import { getAgentConnectors } from './connector.adapter.js';
import { writeTeamAgentXMcpServerFile } from './teamagentx-mcp-server.js';
import type { LlmProvider } from '@prisma/client';

const OPENCODE_AGENT_NAME = 'teamagentx';
const OPENCODE_AGENT_NAME_NO_HANDOFF = 'teamagentx-no-handoff';
const OPENCODE_SDK_STATE_VERSION = 1;
const OPENCODE_SDK_MAX_WAIT_IDLE_MS = 15_000;
const TEAMAGENTX_LLM_API_KEY_ENV = 'TEAMAGENTX_LLM_API_KEY';
const moduleRequire = createRequire(import.meta.url);

const OPENCODE_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': 'opencode-linux-x64-musl',
  'aarch64-unknown-linux-musl': 'opencode-linux-arm64-musl',
  'x86_64-apple-darwin': 'opencode-darwin-x64',
  'aarch64-apple-darwin': 'opencode-darwin-arm64',
  'x86_64-pc-windows-msvc': 'opencode-windows-x64',
  'aarch64-pc-windows-msvc': 'opencode-windows-arm64',
};

function attachmentExtension(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.jpg';
}

function getOpencodeTargetTriple(): string {
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

/**
 * 查找可 spawn 的 opencode 二进制：
 * 1. 宿主机 PATH（与用户终端行为一致）
 * 2. TOOLS_DIR 内的 opencode-ai 包（bin/opencode.exe 是平台二进制拷贝）
 * 3. TOOLS_DIR 内的平台包（opencode-darwin-arm64/bin/opencode）
 */
function findSpawnableOpencodeBinary(): string | undefined {
  const isWindows = process.platform === 'win32';
  const extension = isWindows ? '.exe' : '';

  const fromHostPath = findExecutableOnPath('opencode');
  if (fromHostPath) return fromHostPath;

  const toolsDir = process.env.TOOLS_DIR;
  if (toolsDir) {
    const packageRoot = path.join(toolsDir, 'node_modules');
    const candidates: string[] = [
      path.join(packageRoot, 'opencode-ai', 'bin', 'opencode.exe'),
      path.join(packageRoot, '.bin', `opencode${extension}`),
    ];

    const platformPackage = OPENCODE_PLATFORM_PACKAGE_BY_TARGET[getOpencodeTargetTriple()];
    if (platformPackage) {
      candidates.push(
        path.join(packageRoot, platformPackage, 'bin', `opencode${extension}`),
        path.join(packageRoot, platformPackage, 'bin', 'opencode.exe'),
      );
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // 继续尝试下一个候选路径
      }
    }
  }

  // 最后回退：应用自身 node_modules 内嵌的 opencode-ai（桌面打包时通常被排除）
  try {
    const packageJsonPath = moduleRequire.resolve('opencode-ai/package.json');
    const binaryPath = path.join(path.dirname(packageJsonPath), 'bin', 'opencode.exe');
    if (fs.existsSync(binaryPath) && fs.statSync(binaryPath).size > 1024 * 1024) {
      return binaryPath;
    }
  } catch {
    // 应用未内嵌 opencode-ai，走宿主机 CLI
  }
  return undefined;
}

/** 宿主机 PATH 中是否有可直接运行的 opencode CLI（供安装状态检测复用）。 */
export function findHostPathOpencodeBinary(): string | undefined {
  return findExecutableOnPath('opencode');
}

async function findFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 40000);
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    if (available) return port;
  }
  return 20000 + Math.floor(Math.random() * 40000);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function getOpencodeReasoningEffort(thinkingMode?: AgentThinkingMode | null): string | undefined {
  if (thinkingMode === 'off' || thinkingMode === 'none') return 'none';
  const supported = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  if (thinkingMode && supported.includes(thinkingMode)) return thinkingMode;
  return undefined;
}

interface OpencodeServerHandle {
  url: string;
  close: () => void;
}

/**
 * Opencode ACP 执行器：通过 @opencode-ai/sdk 驱动宿主机 opencode CLI。
 *
 * 与 CodexSdkExecutor 对齐：每个（群聊, 助手）组合持有一个常驻 opencode
 * server（懒启动），会话 ID 持久化在 agent 私有目录；每轮通过
 * session.prompt 发送消息并从事件流中消费文本/思考/工具调用。
 */
export class OpencodeSdkExecutor implements IAgentExecutor {
  readonly name: string;
  readonly chatRoomId: string;
  readonly injectGroupHistory: boolean;
  readonly workDir: string;
  readonly agentWorkDir: string | null;
  readonly chatRoomAgents: ChatRoomAgentInfo[];
  readonly llmProvider?: LlmProvider;
  readonly imageGenerationProvider?: LlmProvider | null;
  readonly proxyConfig: string | null;
  readonly thinkingMode: AgentThinkingMode;
  readonly stateless: boolean;
  readonly roomEnvVars: RoomEnvVar[];

  private _lastInjectedMessageId?: string;
  private agentId: string | null = null;
  private agentTriggerMode?: AgentTriggerMode;
  private locale: Locale = 'zh-CN';
  private sessionId: string | null = null;
  private lastInjectedSkillsSignature?: string;
  private lastMcpToolsSignature?: string;
  private connectorMcpServers: Record<string, McpLocalConfig | McpRemoteConfig> = {};

  private serverHandle: OpencodeServerHandle | null = null;
  private client: ReturnType<typeof createOpencodeClient> | null = null;

  private content = '';
  private thinking = '';
  private toolCalls: ToolCall[] = [];
  private toolCalledSinceContent = false;
  private userMessageIds = new Set<string>();
  private currentAbortController: AbortController | null = null;

  private lastContext: string | null = null;
  private lastResponse: string | null = null;
  private lastInvokeResult: string | null = null;
  private lastTokenUsage: TokenUsage | undefined;
  private lastModel: string | null = null;

  private emitStream: StreamEmitCallback | null = null;
  private emitThinking: ThinkingEmitCallback | null = null;
  private emitToolCall: ToolCallEmitCallback | null = null;
  private emitRecord: RecordEmitCallback | null = null;

  private chatRoomRules?: string;
  private agentPrompt: string;
  private systemPrompt: string;

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
    agentTriggerMode?: AgentTriggerMode,
    roomEnvVars: RoomEnvVar[] = [],
    locale?: string,
  ) {
    this.name = name;
    this.agentPrompt = systemPrompt;
    this.chatRoomRules = chatRoomRules;
    this.chatRoomId = chatRoomId;
    this.injectGroupHistory = injectGroupHistory;
    this.agentId = agentId || null;
    this.agentWorkDir = workDir || null;
    this._lastInjectedMessageId = lastInjectedMessageId;
    this.chatRoomAgents = chatRoomAgents || [];
    this.llmProvider = llmProvider;
    this.imageGenerationProvider = imageGenerationProvider;
    this.proxyConfig = proxyConfig || null;
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

    this.ensureWorkDirectory();
    this.sessionId = this.stateless ? null : this.loadSessionId();
    this.lastInjectedSkillsSignature = this.stateless ? undefined : this.loadSkillsSignature();
    this.lastMcpToolsSignature = this.stateless ? undefined : this.loadMcpToolsSignature();
    this.systemPrompt = this.buildDeveloperInstructions(false);
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
      type: 'opencode',
      sessionId: this.sessionId,
    };
  }

  applySessionSnapshot(snapshot: AgentSessionSnapshot): boolean {
    if (this.stateless || snapshot.type !== 'opencode') return false;
    if (!snapshot.sessionId) return false;
    this.sessionId = snapshot.sessionId;
    this.saveSessionState();
    debugLog('opencodeSdkAppliedFallbackSessionSnapshot', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      sessionId: this.sessionId,
    });
    return true;
  }

  private ensureWorkDirectory(): void {
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
  }

  private getOpencodeHome(): string {
    return path.join(os.homedir(), '.teamagentx', 'acp-config', this.agentId || 'default', 'opencode');
  }

  private getSessionStatePath(): string {
    const scope = createHash('sha256')
      .update(`${this.chatRoomId}:${this.workDir}`)
      .digest('hex')
      .slice(0, 16);
    return path.join(this.getOpencodeHome(), `teamagentx-opencode-sdk-session-${scope}.json`);
  }

  private loadSessionId(): string | null {
    try {
      const statePath = this.getSessionStatePath();
      if (!fs.existsSync(statePath)) return null;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      if (state.version !== OPENCODE_SDK_STATE_VERSION) {
        fs.rmSync(statePath, { force: true });
        return null;
      }
      return typeof state.sessionId === 'string' ? state.sessionId : null;
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

  private loadMcpToolsSignature(): string | undefined {
    try {
      const statePath = this.getSessionStatePath();
      if (!fs.existsSync(statePath)) return undefined;
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      return typeof state.mcpToolsSignature === 'string' ? state.mcpToolsSignature : undefined;
    } catch {
      return undefined;
    }
  }

  private saveSessionState(): void {
    if (this.stateless) return;
    try {
      const statePath = this.getSessionStatePath();
      if (!this.sessionId) {
        fs.rmSync(statePath, { force: true });
        return;
      }
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(
        statePath,
        JSON.stringify(
          {
            version: OPENCODE_SDK_STATE_VERSION,
            sessionId: this.sessionId,
            skillsSignature: this.lastInjectedSkillsSignature,
            mcpToolsSignature: this.lastMcpToolsSignature,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch (error) {
      console.warn(`${this.name}: 保存 Opencode sessionId 失败:`, error);
    }
  }

  private resetSessionState(reason: string, details: Record<string, unknown> = {}): void {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    this.sessionId = null;
    this.lastInjectedSkillsSignature = undefined;
    this.lastMcpToolsSignature = undefined;
    this.saveSessionState();
    debugLog('opencodeSdkSessionReset', {
      agentName: this.name,
      agentId: this.agentId,
      chatRoomId: this.chatRoomId,
      reason,
      ...details,
    });
  }

  private buildDeveloperInstructions(suppressAssistantHandoff = false): string {
    return [
      buildAgentBaseSystemPrompt({
        agentPrompt: this.agentPrompt,
        llmProvider: this.llmProvider,
        imageGenerationProvider: this.imageGenerationProvider,
        chatRoomRules: this.chatRoomRules,
        workDir: this.workDir,
        agentTriggerMode: this.agentTriggerMode,
        commandSection: getOpencodeBackgroundCommandsSection(this.locale),
        roomEnvVars: this.roomEnvVars,
        locale: this.locale,
        includeAssistantHandoffRules: !suppressAssistantHandoff,
      }),
      buildGroupChatMemberInfoSection({
        chatRoomAgents: this.chatRoomAgents,
        agentName: this.name,
        workDir: this.workDir,
        includeAssistantHandoffGuidance: !suppressAssistantHandoff && this.agentTriggerMode !== 'manual',
        locale: this.locale,
      }),
      getResponseStyleInstruction(this.locale),
    ]
      .filter((section) => section.trim().length > 0)
      .join('\n\n');
  }


  private buildFullMessage(
    message: string,
    history?: HistoryMessage[],
    suppressAssistantHandoff = false,
  ): string {
    let fullMessage = '';

    const longTermMemorySection = buildAgentLongTermMemoryContentSection(this.agentId, this.name);
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
      fullMessage += pickLocaleText(
        {
          'zh-CN': `[群历史访问]
你可以通过 MCP 工具访问当前群聊历史。用 \`get_recent_room_messages\` 获取消息索引，\`search_room_messages\` 按关键词搜索索引，\`get_room_message_detail\` 按 messageId 查看精确消息内容。这些工具自动作用于当前群聊；不要索取或提供 chatRoomId。每次最多获取 50 条消息索引；用 \`skip\` 分页，\`order\` 取 \`asc\` 或 \`desc\` 控制时间方向。最近/搜索结果只是导航预览，所以在依赖精确历史内容前先调用 \`get_room_message_detail\`。`,
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

  private buildSkillsUpdateSection(): string {
    if (this.stateless) {
      return `[Installed Skills Update]\n${buildInstalledSkillsInstructions(this.agentId)}`;
    }
    const currentSignature = buildInstalledSkillsSignature(this.agentId);
    if (this.lastInjectedSkillsSignature === currentSignature) {
      return '';
    }
    this.lastInjectedSkillsSignature = currentSignature;
    if (this.sessionId) {
      this.saveSessionState();
    }
    return `[Installed Skills Update]\n${buildInstalledSkillsInstructions(this.agentId)}`;
  }

  private getTeamAgentXMcpServerPath(): string {
    return path.join(this.getOpencodeHome(), 'teamagentx-agent-tools-mcp.mjs');
  }

  private buildBuiltinMcpServers(): Record<string, McpLocalConfig> {
    const mcpServerPath = writeTeamAgentXMcpServerFile(this.getTeamAgentXMcpServerPath());
    const generateImageEndpoint = this.imageGenerationProvider
      ? `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/generate-image`
      : undefined;
    const systemToolsListEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/system-tools/list`;
    const systemToolsCallEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/system-tools/call`;
    const backgroundCommandStartEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/start`;
    const backgroundCommandReadEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/read`;
    const backgroundCommandStopEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/stop`;
    const backgroundCommandListEndpoint = `http://127.0.0.1:${appConfig.server.port}/internal/agent-tools/background-command/list`;
    const roomHistoryToolsEnabled = this.injectGroupHistory;

    const environment: Record<string, string> = {
      TEAMAGENTX_CHAT_ROOM_ID: this.chatRoomId,
      TEAMAGENTX_SOURCE_AGENT_ID: this.agentId || '',
      TEAMAGENTX_WORK_DIR: this.workDir,
      TEAMAGENTX_GENERATE_IMAGE_ENDPOINT: generateImageEndpoint || '',
      TEAMAGENTX_SYSTEM_TOOLS_LIST_ENDPOINT: systemToolsListEndpoint,
      TEAMAGENTX_SYSTEM_TOOLS_CALL_ENDPOINT: systemToolsCallEndpoint,
      TEAMAGENTX_BACKGROUND_COMMAND_START_ENDPOINT: backgroundCommandStartEndpoint,
      TEAMAGENTX_BACKGROUND_COMMAND_READ_ENDPOINT: backgroundCommandReadEndpoint,
      TEAMAGENTX_BACKGROUND_COMMAND_STOP_ENDPOINT: backgroundCommandStopEndpoint,
      TEAMAGENTX_BACKGROUND_COMMAND_LIST_ENDPOINT: backgroundCommandListEndpoint,
      TEAMAGENTX_ROOM_HISTORY_TOOLS_ENABLED: roomHistoryToolsEnabled ? '1' : '',
      TEAMAGENTX_MENTION_AGENTS_FALLBACK_ENABLED:
        this.agentId && this.agentId !== GROUP_COORDINATOR_ID && this.agentTriggerMode !== 'manual'
          ? '1'
          : '',
      TEAMAGENTX_INTERNAL_TOOL_TOKEN: getInternalAgentToolToken(),
    };
    if (Boolean(process.versions.electron)) {
      environment.ELECTRON_RUN_AS_NODE = '1';
    }

    const servers: Record<string, McpLocalConfig> = {};
    servers.teamagentx = {
      type: 'local',
      command: [process.execPath, mcpServerPath],
      environment,
      enabled: true,
    };

    const gitnexusCommand = findExecutableOnPath('gitnexus');
    if (gitnexusCommand) {
      let dir = path.resolve(this.workDir);
      while (true) {
        if (fs.existsSync(path.join(dir, '.gitnexus'))) break;
        const parent = path.dirname(dir);
        if (parent === dir) {
          dir = '';
          break;
        }
        dir = parent;
      }
      if (dir) {
        servers.gitnexus = {
          type: 'local',
          command: [gitnexusCommand, 'mcp'],
          enabled: true,
        };
      }
    }
    return servers;
  }

  private buildMcpToolsSignature(): string {
    const mcpServerPath = this.getTeamAgentXMcpServerPath();
    const mcpServerScriptHash = fs.existsSync(mcpServerPath)
      ? createHash('sha256').update(fs.readFileSync(mcpServerPath)).digest('hex')
      : null;
    const builtinMcpServers = this.buildBuiltinMcpServers();
    const roomAgents = this.chatRoomAgents
      .map((agent) => ({
        agentId: agent.agentId,
        name: agent.name,
        workDir: agent.workDir || null,
        customWorkDir: agent.customWorkDir || null,
      }))
      .sort((a, b) => `${a.agentId}:${a.name}`.localeCompare(`${b.agentId}:${b.name}`));

    return createHash('sha256')
      .update(
        stableStringify({
          version: 1,
          agentId: this.agentId,
          chatRoomId: this.chatRoomId,
          workDir: this.workDir,
          injectGroupHistory: this.injectGroupHistory,
          imageGenerationProviderId: this.imageGenerationProvider?.id || null,
          builtinMcpServers,
          connectorMcpServers: this.connectorMcpServers,
          roomAgents,
          mcpServerScriptHash,
        }),
      )
      .digest('hex');
  }

  private providerModelRef: { providerID: string; modelID: string } | null = null;

  private buildProviderConfig(): {
    provider: Record<string, unknown>;
    model: string;
    modelRef: { providerID: string; modelID: string };
  } | null {
    const provider = this.llmProvider;
    if (!provider) return null;
    const protocol = ((provider as { apiProtocol?: string }).apiProtocol || 'openai').toLowerCase();
    const providerId = `teamagentx-${createHash('sha256').update(provider.id).digest('hex').slice(0, 12)}`;
    const model = provider.model || 'default';

    let baseUrl = provider.apiUrl?.trim().replace(/\/+$/, '') || undefined;
    // 兼容「完整端点」写法：apiUrl 直接以 /chat/completions 结尾时，去掉该后缀
    // 得到 API 根路径（AI SDK 会在 baseURL 后自行拼接 /chat/completions）。
    if (baseUrl && /\/chat\/completions$/i.test(baseUrl)) {
      baseUrl = baseUrl.replace(/\/chat\/completions$/i, '');
    }
    // AI SDK 在 baseURL 后直接拼接请求路径（openai-compatible 拼 /chat/completions，
    // anthropic 拼 /messages），因此 baseURL 必须是「API 根路径」：官方与主流网关
    // （百炼/OpenRouter/中转站）都以 /v1 结尾，这里对两种协议统一补全。
    if (baseUrl && !/\/v1$/.test(baseUrl)) {
      baseUrl = `${baseUrl}/v1`;
    }

    const modelOptions: Record<string, unknown> = {};
    const reasoningEffort = getOpencodeReasoningEffort(this.thinkingMode);
    if (protocol === 'openai' && reasoningEffort) {
      modelOptions.reasoningEffort = reasoningEffort;
    }

    return {
      provider: {
        [providerId]: {
          name: provider.name || 'TeamAgentX Provider',
          npm: protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
          options: {
            ...(baseUrl ? { baseURL: baseUrl } : {}),
            apiKey: `{env:${TEAMAGENTX_LLM_API_KEY_ENV}}`,
          },
          models: {
            [model]: {
              name: model,
              ...(Object.keys(modelOptions).length > 0 ? { options: modelOptions } : {}),
            },
          },
        },
      },
      model: `${providerId}/${model}`,
      modelRef: { providerID: providerId, modelID: model },
    };
  }

  private buildConfig(): Config {
    const config: Config = {
      logLevel: 'ERROR',
      agent: {
        [OPENCODE_AGENT_NAME]: {
          mode: 'primary',
          prompt: this.buildDeveloperInstructions(false),
          permission: {
            edit: 'allow',
            bash: 'allow',
            webfetch: 'allow',
            external_directory: 'allow',
          },
        },
        [OPENCODE_AGENT_NAME_NO_HANDOFF]: {
          mode: 'primary',
          prompt: this.buildDeveloperInstructions(true),
          permission: {
            edit: 'allow',
            bash: 'allow',
            webfetch: 'allow',
            external_directory: 'allow',
          },
        },
      },
      mcp: {
        ...this.buildBuiltinMcpServers(),
        ...this.connectorMcpServers,
      },
    };

    const providerConfig = this.buildProviderConfig();
    if (providerConfig) {
      config.provider = providerConfig.provider as Config['provider'];
      config.model = providerConfig.model;
      this.providerModelRef = providerConfig.modelRef;
    }
    return config;
  }

  private buildEnv(): Record<string, string> {
    const cleanEnv = sanitizeAgentChildEnv(process.env);
    if (this.llmProvider) {
      const keysToClear = [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_API_URL',
        'ANTHROPIC_MODEL',
        'OPENAI_API_KEY',
        'OPENAI_BASE_URL',
        'OPENAI_API_BASE',
        'OPENAI_MODEL',
      ];
      keysToClear.forEach((key) => delete cleanEnv[key]);
    }

    let providerEnv: Record<string, string> = {};
    if (this.llmProvider) {
      providerEnv = buildAcpProviderEnv('opencode', this.llmProvider, this.agentId);
    }

    const baseEnv: Record<string, string> = {
      ...cleanEnv,
      ...providerEnv,
      ...parseProxyConfigEnv(this.proxyConfig),
      OPENCODE_SERVER_PASSWORD: getInternalAgentToolToken(),
    };
    if (this.llmProvider?.apiKey) {
      baseEnv[TEAMAGENTX_LLM_API_KEY_ENV] = this.llmProvider.apiKey;
    }
    const { env } = buildShellEnvFromRoomEnvVars(baseEnv, this.roomEnvVars);
    return env;
  }

  private async ensureServerAndClient(): Promise<ReturnType<typeof createOpencodeClient>> {
    if (this.serverHandle && this.client) return this.client;

    const binaryPath = findSpawnableOpencodeBinary();
    if (!binaryPath) {
      throw new Error(
        '未找到 opencode CLI。请先在系统 PATH 安装 opencode（https://opencode.ai/install），或在设置中安装 opencode-ai SDK。',
      );
    }

    const port = await findFreePort();
    const env = this.buildEnv();
    const config = this.buildConfig();


    const child = spawn(
      binaryPath,
      ['serve', `--hostname=127.0.0.1`, `--port=${port}`, '--log-level=ERROR'],
      {
        env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          try {
            child.kill('SIGKILL');
          } catch {
            // 忽略
          }
          reject(new Error(`Opencode server 启动超时（${binaryPath}）`));
        }
      }, 15_000);

      const onData = (chunk: Buffer) => {
        if (resolved) return;
        output += chunk.toString();
        const match = output.match(/opencode server listening on\s+(https?:\/\/[^\s]+)/);
        if (match?.[1]) {
          resolved = true;
          clearTimeout(timeout);
          resolve(match[1]);
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('exit', (code) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(
            new Error(`Opencode server 退出（code ${code ?? 1}）:\n${output.slice(-2000)}`),
          );
        }
      });
      child.once('error', (error) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });

    this.serverHandle = {
      url,
      close: () => {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // 进程已退出
            }
          }, 2000).unref();
        } catch {
          // 忽略清理失败
        }
      },
    };

    const serverPassword = getInternalAgentToolToken();
    this.client = createOpencodeClient({
      baseUrl: url,
      headers: {
        Authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString('base64')}`,
      },
    });
    return this.client;
  }

  private async ensureSession(): Promise<Session> {
    const client = await this.ensureServerAndClient();
    if (this.sessionId) {
      try {
        const existing = await client.session.get({
          path: { id: this.sessionId },
          query: { directory: this.workDir },
        });
        if (existing.data?.id) {
          return existing.data;
        }
      } catch {
        // 会话已失效（服务器重启 / 数据清理），回退新建
        debugLog('opencodeSdkSessionGone', {
          agentName: this.name,
          sessionId: this.sessionId,
        });
      }
    }
    const created = await client.session.create({ query: { directory: this.workDir } });
    if (!created.data) {
      throw new Error('opencode 会话创建失败');
    }
    this.sessionId = created.data?.id || null;
    if (this.sessionId) {
      this.saveSessionState();
    }
    return created.data;
  }

  private resetCollectors(): void {
    this.content = '';
    this.thinking = '';
    this.toolCalls = [];
    this.toolCalledSinceContent = false;
    this.userMessageIds.clear();
  }

  private async writeAttachments(
    attachments?: AttachmentData[],
  ): Promise<{ parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; filename?: string; url: string }>; cleanup: () => void }> {
    if (!attachments || attachments.length === 0) {
      return { parts: [{ type: 'text', text: this.lastContext || '' }], cleanup: () => undefined };
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-opencode-images-'));
    const parts: Array<{ type: 'text'; text: string } | { type: 'file'; mime: string; filename?: string; url: string }> = [
      { type: 'text', text: this.lastContext || '' },
    ];
    attachments.forEach((attachment, index) => {
      const filePath = path.join(tempDir, `attachment-${index}${attachmentExtension(attachment.mimeType)}`);
      fs.writeFileSync(filePath, Buffer.from(attachment.base64, 'base64'));
      parts.push({
        type: 'file',
        mime: attachment.mimeType || 'image/jpeg',
        filename: attachment.filename || path.basename(filePath),
        url: pathToFileURL(filePath).href,
      });
    });
    return {
      parts,
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // 忽略临时文件清理失败
        }
      },
    };
  }

  private upsertToolCall(toolCall: ToolCall): void {
    if (!this.toolCalledSinceContent && this.content.trim()) {
      this.emitRecord?.(this.content);
    }
    this.toolCalledSinceContent = true;
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

  private appendThinking(raw: unknown): void {
    const text = coerceThinkingText(raw);
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

  private handleToolPart(part: ToolPart): void {
    const state = part.state;
    let status: ToolCall['status'] = 'in_progress';
    if (state.status === 'completed') status = 'completed';
    if (state.status === 'error') status = 'error';
    this.upsertToolCall({
      name: part.tool,
      input: state.input || {},
      toolCallId: part.callID || part.id,
      status,
      output: state.status === 'completed' || state.status === 'error' ? (state as { output?: string; error?: string }).output ?? (state as { error?: string }).error : undefined,
      timestamp: Date.now(),
    });
  }

  private handleEvent(event: Event): void {
    if (event.type === 'message.part.updated') {
      const part = event.properties.part;
      if (!part || this.userMessageIds.has(part.messageID)) return;
      if (part.type === 'text') {
        this.appendContent(part.text);
      } else if (part.type === 'reasoning') {
        this.appendThinking(part.text);
      } else if (part.type === 'tool') {
        this.handleToolPart(part);
      }
      return;
    }
    if (event.type === 'message.updated') {
      const info = event.properties.info;
      if (!info) return;
      if (info.role === 'user') {
        this.userMessageIds.add(info.id);
      }
      return;
    }
  }

  private async handleClearContext(
    emit: MessageEmitCallback,
    originalMessageId: string,
  ): Promise<string> {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    const client = this.serverHandle ? this.client : null;
    if (client && this.sessionId) {
      try {
        await client.session.delete({ path: { id: this.sessionId }, query: { directory: this.workDir } });
      } catch {
        // 会话可能已不存在，忽略
      }
    }
    this.sessionId = null;
    this._lastInjectedMessageId = undefined;
    this.lastInjectedSkillsSignature = undefined;
    this.lastMcpToolsSignature = undefined;
    if (this.agentId) {
      await agentMemoryService.clear(this.chatRoomId, this.agentId);
    }
    this.resetCollectors();
    this.lastContext = null;
    this.lastResponse = null;
    this.lastInvokeResult = null;
    this.saveSessionState();
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
    emitRecord?: RecordEmitCallback,
    options?: AgentExecOptions,
  ): Promise<AgentExecResult> {
    this.emitStream = emitStream || null;
    this.emitToolCall = emitToolCall || null;
    this.emitThinking = emitThinking || null;
    this.emitRecord = emitRecord || null;
    this.resetCollectors();

    const contextResetCommand = getContextResetCommand(message);
    if (contextResetCommand) {
      const resultMessage = await this.handleClearContext(emit, originalMessageId);
      return { actions: [{ type: 'message', content: resultMessage }] };
    }

    if (this.stateless) {
      this.sessionId = null;
    }

    const suppressAssistantHandoff = options?.suppressAssistantHandoff === true;
    this.lastContext = this.buildFullMessage(message, history, suppressAssistantHandoff);
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    let abortSession: (() => void) | null = null;
    let remoteAbortPromise: Promise<unknown> | null = null;
    const abort = () => {
      const reason = signal?.reason ?? new DOMException('执行已被用户中断', 'AbortError');
      abortController.abort(reason);
      abortSession?.();
    };
    const throwIfAborted = () => {
      if (!abortController.signal.aborted) return;
      throw abortController.signal.reason ?? new DOMException('执行已被用户中断', 'AbortError');
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
    }

    const { parts, cleanup } = await this.writeAttachments(attachments);
    const execStartTime = Date.now();

    try {
      throwIfAborted();

      debugLog('opencodeSdkExecStart', {
        agentName: this.name,
        agentId: this.agentId,
        chatRoomId: this.chatRoomId,
        messageId: originalMessageId,
        sessionId: this.sessionId,
        contextLength: this.lastContext.length,
      });

      // 预加载连接器（MCP server），连接器变化时重启 server 使配置生效
      this.connectorMcpServers = (await getAgentConnectors(this.agentId)).reduce<Record<string, McpLocalConfig | McpRemoteConfig>>((acc, connector) => {
        if (connector.transport === 'http' && connector.url) {
          acc[connector.name] = { type: 'remote', url: connector.url, enabled: true };
        } else if (connector.transport === 'stdio' && connector.command) {
          acc[connector.name] = {
            type: 'local',
            command: [connector.command, ...connector.args],
            environment: connector.env,
            enabled: true,
          };
        }
        return acc;
      }, {});

      const currentSignature = this.buildMcpToolsSignature();
      if (this.serverHandle && this.sessionId && this.lastMcpToolsSignature !== currentSignature) {
        debugLog('opencodeSdkMcpToolsChangedRestart', {
          agentName: this.name,
          sessionId: this.sessionId,
        });
        this.serverHandle.close();
        this.serverHandle = null;
        this.client = null;
        this.sessionId = null;
      }
      this.lastMcpToolsSignature = currentSignature;
      if (this.sessionId) {
        this.saveSessionState();
      }

      const client = await this.ensureServerAndClient();
      const session = await this.ensureSession();
      const sessionId = session.id;

      // 取消本地 fetch 不一定会停止 OpenCode 服务端已经开始的模型请求；同时调用
      // session.abort，避免用户停止后远端 session 继续消耗 token。
      abortSession = () => {
        if (remoteAbortPromise) return;
        remoteAbortPromise = client.session.abort({
          path: { id: sessionId },
          query: { directory: this.workDir },
        }).then(() => {
          debugLog('opencodeSdkSessionAbortRequested', {
            agentName: this.name,
            agentId: this.agentId,
            chatRoomId: this.chatRoomId,
            sessionId,
          });
        }).catch((error) => {
          console.warn(`${this.name}: OpenCode session 中止请求失败`, error);
        });
      };
      if (signal?.aborted) {
        abortSession();
        throwIfAborted();
      }

      // 先订阅事件流，再发送消息，避免漏掉消息 part 事件
      const events = await client.event.subscribe({
        query: { directory: this.workDir },
        signal: abortController.signal,
      });
      let eventConsumptionError: unknown;
      const eventConsumption = (async () => {
        let idleSeen = false;
        for await (const event of events.stream) {
          throwIfAborted();
          if (event.type === 'session.idle' && event.properties?.sessionID === sessionId) {
            idleSeen = true;
            break;
          }
          this.handleEvent(event);
        }
        return idleSeen;
      })().catch((error) => {
        // 事件流与 prompt 可能同时因取消而结束；这里显式接住拒绝，避免
        // Promise.race 在 prompt 先失败时留下 unhandled rejection。
        eventConsumptionError = error;
        return false;
      });

      const agentName = suppressAssistantHandoff
        ? OPENCODE_AGENT_NAME_NO_HANDOFF
        : OPENCODE_AGENT_NAME;

      const promptResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: agentName,
          ...(this.providerModelRef ? { model: this.providerModelRef } : {}),
          parts: parts as never,
        },
        signal: abortController.signal,
      });

      let finalAssistant: AssistantMessage | null = promptResult.data?.info ?? null;

      // prompt 返回后继续消费事件直到 session.idle（或超时），确保文本/工具 part 全部处理完
      const idlePromise = Promise.race([
        eventConsumption,
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), OPENCODE_SDK_MAX_WAIT_IDLE_MS);
          timer.unref();
          abortController.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve(false);
            },
            { once: true },
          );
        }),
      ]);
      await idlePromise;
      throwIfAborted();
      if (eventConsumptionError) {
        throw eventConsumptionError;
      }

      // 若消息尚未完成（例如超时未收到 idle），从服务端拉取最终消息兜底
      if (!finalAssistant?.time?.completed) {
        try {
          const latest = await client.session.message({
            path: { id: sessionId, messageID: finalAssistant?.id || '' },
            query: { directory: this.workDir },
            signal: abortController.signal,
          });
          if (latest.data?.info) {
            finalAssistant = latest.data.info as AssistantMessage;
          }
        } catch {
          // 兜底拉取失败不影响主流程
        }
      }
      throwIfAborted();

      if (finalAssistant?.error) {
        throw new Error(
          typeof finalAssistant.error === 'string'
            ? finalAssistant.error
            : (finalAssistant.error as { data?: { message?: string } })?.data?.message || 'opencode 执行出错',
        );
      }

      if (finalAssistant?.time?.completed) {
        const tokens = finalAssistant.tokens;
        if (tokens) {
          const cacheRead = tokens.cache?.read || 0;
          this.lastTokenUsage = {
            inputTokens: Number(tokens.input || 0),
            outputTokens: Number(tokens.output || 0),
            totalTokens: Number((tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0)),
            cacheReadTokens: cacheRead,
          };
        }
        this.lastModel = finalAssistant.providerID
          ? `${finalAssistant.providerID}/${finalAssistant.modelID}`
          : (this.llmProvider?.model || null);
      }

      const finalResponse = this.content || 'opencode 执行完成';
      throwIfAborted();
      await emit(finalResponse, originalMessageId);
      this.lastResponse = finalResponse;
      this.lastInvokeResult = JSON.stringify(
        {
          toolCalls: this.toolCalls,
          responseLength: finalResponse.length,
          thinking: this.thinking ? { content: this.thinking, timestamp: Date.now() } : undefined,
          sessionId,
        },
        null,
        2,
      );

      return {
        actions: [{ type: 'message', content: finalResponse }],
        tokenUsage: this.lastTokenUsage,
        model: this.lastModel || undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      console.error(`${this.name}: opencode 执行失败`, error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      if (!options?.suppressFailureMessage) {
        await emit(`opencode 执行出错: ${errorMessage}`, originalMessageId);
      }
      throw error;
    } finally {
      // 等待 session.abort 请求落地，避免无活动重试马上复用同一个 session 时，
      // 竞态地被上一棒的远端 abort 请求再次中止。
      if (remoteAbortPromise) {
        await remoteAbortPromise;
      }
      cleanup();
      signal?.removeEventListener('abort', abort);
      this.currentAbortController = null;
      if (this.stateless) {
        this.sessionId = null;
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
      acpTool: 'opencode',
      workDir: this.workDir,
      injectGroupHistory: this.injectGroupHistory,
      lastContext: this.lastContext,
      lastInvokeResult: this.lastInvokeResult,
      lastResponse: this.lastResponse,
      lastHistory: null,
      threadId: this.sessionId || undefined,
      agentId: this.agentId,
      chatRoomAgents: this.chatRoomAgents,
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

  async cleanup(): Promise<void> {
    this.currentAbortController?.abort();
    this.currentAbortController = null;
    if (this.serverHandle) {
      this.serverHandle.close();
      this.serverHandle = null;
      this.client = null;
    }
    this.sessionId = null;
    this.resetCollectors();
    this.lastContext = null;
    this.lastResponse = null;
    this.lastInvokeResult = null;
    this.saveSessionState();
  }
}

/**
 * 清理 Opencode 助手的文件系统上下文（session 状态文件）。
 * 用于清空群聊消息时，即使没有 executor 缓存也能清理 session 状态。
 */
export function clearOpencodeSdkFileSystemContext(agentId: string, chatRoomId: string): void {
  const opencodeHome = path.join(os.homedir(), '.teamagentx', 'acp-config', agentId, 'opencode');
  if (!fs.existsSync(opencodeHome)) {
    return;
  }

  const workDir = path.join(os.homedir(), '.teamagentx', 'workspace', chatRoomId);
  const scope = createHash('sha256')
    .update(`${chatRoomId}:${workDir}`)
    .digest('hex')
    .slice(0, 16);

  const sessionStatePath = path.join(opencodeHome, `teamagentx-opencode-sdk-session-${scope}.json`);
  if (fs.existsSync(sessionStatePath)) {
    try {
      fs.unlinkSync(sessionStatePath);
      console.log(`[ClearOpencodeContext] 已删除 session 状态文件: ${sessionStatePath}`);
    } catch (error) {
      console.warn(`[ClearOpencodeContext] 删除 session 状态文件失败: ${sessionStatePath}`, error);
    }
  }
  console.log(`[ClearOpencodeContext] 已清理 Opencode 上下文: agentId=${agentId}, chatRoomId=${chatRoomId}`);
}
