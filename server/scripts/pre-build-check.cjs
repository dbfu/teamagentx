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
  console.warn("⚠️  警告: schema.prisma 比最新迁移文件更新");
  console.warn(
    "   Schema 修改时间: " +
      new Date(schemaTime).toLocaleString("zh-CN", { hour12: false })
  );
  console.warn(
    "   最新迁移时间: " +
      new Date(latestMigration.time).toLocaleString("zh-CN", { hour12: false })
  );
  console.warn("");
  console.warn("   如果修改了 schema.prisma，请运行:");
  console.warn("   pnpm db:migrate");
  console.warn("");

  if (process.env.ALLOW_STALE_MIGRATION === "1") {
    console.warn("   已设置 ALLOW_STALE_MIGRATION=1，继续打包");
  } else {
    console.warn(
      "   如确认无需新增迁移，可使用 ALLOW_STALE_MIGRATION=1 pnpm electron:build 显式跳过"
    );
    process.exit(1);
  }
}

console.log("✅ 检查通过");
