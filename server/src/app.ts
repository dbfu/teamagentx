import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { config } from './config/index.js';
import { initAgents, clearAllExecutionState } from './core/agent/agent-handler/index.js';
import { ensureAgentCreatorExists } from './scripts/init-agent-creator.js';
import { ensureSkillsHelperExists } from './scripts/init-skills-helper.js';
import { ensureCronTaskHelperExists } from './scripts/init-cron-task-helper.js';
import { ensureChatroomHelperExists } from './scripts/init-chatroom-helper.js';
import { ensureExternalPlatformHelperExists } from './scripts/init-external-platform-helper.js';
import { migrateAgentAvatars } from './scripts/migrate-agent-avatars.js';
import { migrateChatRoomAvatars } from './scripts/migrate-chatroom-avatars.js';
import { agentGateway } from './gateway/agent.gateway.js';
import { authGateway } from './gateway/auth.gateway.js';
import { categoryGateway } from './gateway/category.gateway.js';
import { chatRoomGateway } from './gateway/chatroom.gateway.js';
import { llmProviderGateway } from './gateway/llm-provider.gateway.js';
import { skillGateway } from './gateway/skill.gateway.js';
import { cronTaskGateway } from './gateway/cron-task.gateway.js';
import { tokenUsageGateway } from './gateway/token-usage.gateway.js';
import { internalAgentToolsGateway } from './gateway/internal-agent-tools.gateway.js';
import { registerGateways } from './gateway/index.js';
import { messageGateway } from './gateway/message.gateway.js';
import { uploadGateway } from './modules/upload/upload.gateway.js';
import { bridgeGateway, startTelegramPolling, handleBindCode } from './gateway/bridge.gateway.js';
import { initFeishuWSFromDB, setFeishuBindCodeHandler } from './modules/bridge/feishu-ws-client.js';
import { initDingtalkStreamFromDB, setDingtalkBindCodeHandler } from './modules/bridge/dingtalk-stream-client.js';
import { uploadService } from './modules/upload/upload.service.js';
import { setupSocket } from './socket/index.js';
import { cronSchedulerService } from './core/cron/cron-scheduler.service.js';
import { backgroundTaskManager } from './core/shell/background-task-manager.js';
import { taskQueueService } from './modules/task-queue/task-queue.service.js';
import { checkpointService } from './modules/checkpoint/checkpoint.service.js';
import { registerBridgePlatformAdapters } from './modules/bridge/platform-senders.js';

function findLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        ips.push(address.address);
      }
    }
  }

  return ips;
}

export async function createApp(options?: { enableSwagger?: boolean }) {
  const app = Fastify({ logger: true });
  const enableSwagger = options?.enableSwagger ?? process.env.ELECTRON !== 'true';

  // 注册 CORS
  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    strictPreflight: false,
  });

  // 注册静态文件服务（用于图片访问）
  await app.register(staticPlugin, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    maxAge: '7d',
  });

  // 初始化上传目录
  await uploadService.init();

  // 创建 Socket.io
  const io = new Server(app.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // 将 io 实例装饰到 app 上，供 gateway 使用
  app.decorate('io', io);

  // 健康检查
  app.get(
    '/health',
    async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  app.get(
    '/network-info',
    async () => {
      const localIps = findLocalIps();
      return {
        localIp: localIps[0] ?? null,
        localIps,
      };
    },
  );

  // 注册平台消息发送器
  registerBridgePlatformAdapters();

  // 注册网关
  await registerGateways(app, [
    authGateway,
    categoryGateway,
    llmProviderGateway,
    agentGateway,
    messageGateway,
    chatRoomGateway,
    skillGateway,
    cronTaskGateway,
    tokenUsageGateway,
    internalAgentToolsGateway,
    uploadGateway,
    bridgeGateway,
  ]);

  // 确保 LangGraph checkpoint 表存在
  await checkpointService.ensureTablesExist();

  // 标记所有 executing 状态的 Agent 任务为 interrupted（服务重启时保留）
  const executingInterrupted = await taskQueueService.markAsInterrupted();
  if (executingInterrupted > 0) {
    console.log(`[Startup] 已标记 ${executingInterrupted} 个执行中的 Agent 任务为中断状态`);
  }

  // 标记所有 pending 状态的任务为 interrupted（服务重启时保留）
  const pendingInterrupted = await taskQueueService.markPendingAsInterrupted();
  if (pendingInterrupted > 0) {
    console.log(`[Startup] 已标记 ${pendingInterrupted} 个待处理的 Agent 任务为中断状态`);
  }

  console.log(`[Startup] 任务队列初始化完成，共有 ${executingInterrupted + pendingInterrupted} 个任务需要恢复`);

  // 初始化 Agent（内部会清理执行状态，但不再清空任务队列）
  await initAgents();

  // 清理所有执行状态（服务重启时中断）
  clearAllExecutionState();

  // 确保助手生成器存在
  await ensureAgentCreatorExists();

  // 确保技能安装助手存在
  await ensureSkillsHelperExists();

  // 确保定时任务助手存在
  await ensureCronTaskHelperExists();

  // 确保群聊管理助手存在
  await ensureChatroomHelperExists();

  // 确保外部平台接入助手存在
  await ensureExternalPlatformHelperExists();

  // 迁移助手头像为数字索引
  await migrateAgentAvatars();

  // 迁移群聊头像为数字索引
  await migrateChatRoomAvatars();

  // 启动定时任务调度器
  await cronSchedulerService.start();

  // Telegram polling：仅当未注册 webhook 时启用（webhook 注册后自动停止轮询）
  if (process.env.TELEGRAM_POLLING !== 'false') {
    const { default: prisma } = await import('./lib/prisma.js');
    const { decrypt } = await import('./modules/bridge/crypto.js');
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'telegram' } }).catch(() => null);
    if (platformCfg?.botToken) {
      const token = decrypt(platformCfg.botToken);
      // 检查 webhook 是否已注册，已注册则不启动 polling
      // 若 webhook 注册了但最近持续出错（如 ngrok 过期），自动删除并回退 polling
      const webhookRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then(r => r.json() as Promise<{ ok: boolean; result?: { url?: string; last_error_date?: number; last_error_message?: string } }>).catch(() => null);
      const webhookUrl = webhookRes?.result?.url;
      const lastErrorDate = webhookRes?.result?.last_error_date;
      // 若 webhook 注册但近 5 分钟内有错误（过期的 ngrok 等），清除并改用 polling
      const webhookStale = webhookUrl && lastErrorDate && (Date.now() / 1000 - lastErrorDate < 300);
      if (webhookUrl && !webhookStale) {
        app.log.info('[Bridge] Telegram webhook 已注册，跳过 polling');
      } else {
        if (webhookUrl && webhookStale) {
          app.log.warn({ url: webhookUrl }, '[Bridge] Telegram webhook 近期出错，自动清除并切换为 polling');
          await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => {});
        }
        startTelegramPolling(token, app.log);
      }
    }
  }

  // 飞书 WebSocket 长连接（无需公网地址）
  setFeishuBindCodeHandler(handleBindCode);
  await initFeishuWSFromDB(app.log);

  // 钉钉 Stream 长连接（无需公网地址）
  setDingtalkBindCodeHandler(handleBindCode);
  await initDingtalkStreamFromDB(app.log);

  // 清理所有运行中的后台任务（服务重启时中断）
  await backgroundTaskManager.cleanupRunningTasks();

  // 设置 Socket.io
  setupSocket(io);

  return { app, io };
}
