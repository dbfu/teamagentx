/**
 * JSON 规范化工具：用于 tool 调用参数 / function_call_output 的稳定序列化。
 * 移植自 cc-switch `proxy/json_canonical.rs`，保证对象键有序、与上游缓存对齐。
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 按键名排序后序列化为紧凑 JSON 字符串（对象键递归有序）。 */
export function canonicalJsonString(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonString).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonString(value[key])}`);
  return `{${parts.join(',')}}`;
}

/** 若字符串能解析为 JSON 则规范化，否则原样返回。 */
export function canonicalizeJsonStringIfParseable(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return canonicalJsonString(JSON.parse(trimmed) as JsonValue);
  } catch {
    return value;
  }
}

/** 规范化字符串形态的 tool arguments，空串归一为 "{}"。 */
export function canonicalizeToolArgumentsStr(value: string): string {
  if (!value.trim()) return '{}';
  return canonicalizeJsonStringIfParseable(value);
}

/** 规范化任意形态（字符串或对象）的 tool arguments，统一输出 JSON 字符串。 */
export function canonicalizeToolArguments(value: JsonValue | undefined): string {
  if (typeof value === 'string') return canonicalizeToolArgumentsStr(value);
  if (value === undefined || value === null) return '{}';
  return canonicalJsonString(value);
}
