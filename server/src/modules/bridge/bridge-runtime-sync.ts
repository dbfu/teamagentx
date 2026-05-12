import prisma from '../../lib/prisma.js';
import { parseStoredBridgeConfig, resolveStoredBridgeBotToken } from './bridge-platform-config.js';
import { startFeishuWSClient, stopFeishuWSClient } from './feishu-ws-client.js';
import { startDingtalkStreamClient, stopDingtalkStreamClient } from './dingtalk-stream-client.js';
import type { Platform } from './bridge.service.js';

type BridgeLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export async function syncBridgePlatformRuntime(
  platform: Platform,
  storedConfig: { botToken?: string | null; config?: string | null },
  log: BridgeLogger,
): Promise<void> {
  if (platform === 'telegram') {
    const token = resolveStoredBridgeBotToken(storedConfig);
    if (!token) return;
    const sys = await prisma.platformConfig.findUnique({ where: { platform: 'system' } }).catch((err) => { log.warn({ err }, '[Bridge] runtime-sync DB 查询失败'); return null; });
    let baseUrl = '';
    try {
      const parsed = sys?.config ? (JSON.parse(sys.config) as { baseUrl?: string }) : null;
      baseUrl = parsed?.baseUrl ?? '';
    } catch {
      log.warn('[Bridge] system config JSON 解析失败');
    }
    if (!baseUrl) return;

    try {
      const result = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${baseUrl}/api/bridge/webhook/telegram` }),
      });
      const json = await result.json() as { ok?: boolean; description?: string };
      if (!json.ok) {
        log.warn({ description: json.description }, '[Bridge] Telegram setWebhook 失败');
      } else {
        log.info('[Bridge] Telegram webhook 已同步');
      }
    } catch (error) {
      log.warn({ error }, '[Bridge] Telegram webhook 同步失败');
    }
    return;
  }

  if (platform === 'feishu') {
    const feishuCfg = parseStoredBridgeConfig(storedConfig) as { appId?: string; appSecret?: string } | null;
    if (feishuCfg?.appId && feishuCfg.appSecret) {
      await startFeishuWSClient(feishuCfg.appId, feishuCfg.appSecret, log);
    } else {
      stopFeishuWSClient();
    }
    return;
  }

  if (platform === 'dingtalk') {
    const ddCfg = parseStoredBridgeConfig(storedConfig) as { appKey?: string; appSecret?: string } | null;
    if (ddCfg?.appKey && ddCfg.appSecret) {
      await startDingtalkStreamClient(ddCfg.appKey, ddCfg.appSecret, log);
    } else {
      stopDingtalkStreamClient();
    }
  }
}
