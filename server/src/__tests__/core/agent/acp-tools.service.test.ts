import { describe, test } from 'node:test';
import assert from 'node:assert';
import { checkAllAcpTools, getInstalledAcpToolIds } from '../../../core/agent/acp-tools.service.js';

describe('ACP Tools Service', () => {
  test('Codex is available through the bundled SDK and does not require a local CLI', () => {
    const tools = checkAllAcpTools();
    const codex = tools.find((tool) => tool.id === 'codex');

    assert.ok(codex);
    assert.strictEqual(codex.installed, true);
    assert.ok(getInstalledAcpToolIds().includes('codex'));
  });
});
