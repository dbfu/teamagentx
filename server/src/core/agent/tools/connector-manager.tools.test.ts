import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import { connectorService } from '../../../modules/connector/connector.service.js';
import { createMcpConnectorTool } from './connector-manager.tools.js';

describe('connector-manager.tools', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('does not save failed connectors and returns repair plan', async () => {
    mock.method(connectorService, 'getConfig', async () => ({ mcpServers: {} }));
    const mergeMock = mock.method(connectorService, 'mergeFromConfig', async () => {});
    mock.method(connectorService, 'test', async () => ({
      connected: false,
      message: 'spawn npx ENOENT',
      tools: [],
    }));

    const result = await createMcpConnectorTool.invoke({
      configJson: JSON.stringify({
        mcpServers: {
          mysql: {
            command: 'npx',
            args: ['-y', '@example/mcp-server-mysql'],
          },
        },
      }),
    }) as {
      success: boolean;
      saved: boolean;
      failedConnector: string;
      repairPlan: { suggestedActions: string[]; retryPolicy: string };
    };

    assert.equal(result.success, false);
    assert.equal(result.saved, false);
    assert.equal(result.failedConnector, 'mysql');
    assert.match(result.repairPlan.retryPolicy, /测试通过才会落库/);
    assert.ok(result.repairPlan.suggestedActions.length > 0);
    assert.equal(mergeMock.mock.callCount(), 0);
  });

  test('normalizes command lines before test and save', async () => {
    mock.method(connectorService, 'getConfig', async () => ({ mcpServers: {} }));
    const testedInputs: unknown[] = [];
    mock.method(connectorService, 'test', async (input: unknown) => {
      testedInputs.push(input);
      return {
        connected: true,
        message: 'ok',
        tools: [{ name: 'query' }],
      };
    });
    const mergeMock = mock.method(connectorService, 'mergeFromConfig', async () => {});

    const result = await createMcpConnectorTool.invoke({
      configJson: JSON.stringify({
        mcpServers: {
          mysql: {
            command: 'npx -y @example/mcp-server-mysql',
            env: { MYSQL_PORT: 3306 },
          },
        },
      }),
    }) as { success: boolean; saved: boolean };

    assert.equal(result.success, true);
    assert.equal(result.saved, true);
    assert.deepEqual(testedInputs[0], {
      name: 'mysql',
      displayName: 'mysql',
      description: null,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/mcp-server-mysql'],
      env: { MYSQL_PORT: '3306' },
      enabled: true,
    });
    assert.equal(mergeMock.mock.callCount(), 1);
    assert.deepEqual(mergeMock.mock.calls[0].arguments[0], {
      mysql: {
        command: 'npx',
        args: ['-y', '@example/mcp-server-mysql'],
        env: { MYSQL_PORT: '3306' },
      },
    });
  });
});
