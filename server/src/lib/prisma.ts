import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import path from 'path';

// In Electron mode, DATABASE_URL is set by the main process
const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'dev.db')}`;
const adapter = new PrismaLibSql({
  url: dbUrl,
});

const prisma = new PrismaClient({ adapter });

export default prisma;