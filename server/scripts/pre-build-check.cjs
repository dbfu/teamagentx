#!/usr/bin/env node
// 打包前检查：确保 schema.prisma 的变更都有对应的迁移文件

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "prisma", "schema.prisma");
const migrationsDir = path.join(root, "prisma", "migrations");

console.log("🔍 检查数据库迁移状态...");

if (!fs.existsSync(migrationsDir)) {
  console.error("❌ 错误: 没有找到迁移文件");
  console.error("   请运行: pnpm db:migrate");
  process.exit(1);
}

const schemaTime = fs.statSync(schemaPath).mtimeMs;

const entries = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({
    name: d.name,
    time: fs.statSync(path.join(migrationsDir, d.name)).mtimeMs,
  }))
  .sort((a, b) => b.time - a.time);

if (entries.length === 0) {
  console.error("❌ 错误: 没有找到迁移文件");
  console.error("   请运行: pnpm db:migrate");
  process.exit(1);
}

const latestMigration = entries[0];

// 毫秒精度差异可能导致同秒误判，取整到秒比较
const schemaSec = Math.floor(schemaTime / 1000);
const migrationSec = Math.floor(latestMigration.time / 1000);

if (schemaSec > migrationSec) {
  console.warn("⚠️  警告: schema.prisma 比最新迁移文件更新（时间戳）");
  console.warn(
    "   Schema 修改时间: " +
      new Date(schemaTime).toLocaleString("zh-CN", { hour12: false })
  );
  console.warn(
    "   最新迁移时间: " +
      new Date(latestMigration.time).toLocaleString("zh-CN", { hour12: false })
  );
  console.warn("");

  if (process.env.ALLOW_STALE_MIGRATION === "1") {
    console.warn("   已设置 ALLOW_STALE_MIGRATION=1，继续打包");
  } else {
    // 用 prisma migrate status 做实际内容校验，避免 db:generate 更新 mtime 导致误判
    const { execSync } = require("child_process");
    try {
      const output = execSync("npx prisma migrate status 2>&1", {
        cwd: root,
        encoding: "utf-8",
      });
      if (output.includes("Database schema is up to date")) {
        console.warn("   prisma migrate status: 数据库已是最新，时间戳为误判，继续打包");
      } else {
        console.error("❌ 错误: 存在未应用的迁移，请运行 pnpm db:migrate");
        process.exit(1);
      }
    } catch {
      console.warn("   无法连接数据库验证迁移状态，请运行 pnpm db:migrate 确认");
      console.warn("   如确认无需新增迁移，可使用 ALLOW_STALE_MIGRATION=1 显式跳过");
      process.exit(1);
    }
  }
}

console.log("✅ 检查通过");
