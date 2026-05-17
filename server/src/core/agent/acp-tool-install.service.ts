import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/index.js';

export const ACP_TOOL_PACKAGES: Record<string, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
};

const DEFAULT_ACP_TOOL_INSTALL_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
];

export interface AcpToolInstallPlan {
  packageName: string;
  registries: string[];
  toolsDir: string;
}

export function getAcpToolPackageName(toolId: string): string | undefined {
  return ACP_TOOL_PACKAGES[toolId];
}

export function getAcpToolsDir(): string {
  return process.env.TOOLS_DIR || config.toolsDir || path.join(process.cwd(), '.tools');
}

function normalizeRegistryUrl(registry: string): string {
  return registry.trim().replace(/\/+$/, '');
}

export function getAcpToolInstallRegistries(): string[] {
  const raw = process.env.ACP_TOOL_INSTALL_REGISTRIES?.trim();
  const source = raw
    ? raw.split(/[\n,\s;]+/).map((entry) => entry.trim()).filter(Boolean)
    : DEFAULT_ACP_TOOL_INSTALL_REGISTRIES;

  const uniqueRegistries: string[] = [];
  for (const registry of source) {
    const normalized = normalizeRegistryUrl(registry);
    if (!normalized || uniqueRegistries.includes(normalized)) continue;
    uniqueRegistries.push(normalized);
  }

  return uniqueRegistries.length > 0
    ? uniqueRegistries
    : [...DEFAULT_ACP_TOOL_INSTALL_REGISTRIES];
}

export function createAcpToolInstallPlan(toolId: string): AcpToolInstallPlan {
  const packageName = getAcpToolPackageName(toolId);
  if (!packageName) {
    throw new Error('不支持的工具');
  }

  return {
    packageName,
    registries: getAcpToolInstallRegistries(),
    toolsDir: getAcpToolsDir(),
  };
}

export function spawnAcpToolInstall(toolId: string) {
  const { packageName, registries, toolsDir } = createAcpToolInstallPlan(toolId);
  fs.mkdirSync(toolsDir, { recursive: true });

  const installerScript = `
const { spawn } = require('child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageName = process.argv[1];
const toolsDir = process.argv[2];
const registries = JSON.parse(process.argv[3]);

function runAttempt(index) {
  const registry = registries[index];
  if (!registry) {
    process.exit(1);
    return;
  }

  process.stdout.write(\`\\n[TeamAgentX] 正在安装 \${packageName}（源 \${index + 1}/\${registries.length}）：\${registry}\\n\`);

  const child = spawn(
    npmCmd,
    ['install', '--prefix', toolsDir, packageName, '--force', '--registry', registry],
    {
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  child.on('error', (error) => {
    process.stderr.write(\`\\n[TeamAgentX] npm 启动失败：\${error.message}\\n\`);
    if (index + 1 < registries.length) {
      process.stdout.write(\`[TeamAgentX] 切换到备用源：\${registries[index + 1]}\\n\`);
      runAttempt(index + 1);
      return;
    }
    process.exit(1);
  });

  child.on('close', (code) => {
    if (code === 0) {
      process.stdout.write(\`\\n[TeamAgentX] 安装完成，使用源：\${registry}\\n\`);
      process.exit(0);
      return;
    }

    process.stderr.write(\`\\n[TeamAgentX] 当前源安装失败，退出码：\${code}\\n\`);
    if (index + 1 < registries.length) {
      process.stdout.write(\`[TeamAgentX] 切换到备用源：\${registries[index + 1]}\\n\`);
      runAttempt(index + 1);
      return;
    }

    process.exit(typeof code === 'number' ? code : 1);
  });
}

runAttempt(0);
`;

  const child = spawn(process.execPath, ['-e', installerScript, packageName, toolsDir, JSON.stringify(registries)], {
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return { child, packageName, toolsDir };
}
