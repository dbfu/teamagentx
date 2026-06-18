import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 测试环境使用固定密钥，避免对磁盘产生副作用。
const TEST_JWT_SECRET = 'teamagentx-test-only-insecure-secret';

/**
 * 推导 JWT 密钥文件所在目录：
 * 优先放在 SQLite 数据库同级目录（桌面版为 userData，开发为 server/），
 * 远程 libsql 等非 file: 连接则落在当前工作目录。
 */
function resolveSecretFileDir(): string {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  if (url.startsWith('file:')) {
    const filePart = url.slice('file:'.length).split('?')[0];
    return path.dirname(path.resolve(filePart));
  }
  return process.cwd();
}

let cachedJwtSecret: string | undefined;

/**
 * 解析 JWT 密钥（惰性 + 记忆化）：
 * 1. 显式 JWT_SECRET 环境变量永远优先；
 * 2. 测试环境使用固定值；
 * 3. 否则从数据目录读取持久化的随机密钥，不存在则生成并写入（0600）。
 * 绝不回退到任何硬编码的可预测密钥。
 */
function resolveJwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.trim()) {
    cachedJwtSecret = fromEnv;
    return cachedJwtSecret;
  }

  if (process.env.NODE_ENV === 'test') {
    cachedJwtSecret = TEST_JWT_SECRET;
    return cachedJwtSecret;
  }

  const dir = resolveSecretFileDir();
  const secretFile = path.join(dir, '.jwt-secret');
  try {
    if (existsSync(secretFile)) {
      const existing = readFileSync(secretFile, 'utf8').trim();
      if (existing) {
        cachedJwtSecret = existing;
        return cachedJwtSecret;
      }
    }
    const generated = randomBytes(32).toString('hex');
    mkdirSync(dir, { recursive: true });
    writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    console.warn(
      `[Security] 未设置 JWT_SECRET，已在 ${secretFile} 生成持久化随机密钥。` +
        '生产部署建议显式配置 JWT_SECRET 环境变量以便集中管理与多实例共享。',
    );
    cachedJwtSecret = generated;
    return cachedJwtSecret;
  } catch (err) {
    // 文件系统不可写（如只读容器）时的兜底：使用进程内随机密钥，
    // 重启后已签发 token 会失效，但绝不使用已知的可预测密钥。
    console.error(
      `[Security] 无法持久化 JWT 密钥（${(err as Error).message}），` +
        '改用进程内随机密钥，重启后登录会话将失效。请显式配置 JWT_SECRET。',
    );
    cachedJwtSecret = randomBytes(32).toString('hex');
    return cachedJwtSecret;
  }
}

