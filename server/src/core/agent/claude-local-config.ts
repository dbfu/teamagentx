import {execFileSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// macOS 上 Claude Code 默认把 OAuth 凭据存到 Keychain，文件 ~/.claude/.credentials.json
// 通常不存在；同时 Claude Code 只有在 CLAUDE_CONFIG_DIR 为默认 (~/.claude) 时才会
// 读 Keychain，自定义 CLAUDE_CONFIG_DIR（我们 per-agent 都会设）下只读
// <CLAUDE_CONFIG_DIR>/.credentials.json，否则会报 “Not logged in. Please run /login”。
const MACOS_KEYCHAIN_SERVICE = 'Claude Code-credentials';

function readMacosKeychainCredentials(): string | null {
  if (process.platform !== 'darwin') return null;
  if (process.env.TEAMAGENTX_DISABLE_CLAUDE_KEYCHAIN_FALLBACK === '1') return null;
  try {
    const result = execFileSync(
      'security',
      ['find-generic-password', '-s', MACOS_KEYCHAIN_SERVICE, '-w'],
      {encoding: 'utf-8', timeout: 5000},
    );
    const trimmed = result.trim();
    if (!trimmed) return null;
    try {
      JSON.parse(trimmed);
    } catch {
      return null;
    }
    return `${trimmed}\n`;
  } catch {
    return null;
  }
}

// 全局 settings.json 对这些 env 键拥有权威：全局有则推到 per-agent，
// 全局没有则从 per-agent 里删除。否则切换登录方式（OAuth ↔ API Key/Token）
// 后会留下陈旧凭证，把当前生效的鉴权顶掉。
// 保持与 claude-sdk.executor.ts `buildEnv` 里的清单一致。
const CLAUDE_GLOBAL_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_REASONING_MODEL',
] as const;

// 与鉴权 env 同样的逻辑，但作用在 settings.json 的顶层字段：
// Claude CLI 内 /model 等命令会把模型选择落到 settings.json 的顶层
// `model` 字段；用户在第三方供应商（如 glm-5.1）下用过一次后，再切回
// 官方订阅模式，per-agent settings.json 还残留 "model": "glm-5.1"。
// SDK 此时 options.model 为 undefined，CLI 会回退到 settings.json，
// 拿到陈旧模型名后直接报 "issue with the selected model"。
// 因此把这些字段也视作全局独占：全局有就跟，全局没有就抹掉。
const CLAUDE_GLOBAL_OWNED_TOP_LEVEL_KEYS = ['model'] as const;

const CLAUDE_GLOBAL_STATE_KEYS = [
  'userID',
  'hasCompletedOnboarding',
  'firstStartTime',
  'installMethod',
  'migrationVersion',
  'oauthAccount',
  'account',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeClaudeSettings(
  globalSettings: Record<string, unknown>,
  targetSettings: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!targetSettings) return globalSettings;

  const globalEnv = isRecord(globalSettings.env) ? globalSettings.env : {};
  const targetEnv = isRecord(targetSettings.env) ? targetSettings.env : {};

  // 先把 per-agent 的 auth 类 env 全部抹掉，再把全局 env 整体覆盖上去。
  // 这样全局即为 auth 鉴权类 env 的唯一 source of truth：
  //  - 全局有 -> per-agent 跟着拿到新值
  //  - 全局没有 -> per-agent 也不会留陈旧凭证
  const mergedEnv: Record<string, unknown> = {...targetEnv};
  for (const key of CLAUDE_GLOBAL_AUTH_ENV_KEYS) {
    delete mergedEnv[key];
  }
  for (const [key, value] of Object.entries(globalEnv)) {
    mergedEnv[key] = value;
  }

  const merged: Record<string, unknown> = {
    ...targetSettings,
    ...globalSettings,
    env: mergedEnv,
  };

  // 全局独占的顶层字段（如 model）：全局没有就必须从 per-agent 抹掉，
  // 否则切换供应商后陈旧值会留下来顶掉新模型。
  for (const key of CLAUDE_GLOBAL_OWNED_TOP_LEVEL_KEYS) {
    if (!(key in globalSettings)) {
      delete merged[key];
    }
  }

  return merged;
}

export interface ClaudeSettingsSyncResult {
  copied: boolean;
  sourcePath: string;
  targetPath: string;
  reason:
    | 'source_missing'
    | 'target_current'
    | 'target_missing'
    | 'content_changed';
}

export function getGlobalClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function getGlobalClaudeStatePath(): string {
  return path.join(os.homedir(), '.claude.json');
}

