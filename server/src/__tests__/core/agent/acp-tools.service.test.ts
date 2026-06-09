import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkAllAcpTools, getInstalledAcpToolIds } from '../../../core/agent/acp-tools.service.js';

const CODEX_PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
};

function getCodexTargetTriple(): string {
  if (process.platform === 'linux' || process.platform === 'android') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-musl';
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-musl';
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'x86_64-apple-darwin';
    if (process.arch === 'arm64') return 'aarch64-apple-darwin';
  }
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'x86_64-pc-windows-msvc';
    if (process.arch === 'arm64') return 'aarch64-pc-windows-msvc';
  }
  throw new Error(`Unsupported test platform: ${process.platform} (${process.arch})`);
}

function writePackageJson(packageDir: string, name: string, version = '0.0.0') {
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version }), 'utf-8');
}

function writeCodexPlatformBinary(toolsDir: string) {
  const targetTriple = getCodexTargetTriple();
  const platformPackage = CODEX_PLATFORM_PACKAGE_BY_TARGET[targetTriple];
  const platformPackageDir = path.join(toolsDir, 'node_modules', ...platformPackage.split('/'));
  writePackageJson(platformPackageDir, platformPackage);

  const binaryPath = path.join(
    platformPackageDir,
    'vendor',
    targetTriple,
    'codex',
    process.platform === 'win32' ? 'codex.exe' : 'codex',
  );
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.writeFileSync(binaryPath, '');
}

describe('ACP Tools Service', () => {
  test('reports app-local SDK installation separately from host CLI availability', () => {
    const originalToolsDir = process.env.TOOLS_DIR;
    const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-tools-'));
    const codexPackageDir = path.join(toolsDir, 'node_modules', '@openai', 'codex');
    const binDir = path.join(toolsDir, 'node_modules', '.bin');

    writePackageJson(codexPackageDir, '@openai/codex');
    writeCodexPlatformBinary(toolsDir);
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'codex.cmd' : 'codex'), 'codex 0.0.0\n');
    process.env.TOOLS_DIR = toolsDir;

    try {
      const tools = checkAllAcpTools();
      const codex = tools.find((tool) => tool.id === 'codex');

      assert.ok(codex);
      assert.strictEqual(codex.sdkInstalled, true);
      assert.strictEqual(codex.installed, true);
      assert.strictEqual(codex.preferredRuntime, 'sdk');
    } finally {
      if (originalToolsDir === undefined) {
        delete process.env.TOOLS_DIR;
      } else {
        process.env.TOOLS_DIR = originalToolsDir;
      }
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  test('does not report app-local Codex SDK installed without platform optional binary', () => {
    const originalToolsDir = process.env.TOOLS_DIR;
    const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-tools-missing-bin-'));
    const codexPackageDir = path.join(toolsDir, 'node_modules', '@openai', 'codex');

    writePackageJson(codexPackageDir, '@openai/codex');
    process.env.TOOLS_DIR = toolsDir;

    try {
      const tools = checkAllAcpTools();
      const codex = tools.find((tool) => tool.id === 'codex');

      assert.ok(codex);
      assert.strictEqual(codex.sdkInstalled, false);
    } finally {
      if (originalToolsDir === undefined) {
        delete process.env.TOOLS_DIR;
      } else {
        process.env.TOOLS_DIR = originalToolsDir;
      }
      fs.rmSync(toolsDir, { recursive: true, force: true });
    }
  });

  test('installed tool ids include tools available through the local SDK package', () => {
    const tools = checkAllAcpTools();
    const codex = tools.find((tool) => tool.id === 'codex');

    assert.ok(codex);
    if (codex.installed) {
      assert.ok(getInstalledAcpToolIds().includes('codex'));
    }
  });
});
