import { createApp } from './app.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  try {
    const projectRoot = path.resolve(__dirname, '..');
    const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
    const migrationsPath = path.join(projectRoot, 'prisma', 'migrations');

    console.log('[electron-entry] Running Prisma migrations...');
    console.log('[electron-entry] Project root:', projectRoot);

    const nodePath = process.env.NODE_PATH || '';

    if (!nodePath) {
      // Dev mode: use npx
      const { execSync } = await import('child_process');
      execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } else {
      // Production mode: Execute migrations directly using libsql
      const fs = await import('fs');
      const dbPath = process.env.DATABASE_URL?.replace('file:', '') || path.join(projectRoot, 'dev.db');
      console.log('[electron-entry] Database path:', dbPath);

      // Import libsql client
      const { createClient } = await import('@libsql/client');
      const dbClient = createClient({ url: `file:${dbPath}` });

      // Create _prisma_migrations tracking table if not exists
      await dbClient.execute(`
        CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          finished_at DATETIME,
          migration_name TEXT NOT NULL,
          logs TEXT,
          rolled_back_at DATETIME,
          started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          applied_steps_count INTEGER UNSIGNED DEFAULT 0
        )
      `);

      const getExistingColumnNames = async (tableName: string) => {
        const pragmaResult = await dbClient.execute(`PRAGMA table_info("${tableName}")`);
        return new Set(pragmaResult.rows.map((row) => String(row.name)));
      };

      const getExistingIndexNames = async (tableName: string) => {
        const pragmaResult = await dbClient.execute(`PRAGMA index_list("${tableName}")`);
        return new Set(pragmaResult.rows.map((row) => String(row.name)));
      };

      const ensureChatRoomPinnedSchema = async () => {
        const existingColumns = await getExistingColumnNames('ChatRoom');

        if (!existingColumns.has('isPinned')) {
          console.log('[electron-entry] Adding missing ChatRoom.isPinned column');
          await dbClient.execute(
            'ALTER TABLE "ChatRoom" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false'
          );
        }

        if (!existingColumns.has('pinnedAt')) {
          console.log('[electron-entry] Adding missing ChatRoom.pinnedAt column');
          await dbClient.execute(
            'ALTER TABLE "ChatRoom" ADD COLUMN "pinnedAt" DATETIME'
          );
        }

        const existingIndexes = await getExistingIndexNames('ChatRoom');
        if (!existingIndexes.has('ChatRoom_isPinned_pinnedAt_idx')) {
          console.log('[electron-entry] Creating missing ChatRoom_isPinned_pinnedAt_idx index');
          await dbClient.execute(
            'CREATE INDEX IF NOT EXISTS "ChatRoom_isPinned_pinnedAt_idx" ON "ChatRoom"("isPinned", "pinnedAt")'
          );
        }
      };

      // Get list of applied migrations
      const appliedResult = await dbClient.execute(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
      );
      const appliedMigrations = new Set(appliedResult.rows.map(r => r.migration_name as string));

      // Read all migration directories
      const migrationDirs = fs.readdirSync(migrationsPath)
        .filter(f => {
          const fullPath = path.join(migrationsPath, f);
          return fs.statSync(fullPath).isDirectory() && fs.existsSync(path.join(fullPath, 'migration.sql'));
        })
        .sort();

      // Apply each migration that hasn't been applied
      for (const migrationName of migrationDirs) {
        if (appliedMigrations.has(migrationName)) {
          console.log(`[electron-entry] Migration ${migrationName} already applied, skipping`);
          continue;
        }

        const migrationSqlPath = path.join(migrationsPath, migrationName, 'migration.sql');
        console.log(`[electron-entry] Applying migration: ${migrationName}`);

        const sqlContent = fs.readFileSync(migrationSqlPath, 'utf-8');

        // Record migration start
        const migrationId = `${migrationName}-${Date.now()}`;
        await dbClient.execute(
          `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ('${migrationId}', 'manual', '${migrationName}', datetime('now'))`
        );

        // Parse SQL statements - handle PRAGMA and multi-line statements correctly
        const statements: string[] = [];
        let currentStatement = '';

        // Split by lines and reconstruct statements
        const lines = sqlContent.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip comments and empty lines
          if (trimmed.startsWith('--') || trimmed.startsWith('/*') || trimmed.length === 0) {
            continue;
          }

          currentStatement += line + '\n';

          // Check if statement is complete (ends with semicolon)
          if (trimmed.endsWith(';')) {
            const stmt = currentStatement.trim();
            if (stmt.length > 0) {
              statements.push(stmt);
            }
            currentStatement = '';
          }
        }

        // Add any remaining statement without semicolon
        if (currentStatement.trim().length > 0) {
          statements.push(currentStatement.trim());
        }

        // Execute each statement individually
        // SQLite automatically handles transactions for single statements
        let success = true;
        for (const statement of statements) {
          try {
            console.log(`[electron-entry] Executing: ${statement.substring(0, 50)}...`);
            await dbClient.execute(statement);
          } catch (e: any) {
            // Some statements may fail if the object already exists (e.g., ALTER TABLE ADD COLUMN)
            // We continue but log the error
            console.log(`[electron-entry] Statement error (continuing): ${e.message}`);
            // Only mark as failure if it's a critical error (e.g., CREATE TABLE fails with non-duplicate reason)
            if (statement.includes('CREATE TABLE') && !e.message.includes('already exists')) {
              success = false;
            }
            // ALTER TABLE ADD COLUMN fails with "duplicate column" is OK (column already exists)
            if (statement.includes('ALTER TABLE') && statement.includes('ADD COLUMN') && !e.message.includes('duplicate column')) {
              success = false;
            }
          }
        }

        // Mark migration as finished or log failure
        if (success) {
          await dbClient.execute(
            `UPDATE "_prisma_migrations" SET finished_at = datetime('now'), applied_steps_count = 1 WHERE id = '${migrationId}'`
          );
          console.log(`[electron-entry] Migration ${migrationName} applied successfully`);
        } else {
          await dbClient.execute(
            `UPDATE "_prisma_migrations" SET logs = 'Migration had critical failures' WHERE id = '${migrationId}'`
          );
          console.log(`[electron-entry] Migration ${migrationName} had critical failures`);
        }
      }

      // Production desktop users may carry forward an older DB that predates the pinned-chat migration.
      await ensureChatRoomPinnedSchema();
    }

    console.log('[electron-entry] Migrations completed');
  } catch (error: any) {
    console.error('[electron-entry] Migration failed:', error.message);
    console.log('[electron-entry] Continuing anyway...');
  }
}

async function startForElectron() {
  // Run migrations first
  await runMigrations();

  // Electron 模式下禁用 Swagger（减少打包体积）
  const { app } = await createApp({ enableSwagger: false });
  // Electron 打包时固定端口为 11053
  const port = 11053;
  await app.listen({ port });
  console.log(`__ELECTRON_PORT__:${port}`);
}

startForElectron().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
