import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { findHostPathCodexBinary } from './codex-sdk.executor.js';

// Local agent tool definitions. Only Claude and Codex are currently supported.
export const ACP_TOOLS = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude Agent SDK',
    checkCommand: 'claude --version',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex SDK',
    checkCommand: 'codex --version',
  },
] as const;

const TOOL_PACKAGES: Record<string, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
};

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

export interface LocalModelConfig {
  id: string;
  name: string;
  apiUrl?: string;
  apiKey?: string;
}

export interface AcpToolInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  cliInstalled: boolean;
  cliVersion?: string;
  sdkInstalled: boolean;
  sdkVersion?: string;
  preferredRuntime?: 'sdk' | 'cli';
  localConfigAvailable?: boolean;
  localConfigPath?: string;
  localConfigLabel?: string;
  localModels?: LocalModelConfig[];
}

function readClaudeConfigModels(configPath: string): LocalModelConfig[] {
  try {
    if (!fs.existsSync(configPath)) return [];
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const models: LocalModelConfig[] = [];

    // Claude 配置可能包含 env 对象中的 API key 和模型
    if (data.env) {
      if (data.env.ANTHROPIC_API_KEY) {
        models.push({
          id: 'claude-default',
          name: data.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          apiUrl: data.env.ANTHROPIC_API_URL,
          apiKey: data.env.ANTHROPIC_API_KEY,
        });
      }
      // 如果有其他模型配置
      if (data.env.CLAUDE_MODEL) {
        models.push({
          id: 'claude-custom',
          name: data.env.CLAUDE_MODEL,
          apiUrl: data.env.ANTHROPIC_API_URL,
          apiKey: data.env.ANTHROPIC_API_KEY,
        });
      }
    }

    // 如果没有从 env 读取到，但有 API key
    if (models.length === 0 && (data.apiKey || data.ANTHROPIC_API_KEY)) {
      models.push({
        id: 'claude-default',
        name: data.model || 'claude-sonnet-4-20250514',
        apiKey: data.apiKey || data.ANTHROPIC_API_KEY,
      });
    }

    return models;
  } catch {
    return [];
  }
}

function readCodexConfigModels(configPath: string): LocalModelConfig[] {
  try {
    if (!fs.existsSync(configPath)) return [];
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const models: LocalModelConfig[] = [];

    // Codex auth.json 包含 OPENAI_API_KEY
    if (data.OPENAI_API_KEY) {
      models.push({
        id: 'codex-default',
        name: data.OPENAI_MODEL || 'gpt-4o',
        apiUrl: data.OPENAI_API_URL,
        apiKey: data.OPENAI_API_KEY,
      });
    }

    // ChatGPT tokens 模式
    if (data.tokens?.access_token) {
      models.push({
        id: 'codex-chatgpt',
        name: 'ChatGPT (内置)',
      });
    }

    return models;
  } catch {
    return [];
  }
}

function checkClaudeLocalConfig(): { available: boolean; path: string; label: string; models: LocalModelConfig[] } {
  const candidates = [
    {
      path: path.join(os.homedir(), '.claude', 'settings.json'),
      label: 'Claude settings.json',
    },
    {
      path: path.join(os.homedir(), '.claude', 'settings.local.json'),
      label: 'Claude settings.local.json',
    },
    {
      path: path.join(os.homedir(), '.claude.json'),
      label: 'Claude 本地配置',
    },
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path)) {
      const models = readClaudeConfigModels(candidate.path);
      if (models.length > 0) {
        return {
          available: true,
          path: candidate.path,
          label: candidate.label,
          models,
        };
      }
    }
  }

  const defaultPath = candidates[0].path;
  return {
    available: fs.existsSync(defaultPath),
    path: defaultPath,
    label: candidates[0].label,
    models: [],
  };
}

function checkCodexLocalConfig(): { available: boolean; path: string; label: string; models: LocalModelConfig[] } {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    if (!fs.existsSync(authPath)) {
      return { available: false, path: authPath, label: 'Codex auth.json', models: [] };
    }
    const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    const hasApiKey = typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.length > 0;
    const hasChatGptTokens =
      data.tokens &&
      typeof data.tokens === 'object' &&
      typeof data.tokens.access_token === 'string' &&
      typeof data.tokens.refresh_token === 'string';

    const available = hasApiKey || hasChatGptTokens;
    const models = readCodexConfigModels(authPath);

    return {
      available,
      path: authPath,
      label: 'Codex auth.json',
      models,
    };
  } catch {
    return { available: false, path: authPath, label: 'Codex auth.json', models: [] };
  }
}

function checkLocalConfig(toolId: string): Pick<AcpToolInfo, 'localConfigAvailable' | 'localConfigPath' | 'localConfigLabel' | 'localModels'> {
  const result = toolId === 'claude'
    ? checkClaudeLocalConfig()
    : toolId === 'codex'
      ? checkCodexLocalConfig()
      : null;

  if (!result) return {};
  return {
    localConfigAvailable: result.available,
    localConfigPath: result.path,
    localConfigLabel: result.label,
    localModels: result.models,
  };
}

