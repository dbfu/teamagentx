import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import path from 'path';

// In Electron mode, DATABASE_URL is set by the main process
const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'dev.db')}`;
const adapter = new PrismaLibSql({
  url: dbUrl,
});

const prisma = new PrismaClient({ adapter });

export async function initDb(): Promise<void> {
  await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000');

  // 记录 PRAGMA 实际生效结果，便于排查 WAL 未生效（例如网络/只读文件系统）等问题
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>(
      'PRAGMA journal_mode'
    );
    const journalMode = rows?.[0]?.journal_mode ?? 'unknown';
    console.info(`[prisma] SQLite journal_mode: ${journalMode}`);
  } catch (err) {
    console.warn('[prisma] 读取 PRAGMA journal_mode 失败', err);
  }
}

export default prisma;