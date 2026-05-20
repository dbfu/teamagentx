import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createAcpToolInstallChildEnv,
  createAcpToolInstallPlan,
  getAcpToolInstallRegistries,
  resolveBundledNpmCli,
} from '../../../core/agent/acp-tool-install.service.js';

const originalRegistries = process.env.ACP_TOOL_INSTALL_REGISTRIES;
const originalToolsDir = process.env.TOOLS_DIR;

afterEach(() => {
  if (originalRegistries === undefined) {
    delete process.env.ACP_TOOL_INSTALL_REGISTRIES;
  } else {
    process.env.ACP_TOOL_INSTALL_REGISTRIES = originalRegistries;
  }

  if (originalToolsDir === undefined) {
    delete process.env.TOOLS_DIR;
  } else {
    process.env.TOOLS_DIR = originalToolsDir;
  }
});

describe('ACP Tool Install Service', () => {
  test('uses official registry first and domestic mirror as fallback by default', () => {
    delete process.env.ACP_TOOL_INSTALL_REGISTRIES;

    assert.deepStrictEqual(getAcpToolInstallRegistries(), [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
    ]);
  });

  test('preserves custom registry order and removes duplicates', () => {
    process.env.ACP_TOOL_INSTALL_REGISTRIES = ' https://registry.npmjs.org/ , https://registry.npmmirror.com https://registry.npmjs.org ';

    assert.deepStrictEqual(getAcpToolInstallRegistries(), [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
    ]);
  });

  test('builds install plan from selected tool and current tools directory', () => {
    process.env.TOOLS_DIR = '/tmp/teamagentx-tools';
    process.env.ACP_TOOL_INSTALL_REGISTRIES = 'https://registry.npmjs.org https://registry.npmmirror.com';

    const plan = createAcpToolInstallPlan('codex');

    assert.strictEqual(plan.packageName, '@openai/codex');
    assert.strictEqual(plan.toolsDir, '/tmp/teamagentx-tools');
    assert.deepStrictEqual(plan.registries, [
      'https://registry.npmjs.org',
      'https://registry.npmmirror.com',
    ]);
  });

  test('forces child output without color and preserves existing environment', () => {
    const env = createAcpToolInstallChildEnv({
      PATH: '/usr/local/bin',
      ELECTRON_RUN_AS_NODE: 'existing',
    }, false);

    assert.strictEqual(env.PATH, '/usr/local/bin');
    assert.strictEqual(env.FORCE_COLOR, '0');
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, 'existing');
  });

  test('runs Electron helper child processes as Node in packaged desktop runtime', () => {
    const env = createAcpToolInstallChildEnv({}, true);

    assert.strictEqual(env.FORCE_COLOR, '0');
    assert.strictEqual(env.ELECTRON_RUN_AS_NODE, '1');
  });

  test('resolves bundled npm cli when the server package includes npm', () => {
    const npmCli = resolveBundledNpmCli();

    assert.ok(npmCli, 'expected bundled npm cli to be resolvable');
    assert.ok(npmCli.endsWith('npm-cli.js'));
  });
});
