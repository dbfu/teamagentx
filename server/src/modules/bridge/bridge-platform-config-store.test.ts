import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../../lib/prisma.js';
import { saveBridgePlatformConfig } from './bridge-platform-config-store.js';

test('saveBridgePlatformConfig clears bot token and config when explicit empty values are provided', async () => {
  const originalUpsert = prisma.platformConfig.upsert;

  let upsertArgs: unknown;
  (prisma.platformConfig as unknown as { upsert: typeof prisma.platformConfig.upsert }).upsert = (async (args: unknown) => {
    upsertArgs = args;
    return {
      platform: 'telegram',
      botToken: null,
      config: null,
      defaultAgentId: null,
      defaultAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }) as unknown as typeof prisma.platformConfig.upsert;

  try {
    const result = await saveBridgePlatformConfig('telegram', {
      botToken: '',
      config: null,
    });

    const payload = upsertArgs as {
      create: { botToken: null; config: null };
      update: { botToken: null; config: null };
    };

    assert.equal(payload.create.botToken, null);
    assert.equal(payload.create.config, null);
    assert.equal(payload.update.botToken, null);
    assert.equal(payload.update.config, null);
    assert.equal(result.botToken, null);
    assert.equal(result.config, null);
  } finally {
    (prisma.platformConfig as unknown as { upsert: typeof prisma.platformConfig.upsert }).upsert = originalUpsert;
  }
});