export const config = {
  server: {
    // 用 getter 动态读取 PORT：桌面版 electron-entry 在监听前才设置实际端口（11053），
    // 若在模块加载时固化为 3001，会导致内部端点（codex 路由 / MCP 工具）拼出错误端口的 URL。
    get port(): number {
      return parseInt(process.env.PORT || '3001', 10);
    },
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  database: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  toolsDir: process.env.TOOLS_DIR || '',
  agent: {
    historyThreshold: parseInt(process.env.AGENT_HISTORY_THRESHOLD || '20', 10),
    memoryRecentMessages: parseInt(process.env.AGENT_MEMORY_RECENT_MESSAGES || '10', 10),
    memoryCompactMessages: parseInt(process.env.AGENT_MEMORY_COMPACT_MESSAGES || '40', 10),
    memorySummaryTargetTokens: parseInt(process.env.AGENT_MEMORY_SUMMARY_TARGET_TOKENS || '2000', 10),
    // 日记记忆沉淀：候选信息需在「至少这么多个不同日期」被复现，才会从短期候选晋升为长期记忆。
    memoryPromoteMinDays: parseInt(process.env.AGENT_MEMORY_PROMOTE_MIN_DAYS || '3', 10),
    // 错误/教训类记忆的晋升门槛：默认 1，即出现一次就立即沉淀，避免重复踩坑。
    memoryLessonPromoteMinDays: parseInt(process.env.AGENT_MEMORY_LESSON_PROMOTE_MIN_DAYS || '1', 10),
    // 未晋升的候选记忆若超过这么多天未再出现，则丢弃，避免一次性信息长期占用候选池。
    memoryCandidateTtlDays: parseInt(process.env.AGENT_MEMORY_CANDIDATE_TTL_DAYS || '14', 10),
    // 智能协作模式下的「卡住检测」兜底：助手发完消息、房间内无在跑/排队任务且
    // 超过该延迟无新活动时，唤醒群调度助手裁决任务是否真的结束。
    stallWatchdogDelayMs: parseInt(process.env.AGENT_STALL_WATCHDOG_DELAY_MS || '180000', 10),
    // 连续救援上限：两次人类发言之间，watchdog 最多自动唤醒调度助手的次数，防止死循环。
    stallWatchdogMaxConsecutive: parseInt(process.env.AGENT_STALL_WATCHDOG_MAX_CONSECUTIVE || '5', 10),
    // 群调度助手 LLM 决策调用的超时与重试。首轮使用该超时，重试轮次使用 2 倍超时；
    // 超时后仅重试该次 LLM 决策，不重复执行已完成的派发动作。
    coordinatorLlmTimeoutMs: parseInt(process.env.AGENT_COORDINATOR_LLM_TIMEOUT_MS || '120000', 10),
    coordinatorLlmRetryCount: parseInt(process.env.AGENT_COORDINATOR_LLM_RETRY_COUNT || '1', 10),
    coordinatorLlmRetryDelayMs: parseInt(process.env.AGENT_COORDINATOR_LLM_RETRY_DELAY_MS || '1000', 10),
    // 普通助手执行启动后若 1 分钟没有任何输出/流/思考/工具事件，认为本次 attempt 卡住并重试/切换备用模型。
    // 设置 timeout 为 0 可关闭；只在首次活动前生效，已有活动的长任务不会被该计时器中断。
    executionNoActivityTimeoutMs: parseInt(process.env.AGENT_EXECUTION_NO_ACTIVITY_TIMEOUT_MS || '60000', 10),
    executionNoActivityRetryCount: parseInt(process.env.AGENT_EXECUTION_NO_ACTIVITY_RETRY_COUNT || '1', 10),
    executionNoActivityRetryDelayMs: parseInt(process.env.AGENT_EXECUTION_NO_ACTIVITY_RETRY_DELAY_MS || '1000', 10),
    // 协作预算（智能协作模式）：两次人类发言之间，助手快路径接力的最大跳数。
    // 默认 100：兼顾游戏/长流水线等轮辐式长链路，主要靠
    // 环路检测兜病态环路，跳数只做绝对保险）；可经环境变量调整。
    maxHandoffHops: parseInt(process.env.AGENT_MAX_HANDOFF_HOPS || '100', 10),
    // 环路检测：同一对助手（A↔B）之间允许「连续」往返的最大来回数，超过即熔断。
    // 判定连续乒乓而非累计重复：轮辐式协作（主持人逐一 @ 各成员）跨阶段重复同一条边是合法推进。
    handoffCycleRepeatLimit: parseInt(process.env.AGENT_HANDOFF_CYCLE_REPEAT_LIMIT || '3', 10),
  },
  jwt: {
    get secret(): string {
      return resolveJwtSecret();
    },
  },
  bridge: {
    encryptionKey: process.env.BRIDGE_ENCRYPTION_KEY || '',
    requireSignature: process.env.BRIDGE_REQUIRE_SIGNATURE === 'true',
  },
  speech: {
    edgeTtsBinary: process.env.EDGE_TTS_BINARY || 'edge-tts',
    edgeTtsDefaultVoice: process.env.EDGE_TTS_DEFAULT_VOICE || 'zh-CN-XiaoxiaoNeural',
  },
  // TEAMAGENTX_SHARED_SKILLS_DIR: 覆盖模板包技能的共享目录（默认 ~/.teamagentx/skills），
  // 测试时通过 test-bootstrap.ts 设置为临时目录
  sharedSkillsDir: process.env.TEAMAGENTX_SHARED_SKILLS_DIR || '',
};
