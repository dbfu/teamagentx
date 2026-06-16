import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConnector,
  toClaudeMcpServers,
  toCodexMcpServers,
} from '../../../core/agent/connector.adapter.js';

describe('connector.adapter', () => {
  test('normalizes JSON fields and coerces env/header values to strings', () => {
    const connector = normalizeConnector({
      id: 'connector-1',
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: '["-y",123,null]',
      env: '{"TOKEN":"abc","RETRY":3,"EMPTY":null}',
      headers: '{"Authorization":"Bearer token","X-Retry":2}',
    });

    assert.deepEqual(connector, {
      id: 'connector-1',
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '123'],
      env: { TOKEN: 'abc', RETRY: '3' },
      url: undefined,
      headers: { Authorization: 'Bearer token', 'X-Retry': '2' },
    });
  });

  test('builds Claude MCP server configs for stdio and HTTP connectors', () => {
    const configs = toClaudeMcpServers([
      normalizeConnector({
        id: 'stdio-1',
        name: 'filesystem',
        transport: 'stdio',
        command: 'node',
        args: '["server.js"]',
        env: '{"ROOT":"/tmp"}',
      }),
      normalizeConnector({
        id: 'http-1',
        name: 'remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: '{"Authorization":"Bearer token"}',
      }),
    ]) as Record<string, any>;

    assert.deepEqual(configs.filesystem, {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { ROOT: '/tmp' },
    });
    assert.deepEqual(configs.remote, {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });
  });

  test('builds Codex MCP server configs and drops incomplete connectors', () => {
    const configs = toCodexMcpServers([
      normalizeConnector({
        id: 'stdio-1',
        name: 'filesystem',
        transport: 'stdio',
        command: 'node',
        args: '["server.js"]',
        env: '{}',
      }),
      normalizeConnector({
        id: 'http-1',
        name: 'remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: '{"Authorization":"Bearer token"}',
      }),
      normalizeConnector({
        id: 'bad-1',
        name: 'bad',
        transport: 'stdio',
        args: '[]',
      }),
    ]);

    assert.deepEqual(configs.filesystem, {
      command: 'node',
      args: ['server.js'],
    });
    assert.deepEqual(configs.remote, {
      url: 'https://example.com/mcp',
      http_headers: { Authorization: 'Bearer token' },
    });
    assert.equal(configs.bad, undefined);
  });
});
