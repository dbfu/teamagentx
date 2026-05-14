import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '../..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-server-tests-'));
const databasePath = path.join(tempRoot, 'test.db');

process.env.DATABASE_URL = `file:${databasePath}`;

const cleanup = () => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
};

process.once('exit', cleanup);
process.once('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

const migrationsRoot = path.join(serverRoot, 'prisma', 'migrations');
const migrationDirs = fs.readdirSync(migrationsRoot)
  .map((name) => path.join(migrationsRoot, name))
  .filter((fullPath) => fs.statSync(fullPath).isDirectory())
  .sort();

for (const migrationDir of migrationDirs) {
  const migrationSqlPath = path.join(migrationDir, 'migration.sql');
  if (!fs.existsSync(migrationSqlPath)) {
    continue;
  }

  execFileSync('sqlite3', [databasePath], {
    cwd: serverRoot,
    input: fs.readFileSync(migrationSqlPath),
    stdio: ['pipe', 'ignore', 'pipe'],
  });
}
