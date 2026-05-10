import { createClient, Client } from '@libsql/client';
import path from 'path';

/**
 * 创建 libsql client 实例
 * 复用项目现有的数据库连接逻辑
 */
export function createLibSqlClient(): Client {
  // In Electron mode, DATABASE_URL is set by the main process
  const dbUrl =
    process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'dev.db')}`;
  return createClient({ url: dbUrl });
}

// 单例模式
let client: Client | null = null;

/**
 * 获取 libsql client 单例
 * 用于 checkpoint 持久化和其他直接数据库操作
 */
export function getLibSqlClient(): Client {
  if (!client) {
    client = createLibSqlClient();
  }
  return client;
}