import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

  return {
    ...targetSettings,
    ...globalSettings,
    env: mergedEnv,
  };
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
  const sourcePath = getGlobalClaudeCredentialsPath();
  const targetPath = path.join(configDir, '.credentials.json');

  if (!fs.existsSync(sourcePath)) {
    return {copied: false, sourcePath, targetPath, reason: 'source_missing'};
  }

  let sourceContent: string;
  try {
    sourceContent = fs.readFileSync(sourcePath, 'utf-8');
  } catch {
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
