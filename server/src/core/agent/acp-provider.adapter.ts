import type { LlmProvider } from '@prisma/client';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type SupportedAcpProviderTool = 'claude' | 'codex';

interface CreateAcpProviderCommandOptions {
  acpTool: string;
  agentCommand: string;
  provider?: LlmProvider;
  agentId?: string | null;
  agentName: string;
  wrapperRoot?: string;
}

export interface AcpProviderInfo {
  id: string;
  name: string;
  type: string;
  model: string;
  apiProtocol: string;
}

export interface AcpProviderCommandResult {
  command: string;
  providerInfo?: AcpProviderInfo;
}

function splitCommandLine(value: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaping = false;

  for (const ch of value) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === '\\' && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (escaping) current += '\\';
  if (current.length > 0) parts.push(current);

  const [command = '', ...args] = parts;
  return { command, args };
}

function quoteCommandPart(value: string): string {
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

function normalizeProtocol(provider: LlmProvider): string {
  return ((provider as any).apiProtocol || 'anthropic').toLowerCase();
}

function requireSupportedTool(acpTool: string): SupportedAcpProviderTool {
  if (acpTool === 'claude' || acpTool === 'codex') {
    return acpTool;
  }

  throw new Error(
    `ACP 工具 ${acpTool} 暂不支持自定义 LLM 供应商。当前最小闭环仅支持 Claude(anthropic 协议) 和 Codex(openai 协议)。`,
  );
}

export function buildAcpProviderEnv(
  acpTool: SupportedAcpProviderTool,
  provider: LlmProvider,
  agentId?: string | null,
): Record<string, string> {
  const protocol = normalizeProtocol(provider);
  const env: Record<string, string> = {};

  if (acpTool === 'claude') {
    if (protocol !== 'anthropic') {
      throw new Error(
        `Claude ACP 仅支持 anthropic 协议供应商，当前供应商 ${provider.name} 的协议是 ${protocol}。`,
      );
    }

    // 设置所有需要的变量
    env.ANTHROPIC_API_KEY = provider.apiKey;
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey; // Claude Code 可能使用 AUTH_TOKEN
    env.ANTHROPIC_MODEL = provider.model;
    // Claude Agent SDK 会用独立的「小/快模型」（默认 haiku）跑子 agent、摘要等后台任务，
    // 默认 id 会打到只认网关模型的 endpoint 返回 400。统一指向供应商主模型，避免回退到 haiku。
    env.ANTHROPIC_SMALL_FAST_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.model;
    if (provider.apiUrl) {
      env.ANTHROPIC_BASE_URL = provider.apiUrl;
      env.ANTHROPIC_API_URL = provider.apiUrl;
    }

    // 关键：设置 CLAUDE_CONFIG_DIR 指向 agent 专用目录
    // 这样每个 agent 可以有独立的 skills 配置
    // 使用 ~/.teamagentx/acp-config/{agentId} 而非全局共享目录
    env.CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.teamagentx', 'acp-config', agentId || 'default');

    return env;
  }

  if (protocol !== 'openai') {
    throw new Error(
      `Codex ACP 仅支持 openai 协议供应商，当前供应商 ${provider.name} 的协议是 ${protocol}。`,
    );
  }

  env.OPENAI_API_KEY = provider.apiKey;
  env.OPENAI_MODEL = provider.model;
  if (provider.apiUrl) {
    env.OPENAI_BASE_URL = provider.apiUrl;
    env.OPENAI_API_BASE = provider.apiUrl;
  }
  return env;
}

function getWrapperPath(
  acpTool: string,
  agentId: string | null | undefined,
  agentName: string,
  wrapperRoot?: string,
  llmProviderId?: string | null, // 添加 llmProviderId 参数，确保更换供应商时生成新的 wrapper
): string {
  const root =
    wrapperRoot || path.join(os.homedir(), '.teamagentx', 'acp-wrappers');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  // hash 源包含 llmProviderId，确保更换供应商时生成新的 wrapper 脚本
  const source = `${agentId || agentName}:${acpTool}:${llmProviderId || 'default'}`;
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  return path.join(root, `${hash}.mjs`);
}

function writeWrapper(
  wrapperPath: string,
  agentCommand: string,
  env: Record<string, string>,
): void {
  const parsed = splitCommandLine(agentCommand);
  if (!parsed.command) {
    throw new Error('ACP 工具启动命令为空，无法注入 LLM Provider');
  }

  // 添加 --bare 参数，禁止读取 ~/.claude.json
  const finalArgs = parsed.args.includes('--bare')
    ? parsed.args
    : [...parsed.args, '--bare'];

  // 需要清除的环境变量列表（防止父进程环境干扰）
  const envKeysToClear = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_REASONING_MODEL',
    // ACPX 认证相关
    'ACPX_AUTH_ANTHROPIC_API_KEY',
    'ACPX_AUTH_ANTHROPIC_AUTH_TOKEN',
  ];

  const script = `#!/usr/bin/env node
import { spawn } from 'node:child_process';

const command = ${JSON.stringify(parsed.command)};
const args = ${JSON.stringify(finalArgs)};
const providerEnv = ${JSON.stringify(env)};
const envKeysToClear = ${JSON.stringify(envKeysToClear)};

// 构建干净的环境：先清除不需要的变量，再添加 provider 的变量
const cleanEnv = { ...process.env };
envKeysToClear.forEach(key => {
  delete cleanEnv[key];
});

// 合并 provider 配置（覆盖任何残留值）
const finalEnv = { ...cleanEnv, ...providerEnv };

// 调试输出到 stderr（避免污染 stdout 的 JSON-RPC 通道）
console.error('[Wrapper] 启动 ACP Agent');
console.error('[Wrapper] 命令:', command, args.join(' '));
console.error('[Wrapper] Provider 配置:');
Object.entries(providerEnv).forEach(([key, value]) => {
  if (key.includes('KEY') || key.includes('TOKEN')) {
    console.error('  ' + key + ':', value.slice(0, 20) + '...');
  } else {
    console.error('  ' + key + ':', value);
  }
});

const child = spawn(command, args, {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: finalEnv,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[Wrapper] 启动失败:', error);
  process.exit(1);
});
`;

  fs.writeFileSync(wrapperPath, script, { mode: 0o700 });
  fs.chmodSync(wrapperPath, 0o700);

  console.log(`[ACP Provider] Wrapper 脚本已写入: ${wrapperPath}`);
}

export function createAcpProviderCommand(
  options: CreateAcpProviderCommandOptions,
): AcpProviderCommandResult {
  const { acpTool, agentCommand, provider, agentId, agentName, wrapperRoot } =
    options;

  if (!provider) {
    return { command: agentCommand };
  }

  const supportedTool = requireSupportedTool(acpTool);
  const env = buildAcpProviderEnv(supportedTool, provider, agentId);
  const wrapperPath = getWrapperPath(
    supportedTool,
    agentId,
    agentName,
    wrapperRoot,
    provider.id, // 传入 llmProviderId，确保更换供应商时生成新的 wrapper
  );
  writeWrapper(wrapperPath, agentCommand, env);

  return {
    command: quoteCommandPart(wrapperPath),
    providerInfo: {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      model: provider.model,
      apiProtocol: normalizeProtocol(provider),
    },
  };
}
