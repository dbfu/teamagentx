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
}

export default prisma;