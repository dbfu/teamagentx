import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  syncGlobalClaudeLocalConfig,
  syncGlobalClaudeSettingsToConfigDir,
  syncGlobalClaudeStateToConfigDir,
} from '../../../core/agent/claude-local-config.js';

describe('Claude local config sync', () => {
  const originalHome = process.env.HOME;
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-home-'));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, {recursive: true, force: true});
  });

  test('syncs ~/.claude/settings.json into the isolated config dir when auth env exists', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'token-1',
          ANTHROPIC_BASE_URL: 'https://example.com',
          ANTHROPIC_MODEL: 'test-model',
        },
        model: 'test-model',
      }),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeSettingsToConfigDir(configDir);

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'target_missing');

    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    assert.strictEqual(synced.env.ANTHROPIC_AUTH_TOKEN, 'token-1');
    assert.strictEqual(synced.env.ANTHROPIC_BASE_URL, 'https://example.com');
    assert.strictEqual(synced.model, 'test-model');
  });

  test('does not create an isolated settings file when global settings has no auth env', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {ANTHROPIC_MODEL: 'test-model'}}),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeSettingsToConfigDir(configDir);

    assert.strictEqual(result.copied, false);
    assert.strictEqual(result.reason, 'source_without_auth_env');
    assert.strictEqual(fs.existsSync(path.join(configDir, 'settings.json')), false);
  });

  test('syncs official Claude account state from ~/.claude.json', () => {
    fs.writeFileSync(
      path.join(tempHome, '.claude.json'),
      JSON.stringify({
        userID: 'official-user-id',
        hasCompletedOnboarding: true,
        firstStartTime: '2026-01-01T00:00:00.000Z',
        projects: {'/private/project': {lastCost: 1}},
      }),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeStateToConfigDir(configDir);

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'target_missing');

    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, '.claude.json'), 'utf-8'),
    );
    assert.strictEqual(synced.userID, 'official-user-id');
    assert.strictEqual(synced.hasCompletedOnboarding, true);
    assert.strictEqual(synced.projects, undefined);
  });

  test('syncs third-party API settings and official account state together', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {ANTHROPIC_AUTH_TOKEN: 'token-1'}}),
    );
    fs.writeFileSync(
      path.join(tempHome, '.claude.json'),
      JSON.stringify({userID: 'official-user-id'}),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeLocalConfig(configDir);

    assert.strictEqual(result.settings.copied, true);
    assert.strictEqual(result.state.copied, true);
    assert.strictEqual(fs.existsSync(path.join(configDir, 'settings.json')), true);
    assert.strictEqual(fs.existsSync(path.join(configDir, '.claude.json')), true);
  });
});
