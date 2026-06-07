const PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]);

const PROXY_ENV_PATTERN = /\b(https?_proxy|all_proxy|HTTPS?_PROXY|ALL_PROXY)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/g;

const ALLOWED_PROXY_PROTOCOLS = new Set([
  'http:',
  'https:',
  'socks4:',
  'socks4h:',
  'socks5:',
  'socks5h:',
]);

function normalizeProxyKey(key: string): 'HTTP_PROXY' | 'HTTPS_PROXY' | 'ALL_PROXY' {
  const normalized = key.toUpperCase();
  if (normalized === 'HTTP_PROXY' || normalized === 'HTTPS_PROXY' || normalized === 'ALL_PROXY') {
    return normalized;
  }
  throw new Error(`不支持的代理环境变量: ${key}`);
}

function validateProxyUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('代理配置不能为空');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`代理地址格式不正确: ${trimmed}`);
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error(`代理地址仅支持 http、https、socks4、socks5 协议: ${trimmed}`);
  }
  if (!url.hostname) {
    throw new Error(`代理地址缺少主机: ${trimmed}`);
  }
  return trimmed;
}

function assignProxyEnv(env: Record<string, string>, key: string, value: string): void {
  const normalizedKey = normalizeProxyKey(key);
  const normalizedValue = validateProxyUrl(value);
  env[normalizedKey] = normalizedValue;
  env[normalizedKey.toLowerCase()] = normalizedValue;
}

export function normalizeAgentProxyConfig(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  parseProxyConfigEnv(trimmed);
  return trimmed;
}

export function parseProxyConfigEnv(value: string | null | undefined): Record<string, string> {
  if (!value?.trim()) return {};

  const raw = value.trim();
  const env: Record<string, string> = {};
  let matched = false;

  PROXY_ENV_PATTERN.lastIndex = 0;
  for (const match of raw.matchAll(PROXY_ENV_PATTERN)) {
    matched = true;
    const key = match[1];
    const proxyValue = match[2] ?? match[3] ?? match[4] ?? '';
    if (!PROXY_ENV_KEYS.has(key)) {
      continue;
    }
    assignProxyEnv(env, key, proxyValue);
  }

  if (matched) {
    return env;
  }

  const proxyUrl = validateProxyUrl(raw);
  assignProxyEnv(env, 'HTTP_PROXY', proxyUrl);
  assignProxyEnv(env, 'HTTPS_PROXY', proxyUrl);
  assignProxyEnv(env, 'ALL_PROXY', proxyUrl);
  return env;
}
