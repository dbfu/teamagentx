import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sanitizeAgentChildEnv } from '../../../core/agent/agent-child-env.js';

describe('sanitizeAgentChildEnv', () => {
  test('removes the TeamAgentX host PORT before spawning agents and MCP servers', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      PORT: '11053',
      TEAMAGENTX_INTERNAL_TOOL_TOKEN: 'token',
      UNDEFINED_VALUE: undefined,
    };

    const result = sanitizeAgentChildEnv(source);

    assert.deepEqual(result, {
      PATH: '/usr/bin',
      TEAMAGENTX_INTERNAL_TOOL_TOKEN: 'token',
    });
    assert.equal(source.PORT, '11053');
  });
});
