import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  stripProviderConflictingClaudeSettings,
  syncGlobalClaudeCredentialsToConfigDir,
  syncGlobalClaudeLocalConfig,
  syncGlobalClaudeSettingsToConfigDir,
  syncGlobalClaudeStateToConfigDir,
} from '../../../core/agent/claude-local-config.js';

describe('Claude local config sync', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempHome: string;

  const originalKeychainDisabled =
    process.env.TEAMAGENTX_DISABLE_CLAUDE_KEYCHAIN_FALLBACK;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-home-'));
    process.env.HOME = tempHome;
    // os.homedir() 在 Windows 上读 USERPROFILE，需要同时覆盖
    process.env.USERPROFILE = tempHome;
    // 测试时禁用 macOS Keychain 回退，否则会读到开发者机器上的真实凭据
    process.env.TEAMAGENTX_DISABLE_CLAUDE_KEYCHAIN_FALLBACK = '1';
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    if (originalKeychainDisabled === undefined) {
      delete process.env.TEAMAGENTX_DISABLE_CLAUDE_KEYCHAIN_FALLBACK;
    } else {
      process.env.TEAMAGENTX_DISABLE_CLAUDE_KEYCHAIN_FALLBACK =
        originalKeychainDisabled;
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

  test('still syncs settings even when global has no auth env (cleans stale auth)', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {}}),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeSettingsToConfigDir(configDir);

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'target_missing');
    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    assert.deepStrictEqual(synced.env, {});
  });

  test('strips stale auth env from per-agent settings when global env clears them', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    // 全局 env 已经清空（用户切回 OAuth）
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {}, agentPushNotifEnabled: true}),
    );

    // per-agent 里残留之前的第三方 token + base URL
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'stale-token',
          ANTHROPIC_BASE_URL: 'https://stale.example.com',
          ANTHROPIC_MODEL: 'stale-model',
          MY_CUSTOM_VAR: 'keep-me',
        },
        outputStyle: 'Chinese',
      }),
    );

    const result = syncGlobalClaudeSettingsToConfigDir(configDir);

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'content_changed');
    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    // auth 类 env 全部被清掉
    assert.strictEqual(synced.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.strictEqual(synced.env.ANTHROPIC_BASE_URL, undefined);
    assert.strictEqual(synced.env.ANTHROPIC_MODEL, undefined);
    // 非 auth 的自定义 env 保留
    assert.strictEqual(synced.env.MY_CUSTOM_VAR, 'keep-me');
    // 非 env 的字段：全局会覆盖同名顶层 key，但 per-agent 独有字段保留
    assert.strictEqual(synced.outputStyle, 'Chinese');
    assert.strictEqual(synced.agentPushNotifEnabled, true);
  });

  test('strips stale top-level model when global no longer pins one', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    // 全局没有顶层 model（用户已切回官方订阅，让 SDK / CLI 自己选默认模型）
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {}}),
    );

    // per-agent 留着上次第三方供应商写入的 model
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({
        model: 'glm-5.1',
        outputStyle: 'Chinese',
        env: {},
      }),
    );

    const result = syncGlobalClaudeSettingsToConfigDir(configDir);
    assert.strictEqual(result.copied, true);

    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    // 陈旧的 model 必须被清掉，否则 CLI 会拿它当默认模型
    assert.strictEqual(synced.model, undefined);
    // 与 model 无关的自定义字段照常保留
    assert.strictEqual(synced.outputStyle, 'Chinese');
  });

  test('keeps top-level model when global pins one', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({model: 'opusplan', env: {}}),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({model: 'glm-5.1', env: {}}),
    );

    syncGlobalClaudeSettingsToConfigDir(configDir);

    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    assert.strictEqual(synced.model, 'opusplan');
  });

  test('returns target_current when nothing changes between syncs', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, 'settings.json'),
      JSON.stringify({env: {ANTHROPIC_AUTH_TOKEN: 'token-1'}}),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const first = syncGlobalClaudeSettingsToConfigDir(configDir);
    assert.strictEqual(first.copied, true);

    const second = syncGlobalClaudeSettingsToConfigDir(configDir);
    assert.strictEqual(second.copied, false);
    assert.strictEqual(second.reason, 'target_current');
  });

  test('provider mode strips stale ANTHROPIC_* env and top-level model from per-agent settings', () => {
    // 助手绑定了自定义 provider；settings.json 里残留旧供应商写下的 env/model
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-old-glm',
          ANTHROPIC_BASE_URL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
          ANTHROPIC_MODEL: 'glm-5',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
          API_TIMEOUT_MS: '3000000',
        },
        model: 'glm-5',
        outputStyle: 'Chinese',
      }),
    );

    const result = stripProviderConflictingClaudeSettings(configDir);

    assert.strictEqual(result.changed, true);
    assert.ok(result.removedEnvKeys.includes('ANTHROPIC_BASE_URL'));
    assert.ok(result.removedTopLevelKeys.includes('model'));

    const stripped = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf-8'),
    );
    // 冲突的 ANTHROPIC_* env 全被抹掉，provider 注入的进程 env 才能生效
    assert.strictEqual(stripped.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.strictEqual(stripped.env.ANTHROPIC_BASE_URL, undefined);
    assert.strictEqual(stripped.env.ANTHROPIC_MODEL, undefined);
    assert.strictEqual(stripped.env.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
    // 顶层陈旧 model 被抹掉
    assert.strictEqual(stripped.model, undefined);
    // 非 auth/非 model 的字段保留
    assert.strictEqual(stripped.env.API_TIMEOUT_MS, '3000000');
    assert.strictEqual(stripped.outputStyle, 'Chinese');
  });

  test('provider mode strip is a no-op when settings.json has no conflicting keys', () => {
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify({env: {API_TIMEOUT_MS: '3000000'}, outputStyle: 'Chinese'}),
    );

    const result = stripProviderConflictingClaudeSettings(configDir);
    assert.strictEqual(result.changed, false);
    assert.deepStrictEqual(result.removedEnvKeys, []);
    assert.deepStrictEqual(result.removedTopLevelKeys, []);
  });

  test('provider mode strip is a no-op when settings.json does not exist', () => {
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = stripProviderConflictingClaudeSettings(configDir);
    assert.strictEqual(result.changed, false);
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

  test('syncs ~/.claude/.credentials.json (OAuth tokens) into the isolated config dir', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    const credentials = {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-fake-access',
        refreshToken: 'sk-ant-ort01-fake-refresh',
        expiresAt: 1900000000000,
        scopes: ['user:inference'],
      },
    };
    fs.writeFileSync(
      path.join(globalClaudeDir, '.credentials.json'),
      JSON.stringify(credentials),
    );

    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeCredentialsToConfigDir(configDir);

    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'target_missing');
    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf-8'),
    );
    assert.strictEqual(synced.claudeAiOauth.accessToken, 'sk-ant-oat01-fake-access');
    assert.strictEqual(synced.claudeAiOauth.refreshToken, 'sk-ant-ort01-fake-refresh');

    // 第二次调用应返回 target_current
    const second = syncGlobalClaudeCredentialsToConfigDir(configDir);
    assert.strictEqual(second.copied, false);
    assert.strictEqual(second.reason, 'target_current');
  });

  test('credentials sync returns source_missing when host has never logged in', () => {
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    const result = syncGlobalClaudeCredentialsToConfigDir(configDir);
    assert.strictEqual(result.copied, false);
    assert.strictEqual(result.reason, 'source_missing');
  });

  test('credentials sync updates target when host tokens refresh', () => {
    const globalClaudeDir = path.join(tempHome, '.claude');
    fs.mkdirSync(globalClaudeDir, {recursive: true});
    fs.writeFileSync(
      path.join(globalClaudeDir, '.credentials.json'),
      JSON.stringify({claudeAiOauth: {accessToken: 'old-token'}}),
    );
    const configDir = path.join(tempHome, '.teamagentx', 'acp-config', 'agent-1');
    syncGlobalClaudeCredentialsToConfigDir(configDir);

    // 模拟宿主刷新了 token
    fs.writeFileSync(
      path.join(globalClaudeDir, '.credentials.json'),
      JSON.stringify({claudeAiOauth: {accessToken: 'new-token'}}),
    );
    const result = syncGlobalClaudeCredentialsToConfigDir(configDir);
    assert.strictEqual(result.copied, true);
    assert.strictEqual(result.reason, 'content_changed');
    const synced = JSON.parse(
      fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf-8'),
    );
    assert.strictEqual(synced.claudeAiOauth.accessToken, 'new-token');
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
