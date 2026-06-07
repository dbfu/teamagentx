import { createClient, Client } from '@libsql/client';
import path from 'path';

// 单例模式
let client: Client | null = null;

export function getLibSqlClient(): Client {
  if (!client) {
    const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'dev.db')}`;
    client = createClient({ url: dbUrl });
  }
  return client;
}
