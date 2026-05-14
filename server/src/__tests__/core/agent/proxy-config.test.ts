import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeAgentProxyConfig, parseProxyConfigEnv } from '../../../core/agent/proxy-config.js';

describe('Agent proxy config', () => {
  test('单个代理地址会写入大小写代理环境变量', () => {
    const env = parseProxyConfigEnv('http://127.0.0.1:7890');

    assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.http_proxy, 'http://127.0.0.1:7890');
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.https_proxy, 'http://127.0.0.1:7890');
    assert.equal(env.ALL_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.all_proxy, 'http://127.0.0.1:7890');
  });

  test('支持粘贴 export 片段', () => {
    const env = parseProxyConfigEnv(
      'export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890',
    );

    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890');
    assert.equal(env.ALL_PROXY, 'socks5://127.0.0.1:7890');
  });

  test('拒绝非代理协议并把空字符串归一为空配置', () => {
    assert.equal(normalizeAgentProxyConfig('   '), null);
    assert.throws(
      () => normalizeAgentProxyConfig('file:///tmp/socket'),
      /代理地址仅支持/,
    );
  });
});