// Claude Code 把 OAuth access_token / refresh_token 存在这个文件里
// （Windows 上不走系统凭据管理器，macOS 同样写文件、加 Keychain 拷贝；
// Linux 走 libsecret，但文件也存在）。
// per-agent 的 CLAUDE_CONFIG_DIR 必须有这个文件，OAuth 模式才能工作。
export function getGlobalClaudeCredentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function hasClaudeAccountState(state: Record<string, unknown> | null): boolean {
  return Boolean(
    state &&
      (typeof state.userID === 'string' ||
        isRecord(state.oauthAccount) ||
        isRecord(state.account)),
  );
}

function pickClaudeAccountState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of CLAUDE_GLOBAL_STATE_KEYS) {
    if (state[key] !== undefined) {
      picked[key] = state[key];
    }
  }
  return picked;
}

export function syncGlobalClaudeSettingsToConfigDir(
  configDir: string,
): ClaudeSettingsSyncResult {
  const sourcePath = getGlobalClaudeSettingsPath();
  const targetPath = path.join(configDir, 'settings.json');

  if (!fs.existsSync(sourcePath)) {
    return {copied: false, sourcePath, targetPath, reason: 'source_missing'};
  }

  const globalSettings = readJsonFile(sourcePath);
  if (!globalSettings) {
    return {copied: false, sourcePath, targetPath, reason: 'source_missing'};
  }

  const targetExists = fs.existsSync(targetPath);
  const targetSettings = targetExists ? readJsonFile(targetPath) : null;
  const mergedSettings = mergeClaudeSettings(globalSettings, targetSettings);
  const mergedContent = `${JSON.stringify(mergedSettings, null, 2)}\n`;

  if (targetExists) {
    const currentContent = fs.readFileSync(targetPath, 'utf-8');
    if (currentContent === mergedContent) {
      return {copied: false, sourcePath, targetPath, reason: 'target_current'};
    }
  }

  fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
  fs.writeFileSync(targetPath, mergedContent, {mode: 0o600});
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // Windows 上 chmod 行为受限，失败不影响功能。
  }

  return {
    copied: true,
    sourcePath,
    targetPath,
    reason: targetExists ? 'content_changed' : 'target_missing',
  };
}

export interface ClaudeProviderSettingsStripResult {
  changed: boolean;
  targetPath: string;
  removedEnvKeys: string[];
  removedTopLevelKeys: string[];
}

// 当助手绑定了自定义 LlmProvider 时，鉴权/模型/base_url 全部由进程 env 注入
// （见 acp-provider.adapter.ts buildAcpProviderEnv）。但 per-agent settings.json
// 里可能残留早先用其它供应商时写下的 env 块（如 ANTHROPIC_BASE_URL 指向旧网关、
// ANTHROPIC_MODEL=glm-5）以及顶层 model 字段。Claude CLI 会读 settings.json 的
// 这些值，把我们注入的 provider env 顶掉，导致请求被发到错误的端点（例如把
// deepseek 模型名发到只认 GLM 的网关，返回 400 model not supported）。
// 因此 provider 模式下必须把这些冲突键从 settings.json 抹掉，让 provider 注入
// 成为唯一 source of truth。与 no-provider 模式下 mergeClaudeSettings 的清单一致。
export function stripProviderConflictingClaudeSettings(
  configDir: string,
): ClaudeProviderSettingsStripResult {
  const targetPath = path.join(configDir, 'settings.json');
  const empty: ClaudeProviderSettingsStripResult = {
    changed: false,
    targetPath,
    removedEnvKeys: [],
    removedTopLevelKeys: [],
  };

  if (!fs.existsSync(targetPath)) return empty;

  const settings = readJsonFile(targetPath);
  if (!settings) return empty;

  const removedEnvKeys: string[] = [];
  const removedTopLevelKeys: string[] = [];

  const nextSettings: Record<string, unknown> = {...settings};

  if (isRecord(nextSettings.env)) {
    const nextEnv: Record<string, unknown> = {...nextSettings.env};
    for (const key of CLAUDE_GLOBAL_AUTH_ENV_KEYS) {
      if (key in nextEnv) {
        delete nextEnv[key];
        removedEnvKeys.push(key);
      }
    }
    nextSettings.env = nextEnv;
  }

  for (const key of CLAUDE_GLOBAL_OWNED_TOP_LEVEL_KEYS) {
    if (key in nextSettings) {
      delete nextSettings[key];
      removedTopLevelKeys.push(key);
    }
  }

  if (removedEnvKeys.length === 0 && removedTopLevelKeys.length === 0) {
    return empty;
  }

  const mergedContent = `${JSON.stringify(nextSettings, null, 2)}\n`;
  fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
  fs.writeFileSync(targetPath, mergedContent, {mode: 0o600});
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // Windows 上 chmod 行为受限，失败不影响功能。
  }

  return {changed: true, targetPath, removedEnvKeys, removedTopLevelKeys};
}