/**
 * 检测宿主机 PATH 中的 CLI 工具是否已安装。
 */
function checkHostCliInstalled(checkCommand: string): { installed: boolean; version?: string } {
  try {
    const output = execSync(checkCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env, PATH: process.env.PATH || '' },
    });

    // 尝试提取版本号（取第一行）
    const version = output.split('\n')[0].trim().slice(0, 50);
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * 检测宿主机 CLI 是否「真的可用」。
 *
 * 对 codex：`codex --version` 在 Windows 上会经 shell 命中 `codex.cmd` shim 而通过，
 * 但运行时是绕过 shell 直接 spawn 原生 `codex.exe`（见 codex-sdk.executor）。若 shim
 * 解析不到可 spawn 的二进制，运行时必然失败。这里复用运行时同一套解析逻辑做二次确认，
 * 避免「面板显示 CLI 已检测到、一执行就报 Unable to locate Codex CLI binaries」的假阳性——
 * 解析不到时如实判 CLI 不可用，使 preferredRuntime 自动回退到应用本地 SDK。
 */
function checkHostCliUsable(toolId: string, checkCommand: string): { installed: boolean; version?: string } {
  const result = checkHostCliInstalled(checkCommand);
  if (!result.installed) return result;

  if (toolId === 'codex' && !findHostPathCodexBinary()) {
    return { installed: false };
  }

  return result;
}

function readPackageVersion(packageDir: string): string | undefined {
  try {
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return undefined;
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return typeof packageJson.version === 'string' ? packageJson.version : undefined;
  } catch {
    return undefined;
  }
}

function getCodexTargetTriple(): string | undefined {
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
  return undefined;
}

function getCodexBinaryFromPlatformPackageJson(platformPackageJsonPath: string): string | undefined {
  const targetTriple = getCodexTargetTriple();
  if (!targetTriple) return undefined;

  const codexBinaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const binaryPath = path.join(path.dirname(platformPackageJsonPath), 'vendor', targetTriple, 'bin', codexBinaryName);
  return fs.existsSync(binaryPath) ? binaryPath : undefined;
}

function hasCodexPlatformBinary(codexPackageDir: string): boolean {
  const targetTriple = getCodexTargetTriple();
  const platformPackage = targetTriple ? CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple] : undefined;
  if (!platformPackage) return false;

  const codexPackageJsonPath = path.join(codexPackageDir, 'package.json');
  if (!fs.existsSync(codexPackageJsonPath)) return false;

  try {
    const codexRequire = createRequire(codexPackageJsonPath);
    const platformPackageJsonPath = codexRequire.resolve(`${platformPackage}/package.json`);
    return Boolean(getCodexBinaryFromPlatformPackageJson(platformPackageJsonPath));
  } catch {
    return Boolean(getCodexBinaryFromPlatformPackageJson(codexPackageJsonPath));
  }
}

/**
 * 检测 TeamAgentX 应用本地安装目录中的 SDK/工具包。
 */
function checkAppLocalSdkInstalled(toolId: string): { installed: boolean; version?: string } {
  const toolsDir = process.env.TOOLS_DIR;
  const packageName = TOOL_PACKAGES[toolId];
  if (!toolsDir || !packageName) return { installed: false };

  const packageDir = path.join(toolsDir, 'node_modules', ...packageName.split('/'));
  if (!fs.existsSync(packageDir)) return { installed: false };
  if (toolId === 'codex' && !hasCodexPlatformBinary(packageDir)) {
    return { installed: false, version: readPackageVersion(packageDir) };
  }

  return {
    installed: true,
    version: readPackageVersion(packageDir),
  };
}

/**
 * 检测所有支持的本地 Agent 工具安装状态。
 */
export function checkAllAcpTools(): AcpToolInfo[] {
  return ACP_TOOLS.map(tool => {
    const checkCmd = 'checkCommand' in tool ? tool.checkCommand : undefined;

    if (!checkCmd) {
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        installed: true,
        cliInstalled: false,
        sdkInstalled: true,
        preferredRuntime: 'sdk',
        ...checkLocalConfig(tool.id),
      };
    }

    const sdk = checkAppLocalSdkInstalled(tool.id);
    const cli = checkHostCliUsable(tool.id, checkCmd);
    const installed = sdk.installed || cli.installed;
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      installed,
      version: cli.installed ? cli.version : sdk.version,
      cliInstalled: cli.installed,
      cliVersion: cli.version,
      sdkInstalled: sdk.installed,
      sdkVersion: sdk.version,
      preferredRuntime: cli.installed ? 'cli' : sdk.installed ? 'sdk' : undefined,
      ...checkLocalConfig(tool.id),
    };
  });
}

/**
 * 获取已安装的本地 Agent 工具 ID 列表
 */
export function getInstalledAcpToolIds(): string[] {
  return checkAllAcpTools()
    .filter(tool => tool.installed)
    .map(tool => tool.id);
}
