import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getClaudeRuntimeMcpConnectorsSection } from '../../../core/agent/agent-system-prompt.js';

describe('getClaudeRuntimeMcpConnectorsSection', () => {
  test('returns no section when the assistant has no runtime connectors', () => {
    assert.equal(getClaudeRuntimeMcpConnectorsSection([], 'zh-CN'), '');
  });

  test('tells Claude to wait for runtime MCP tools instead of reinstalling them', () => {
    const section = getClaudeRuntimeMcpConnectorsSection(
      ['drawio', 'drawio', 'github'],
      'zh-CN',
    );

    assert.match(section, /`drawio`/);
    assert.match(section, /`github`/);
    assert.match(section, /WaitForMcpServers/);
    assert.match(section, /不要用 `claude mcp list`/);
    assert.match(section, /不要自行执行 `claude mcp add\/remove`/);
  });
});
