import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkAllAcpTools, getInstalledAcpToolIds } from '../../../core/agent/acp-tools.service.js';

describe('ACP Tools Service', () => {
  test('reports app-local SDK installation separately from host CLI availability', () => {
    const originalToolsDir = process.env.TOOLS_DIR;
    const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-tools-'));
    const codexPackageDir = path.join(toolsDir, 'node_modules', '@openai', 'codex');
    const binDir = path.join(toolsDir, 'node_modules', '.bin');

    fs.mkdirSync(codexPackageDir, { recursive: true });
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

  test('installed tool ids include tools available through the local SDK package', () => {
    const tools = checkAllAcpTools();
    const codex = tools.find((tool) => tool.id === 'codex');

    assert.ok(codex);
    if (codex.installed) {
      assert.ok(getInstalledAcpToolIds().includes('codex'));
    }
  });
});
