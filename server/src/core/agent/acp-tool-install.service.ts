import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/index.js';

export const ACP_TOOL_PACKAGES: Record<string, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
};

export function getAcpToolPackageName(toolId: string): string | undefined {
  return ACP_TOOL_PACKAGES[toolId];
}

export function getAcpToolsDir(): string {
  return config.toolsDir || path.join(process.cwd(), '.tools');
}

export function spawnAcpToolInstall(toolId: string) {
  const packageName = getAcpToolPackageName(toolId);
  if (!packageName) {
    throw new Error('不支持的工具');
  }

  const toolsDir = getAcpToolsDir();
  fs.mkdirSync(toolsDir, { recursive: true });

  const child = spawn('npm', ['install', '--prefix', `"${toolsDir}"`, packageName, '--force'], {
    env: { ...process.env, FORCE_COLOR: '0' },
    shell: true,
  });

  return { child, packageName, toolsDir };
}
