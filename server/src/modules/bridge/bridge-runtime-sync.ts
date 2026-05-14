import prisma from '../../lib/prisma.js';
import { parseStoredBridgeConfig, resolveStoredBridgeBotToken } from './bridge-platform-config.js';
import { startFeishuWSClient, stopFeishuWSClient } from './feishu-ws-client.js';
import { startDingtalkStreamClient, stopDingtalkStreamClient } from './dingtalk-stream-client.js';
import { getTelegramPolling } from './telegram-polling-registry.js';

type BridgeLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export async function syncBridgeBotRuntime(botId: string, log: BridgeLogger): Promise<void> {
  const bot = await prisma.bridgeBot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      platform: true,
      enabled: true,
      botToken: true,
      config: true,
    },
  });

  if (!bot || !bot.enabled) {
    getTelegramPolling()?.stop(botId);
    stopFeishuWSClient(botId);
    stopDingtalkStreamClient(botId);
    return;
  }

  if (bot.platform === 'telegram') {
    const token = resolveStoredBridgeBotToken(bot);
    if (!token) {
      getTelegramPolling()?.stop(botId);
      return;
    }

    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => {});
    } catch {
      // ignore delete webhook failure and keep polling fallback
    }
    getTelegramPolling()?.start(botId, token, log);
    return;
  }

  if (bot.platform === 'feishu') {
    const feishuCfg = parseStoredBridgeConfig(bot) as { appId?: string; appSecret?: string } | null;
    if (feishuCfg?.appId && feishuCfg.appSecret) {
      await startFeishuWSClient(botId, feishuCfg.appId, feishuCfg.appSecret, log);
    } else {
      stopFeishuWSClient(botId);
    }
    return;
  }

  if (bot.platform === 'dingtalk') {
    const ddCfg = parseStoredBridgeConfig(bot) as { appKey?: string; appSecret?: string } | null;
    if (ddCfg?.appKey && ddCfg.appSecret) {
      await startDingtalkStreamClient(botId, ddCfg.appKey, ddCfg.appSecret, log);
    } else {
      stopDingtalkStreamClient(botId);
    }
    return;
  }
}

export async function syncAllBridgeBotsRuntime(log: BridgeLogger): Promise<void> {
  const bots = await prisma.bridgeBot.findMany({
    select: { id: true },
  });

  const results = await Promise.allSettled(
    bots.map(bot => syncBridgeBotRuntime(bot.id, log).catch(err => {
      log.error({ err, botId: bot.id }, '[Bridge] sync failed');
    })),
  );
  results.forEach(r => {
    if (r.status === 'rejected') log.error({ err: r.reason }, '[Bridge] bot sync failed');
  });
}
