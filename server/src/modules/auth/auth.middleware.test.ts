import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { getInternalAgentToolToken } from '../../core/agent/agent-handler/internal-agent-tool-auth.js';
import { internalAgentToolsGateway } from '../../gateway/internal-agent-tools.gateway.js';
import { authHook } from './auth.middleware.js';

test('内部助手令牌可通过全局 authHook 到达内部工具网关', async () => {
  const app = Fastify();
  app.addHook('onRequest', authHook);
  await app.register(internalAgentToolsGateway);
  app.get('/protected-test-route', async () => ({ success: true }));

  try {
    const internalResponse = await app.inject({
      method: 'POST',
      url: '/internal/agent-tools/system-tools/list',
      headers: {
        authorization: `Bearer ${getInternalAgentToolToken()}`,
      },
      payload: {
        chatRoomId: 'auth-hook-test-room',
        sourceAgentId: 'auth-hook-test-agent',
      },
    });

    assert.equal(internalResponse.statusCode, 200);
    assert.equal(internalResponse.json().success, true);

    const invalidInternalResponse = await app.inject({
      method: 'POST',
      url: '/internal/agent-tools/system-tools/list',
      headers: {
        authorization: 'Bearer invalid-internal-token',
      },
      payload: {
        chatRoomId: 'auth-hook-test-room',
        sourceAgentId: 'auth-hook-test-agent',
      },
    });

    assert.equal(invalidInternalResponse.statusCode, 401);
    assert.equal(invalidInternalResponse.json().code, 'INVALID_TOKEN');

    const protectedResponse = await app.inject({
      method: 'GET',
      url: '/protected-test-route',
      headers: {
        authorization: `Bearer ${getInternalAgentToolToken()}`,
      },
    });

    assert.equal(protectedResponse.statusCode, 401);
    assert.equal(protectedResponse.json().code, 'INVALID_TOKEN');
  } finally {
    await app.close();
  }
});
