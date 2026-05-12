import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ACP 工具定义
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
  { id: 'cursor', name: 'Cursor', description: 'Cursor Agent', checkCommand: 'cursor-agent --version' },
  { id: 'copilot', name: 'Copilot', description: 'GitHub Copilot CLI', checkCommand: 'copilot --version' },
  { id: 'gemini', name: 'Gemini', description: 'Google Gemini CLI', checkCommand: 'gemini --version' },
  { id: 'kimi', name: 'Kimi', description: 'Moonshot Kimi CLI', checkCommand: 'kimi --version' },
  { id: 'qwen', name: 'Qwen', description: 'Alibaba Qwen CLI', checkCommand: 'qwen --version' },
  { id: 'pi', name: 'Pi', description: 'Inflection Pi CLI', checkCommand: 'pi --version' },
  { id: 'droid', name: 'Droid', description: 'Factory Droid', checkCommand: 'droid --version' },
  { id: 'openclaw', name: 'OpenClaw', description: 'OpenClaw Agent', checkCommand: 'openclaw --version' },
  { id: 'kilocode', name: 'KiloCode', description: 'KiloCode CLI', checkCommand: 'kilocode --version' },
  { id: 'kiro', name: 'Kiro', description: 'Kiro CLI', checkCommand: 'kiro-cli --version' },
  { id: 'opencode', name: 'OpenCode', description: 'OpenCode CLI', checkCommand: 'opencode --version' },
  { id: 'iflow', name: 'iFlow', description: 'iFlow Agent', checkCommand: 'iflow --version' },
] as const;

const VISIBLE_ACP_TOOL_IDS = new Set(['claude', 'codex']);

export interface AcpToolInfo {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  localConfigAvailable?: boolean;
  localConfigPath?: string;
  localConfigLabel?: string;
}

function checkClaudeLocalConfig(): { available: boolean; path: string; label: string } {
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

  const found = candidates.find((candidate) => fs.existsSync(candidate.path));
  const configPath = found?.path || candidates[0].path;
  return {
    available: fs.existsSync(configPath),
    path: configPath,
    label: found?.label || candidates[0].label,
  };
}

function checkCodexLocalConfig(): { available: boolean; path: string; label: string } {
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  try {
    if (!fs.existsSync(authPath)) {
      return { available: false, path: authPath, label: 'Codex auth.json' };
    }
    const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    const hasApiKey = typeof data.OPENAI_API_KEY === 'string' && data.OPENAI_API_KEY.length > 0;
    const hasChatGptTokens =
      data.tokens &&
      typeof data.tokens === 'object' &&
      typeof data.tokens.access_token === 'string' &&
      typeof data.tokens.refresh_token === 'string';

    return {
      available: Boolean(data.auth_mode && (hasApiKey || hasChatGptTokens)),
      path: authPath,
      label: 'Codex auth.json',
    };
  } catch {
    return { available: false, path: authPath, label: 'Codex auth.json' };
  }
}

function checkLocalConfig(toolId: string): Pick<AcpToolInfo, 'localConfigAvailable' | 'localConfigPath' | 'localConfigLabel'> {
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
  };
}

/**
 * 检测单个 CLI 工具是否已安装
 */
function checkToolInstalled(checkCommand: string): { installed: boolean; version?: string } {
  // 构建 PATH：包含 TOOLS_DIR/node_modules/.bin
  const toolsDir = process.env.TOOLS_DIR;
  let envPath = process.env.PATH || '';
  if (toolsDir) {
    const toolsBin = path.join(toolsDir, 'node_modules', '.bin');
    if (fs.existsSync(toolsBin)) {
      envPath = `${toolsBin}${path.delimiter}${envPath}`;
    }
  }

  try {
    const output = execSync(checkCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      env: { ...process.env, PATH: envPath },
    });

    // 尝试提取版本号（取第一行）
    const version = output.split('\n')[0].trim().slice(0, 50);
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

/**
 * 检测所有可见 ACP/SDK 工具的安装状态
 */
export function checkAllAcpTools(): AcpToolInfo[] {
  return ACP_TOOLS.filter((tool) => VISIBLE_ACP_TOOL_IDS.has(tool.id)).map(tool => {
    const checkCmd = 'checkCommand' in tool ? tool.checkCommand : undefined;

    if (!checkCmd) {
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        installed: true,
        ...checkLocalConfig(tool.id),
      };
    }

    const result = checkToolInstalled(checkCmd);
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      installed: result.installed,
      version: result.version,
      ...checkLocalConfig(tool.id),
    };
  });
}

/**
 * 获取已安装的 ACP 工具 ID 列表
 */
export function getInstalledAcpToolIds(): string[] {
  return checkAllAcpTools()
    .filter(tool => tool.installed)
    .map(tool => tool.id);
}