export interface ClaudeStateSyncResult {
  copied: boolean;
  sourcePath: string;
  targetPath: string;
  reason:
    | 'source_missing'
    | 'source_without_account_state'
    | 'target_current'
    | 'target_missing'
    | 'target_without_account_state'
    | 'source_user_changed';
}

export function syncGlobalClaudeStateToConfigDir(
  configDir: string,
): ClaudeStateSyncResult {
  const sourcePath = getGlobalClaudeStatePath();
  const targetPath = path.join(configDir, '.claude.json');

  if (!fs.existsSync(sourcePath)) {
    return {copied: false, sourcePath, targetPath, reason: 'source_missing'};
  }

  const globalState = readJsonFile(sourcePath);
  if (!hasClaudeAccountState(globalState)) {
    return {
      copied: false,
      sourcePath,
      targetPath,
      reason: 'source_without_account_state',
    };
  }

  const targetState = fs.existsSync(targetPath) ? readJsonFile(targetPath) : null;
  const sourceUserId =
    typeof globalState!.userID === 'string' ? globalState!.userID : undefined;
  const targetUserId =
    targetState && typeof targetState.userID === 'string'
      ? targetState.userID
      : undefined;

  let reason: ClaudeStateSyncResult['reason'] | null = null;
  if (!fs.existsSync(targetPath)) {
    reason = 'target_missing';
  } else if (!hasClaudeAccountState(targetState)) {
    reason = 'target_without_account_state';
  } else if (sourceUserId && targetUserId && sourceUserId !== targetUserId) {
    reason = 'source_user_changed';
  }

  if (!reason) {
    return {copied: false, sourcePath, targetPath, reason: 'target_current'};
  }

  fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
  const mergedState = {
    ...(targetState || {}),
    ...pickClaudeAccountState(globalState!),
  };
  fs.writeFileSync(targetPath, `${JSON.stringify(mergedState, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(targetPath, 0o600);

  return {copied: true, sourcePath, targetPath, reason};
}

export interface ClaudeCredentialsSyncResult {
  copied: boolean;
  sourcePath: string;
  targetPath: string;
  reason:
    | 'source_missing'
    | 'target_current'
    | 'target_missing'
    | 'content_changed';
}

export function syncGlobalClaudeCredentialsToConfigDir(
  configDir: string,
): ClaudeCredentialsSyncResult {
  const filePath = getGlobalClaudeCredentialsPath();
  const targetPath = path.join(configDir, '.credentials.json');

  let sourceContent: string | null = null;
  let sourcePath = filePath;

  if (fs.existsSync(filePath)) {
    try {
      sourceContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      sourceContent = null;
    }
  }

  // macOS 上文件通常不存在，回退到 Keychain。Claude Code CLI 在自定义
  // CLAUDE_CONFIG_DIR 下不会再去查 Keychain，必须由我们把凭据落盘到 per-agent dir。
  if (!sourceContent) {
    const keychainContent = readMacosKeychainCredentials();
    if (keychainContent) {
      sourceContent = keychainContent;
      sourcePath = `keychain:${MACOS_KEYCHAIN_SERVICE}`;
    }
  }

  if (!sourceContent) {
    return {copied: false, sourcePath, targetPath, reason: 'source_missing'};
  }

  const targetExists = fs.existsSync(targetPath);
  if (targetExists) {
    try {
      const currentContent = fs.readFileSync(targetPath, 'utf-8');
      if (currentContent === sourceContent) {
        return {copied: false, sourcePath, targetPath, reason: 'target_current'};
      }
    } catch {
      // 读不出来就当作要重写
    }
  }

  fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
  fs.writeFileSync(targetPath, sourceContent, {mode: 0o600});
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // Windows 上 chmod 行为受限，失败不影响功能。
  }

  return {
    copied: true,
    sourcePath,
    targetPath,
    reason: targetExists ? 'content_changed' : 'target_missing',
  };
}

export function syncGlobalClaudeLocalConfig(configDir: string): {
  settings: ClaudeSettingsSyncResult;
  state: ClaudeStateSyncResult;
  credentials: ClaudeCredentialsSyncResult;
} {
  return {
    settings: syncGlobalClaudeSettingsToConfigDir(configDir),
    state: syncGlobalClaudeStateToConfigDir(configDir),
    credentials: syncGlobalClaudeCredentialsToConfigDir(configDir),
  };
}
