import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLAUDE_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
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

function hasClaudeAuthEnv(settings: Record<string, unknown> | null): boolean {
  if (!settings) return false;
  const env = settings.env;
  if (!isRecord(env)) return false;
  return CLAUDE_AUTH_ENV_KEYS.some(
    (key) => typeof env[key] === 'string' && env[key].trim().length > 0,
  );
}

function mergeClaudeSettings(
  globalSettings: Record<string, unknown>,
  targetSettings: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!targetSettings) return globalSettings;

  const globalEnv = isRecord(globalSettings.env) ? globalSettings.env : {};
  const targetEnv = isRecord(targetSettings.env) ? targetSettings.env : {};

  return {
    ...targetSettings,
    ...globalSettings,
    env: {
      ...targetEnv,
      ...globalEnv,
    },
  };
}

export interface ClaudeSettingsSyncResult {
  copied: boolean;
  sourcePath: string;
  targetPath: string;
  reason:
    | 'source_missing'
    | 'source_without_auth_env'
    | 'target_current'
    | 'target_missing'
    | 'target_without_auth_env'
    | 'source_newer';
}

export function getGlobalClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

export function getGlobalClaudeStatePath(): string {
  return path.join(os.homedir(), '.claude.json');
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
  if (!hasClaudeAuthEnv(globalSettings)) {
    return {
      copied: false,
      sourcePath,
      targetPath,
      reason: 'source_without_auth_env',
    };
  }

  const targetSettings = fs.existsSync(targetPath) ? readJsonFile(targetPath) : null;
  const sourceMtime = fs.statSync(sourcePath).mtimeMs;
  const targetMtime = fs.existsSync(targetPath)
    ? fs.statSync(targetPath).mtimeMs
    : 0;

  let reason: ClaudeSettingsSyncResult['reason'] | null = null;
  if (!fs.existsSync(targetPath)) {
    reason = 'target_missing';
  } else if (!hasClaudeAuthEnv(targetSettings)) {
    reason = 'target_without_auth_env';
  } else if (sourceMtime > targetMtime + 1000) {
    reason = 'source_newer';
  }

  if (!reason) {
    return {copied: false, sourcePath, targetPath, reason: 'target_current'};
  }

  fs.mkdirSync(configDir, {recursive: true, mode: 0o700});
  const mergedSettings = mergeClaudeSettings(globalSettings!, targetSettings);
  fs.writeFileSync(targetPath, `${JSON.stringify(mergedSettings, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(targetPath, 0o600);

  return {copied: true, sourcePath, targetPath, reason};
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

export function syncGlobalClaudeLocalConfig(configDir: string): {
  settings: ClaudeSettingsSyncResult;
  state: ClaudeStateSyncResult;
} {
  return {
    settings: syncGlobalClaudeSettingsToConfigDir(configDir),
    state: syncGlobalClaudeStateToConfigDir(configDir),
  };
}
