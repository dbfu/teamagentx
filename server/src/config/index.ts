if (process.env.JWT_SECRET === undefined && process.env.NODE_ENV === 'production') {
  console.warn('[Security] JWT_SECRET 未设置，使用默认密钥。生产环境存在安全风险！');
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  database: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  agent: {
    historyThreshold: parseInt(process.env.AGENT_HISTORY_THRESHOLD || '20', 10),
    memoryRecentMessages: parseInt(process.env.AGENT_MEMORY_RECENT_MESSAGES || '10', 10),
    memoryCompactMessages: parseInt(process.env.AGENT_MEMORY_COMPACT_MESSAGES || '40', 10),
    memorySummaryTargetTokens: parseInt(process.env.AGENT_MEMORY_SUMMARY_TARGET_TOKENS || '2000', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'teamagentx-default-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bridge: {
    encryptionKey: process.env.BRIDGE_ENCRYPTION_KEY || '',
    requireSignature: process.env.BRIDGE_REQUIRE_SIGNATURE === 'true',
  },
};
