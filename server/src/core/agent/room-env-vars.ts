/**
 * 群聊环境变量（ChatRoom.envVars）解析与注入工具。
 *
 * 设计见 docs/superpowers/specs/2026-06-06-chatroom-env-vars-design.md：
 * - 环境变量以 JSON 数组形式存储在 ChatRoom.envVars。
 * - 仅注入到 shell 命令执行环境，不进入执行器主进程 env。
 * - 注入时跳过一批保留键，防止群配置覆盖鉴权/路径，劫持执行器行为。
 */

export interface RoomEnvVar {
  key: string;
  value: string;
  description?: string;
}

/** 合法环境变量名：字母或下划线开头，后跟字母/数字/下划线 */
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 精确匹配的保留键 */
const RESERVED_KEYS = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'PWD',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'NODE_PATH',
  'NODE_OPTIONS',
]);

/** 前缀匹配的保留键（这些前缀下的键全部跳过） */
const RESERVED_PREFIXES = [
  'ANTHROPIC_',
  'OPENAI_',
  'ACPX_',
  'CLAUDE_',
  'CODEX_',
  'TEAMAGENTX_',
];

function isReservedKey(key: string): boolean {
  if (RESERVED_KEYS.has(key)) return true;
  return RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 解析 ChatRoom.envVars（JSON 字符串）为合法的环境变量数组。
 *
 * - JSON 解析失败或不是数组 → 返回 []，不抛错，避免阻断执行。
 * - key 必须匹配 VALID_ENV_KEY，否则丢弃该条。
 * - key 去重：保留首次出现的条目。
 * - value 缺省为 ''，description 缺省为 undefined。
 */
export function parseRoomEnvVars(raw: string | null | undefined): RoomEnvVar[] {
  if (!raw || typeof raw !== 'string') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: RoomEnvVar[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : '';
    if (!VALID_ENV_KEY.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);

    const value = typeof record.value === 'string' ? record.value : '';
    const description =
      typeof record.description === 'string' && record.description.trim()
        ? record.description
        : undefined;
    result.push({ key, value, description });
  }

  return result;
}

/**
 * 把环境变量拆成「可用」与「命中保留键被跳过」两部分。
 * 用于保存时只持久化可用键，并把被跳过的保留键反馈给前端。
 */
export function partitionRoomEnvVars(vars: RoomEnvVar[]): {
  accepted: RoomEnvVar[];
  skippedKeys: string[];
} {
  const accepted: RoomEnvVar[] = [];
  const skippedKeys: string[] = [];
  for (const envVar of vars) {
    if (isReservedKey(envVar.key)) {
      skippedKeys.push(envVar.key);
    } else {
      accepted.push(envVar);
    }
  }
  return { accepted, skippedKeys };
}

/**
 * 在 base 环境之上合并群聊环境变量，跳过保留键。
 *
 * @returns env  合并后的环境（保留键不会覆盖 base）
 * @returns skippedKeys  命中保留键而被跳过的 key 列表
 */
export function buildShellEnvFromRoomEnvVars<
  T extends Record<string, string | undefined>,
>(
  base: T,
  roomEnvVars: RoomEnvVar[],
): { env: T; skippedKeys: string[] } {
  if (roomEnvVars.length === 0) {
    return { env: base, skippedKeys: [] };
  }

  const env: Record<string, string | undefined> = { ...base };
  const skippedKeys: string[] = [];

  for (const { key, value } of roomEnvVars) {
    if (isReservedKey(key)) {
      skippedKeys.push(key);
      continue;
    }
    env[key] = value;
  }

  return { env: env as T, skippedKeys };
}
