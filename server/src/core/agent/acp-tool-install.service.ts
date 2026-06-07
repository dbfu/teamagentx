import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { config } from '../../config/index.js';

const requireFromHere = createRequire(import.meta.url);

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

export function createAcpToolInstallChildEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  isElectronRuntime: boolean = Boolean(process.versions.electron),
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    FORCE_COLOR: '0',
    ...(isElectronRuntime ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
}

export function resolveBundledNpmCli(): string | undefined {
  try {
    const packageJsonPath = requireFromHere.resolve('npm/package.json');
    const resolved = path.join(path.dirname(packageJsonPath), 'bin', 'npm-cli.js');
    return fs.existsSync(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

export function spawnAcpToolInstall(toolId: string) {
  const { packageName, registries, toolsDir } = createAcpToolInstallPlan(toolId);
  fs.mkdirSync(toolsDir, { recursive: true });
  const bundledNpmCli = resolveBundledNpmCli();

  const installerScript = `
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageName = process.argv[1];
const toolsDir = process.argv[2];
const registries = JSON.parse(process.argv[3]);
const bundledNpmCli = process.argv[4] || '';

function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\\\''") + "'";
}

function ensureNodeShim() {
  const shimDir = path.join(toolsDir, '.teamagentx-node-bin');
  fs.mkdirSync(shimDir, { recursive: true });

  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'node.cmd');
    fs.writeFileSync(
      shimPath,
      '@echo off\\r\\nset ELECTRON_RUN_AS_NODE=1\\r\\n"' + process.execPath + '" %*\\r\\n',
      'utf8',
    );
    return shimDir;
  }

  const shimPath = path.join(shimDir, 'node');
  fs.writeFileSync(
    shimPath,
    '#!/bin/sh\\nexport ELECTRON_RUN_AS_NODE=1\\nexec ' + quotePosix(process.execPath) + ' "$@"\\n',
    'utf8',
  );
  fs.chmodSync(shimPath, 0o755);
  return shimDir;
}

const pathSeparator = process.platform === 'win32' ? ';' : ':';
const nodeShimDir = ensureNodeShim();
const childEnv = {
  ...process.env,
  FORCE_COLOR: '0',
  PATH: [nodeShimDir, process.env.PATH || ''].filter(Boolean).join(pathSeparator),
};
if (bundledNpmCli) {
  childEnv.ELECTRON_RUN_AS_NODE = '1';
}

function runAttempt(index) {
  const registry = registries[index];
  if (!registry) {
    process.exit(1);
    return;
  }

  process.stdout.write(\`\\n[TeamAgentX] 正在安装 \${packageName}（源 \${index + 1}/\${registries.length}）：\${registry}\\n\`);
  if (bundledNpmCli) {
    process.stdout.write(\`[TeamAgentX] 使用内置 npm：\${bundledNpmCli}\\n\`);
  }

  const child = spawn(
    bundledNpmCli ? process.execPath : npmCmd,
    [...(bundledNpmCli ? [bundledNpmCli] : []), 'install', '--prefix', toolsDir, packageName, '--force', '--registry', registry],
    {
      env: childEnv,
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

  const child = spawn(process.execPath, ['-e', installerScript, packageName, toolsDir, JSON.stringify(registries), bundledNpmCli || ''], {
    env: createAcpToolInstallChildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return { child, packageName, toolsDir };
}
