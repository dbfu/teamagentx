#!/bin/bash
# 打包前检查：确保 schema.prisma 的变更都有对应的迁移文件
# 使用方法: ./scripts/pre-build-check.sh

set -e

cd "$(dirname "$0")/.."

echo "🔍 检查数据库迁移状态..."

# 检查 schema.prisma 最后修改时间
SCHEMA_TIME=$(stat -f %m prisma/schema.prisma 2>/dev/null || stat -c %Y prisma/schema.prisma 2>/dev/null)

# 检查最新迁移文件修改时间
LATEST_MIGRATION=$(ls -td prisma/migrations/*/ 2>/dev/null | head -1)

if [ -z "$LATEST_MIGRATION" ]; then
  echo "❌ 错误: 没有找到迁移文件"
  echo "   请运行: pnpm db:migrate"
  exit 1
fi

MIGRATION_TIME=$(stat -f %m "$LATEST_MIGRATION" 2>/dev/null || stat -c %Y "$LATEST_MIGRATION" 2>/dev/null)

# 如果 schema 比 最新迁移新，可能缺少迁移
if [ "$SCHEMA_TIME" -gt "$MIGRATION_TIME" ]; then
  echo "⚠️  警告: schema.prisma 比最新迁移文件更新"
  echo "   Schema 修改时间: $(date -r $SCHEMA_TIME '+%Y-%m-%d %H:%M:%S')"
  echo "   最新迁移时间: $(date -r $MIGRATION_TIME '+%Y-%m-%d %H:%M:%S')"
  echo ""
  echo "   如果修改了 schema.prisma，请运行:"
  echo "   pnpm db:migrate"
  echo ""
  if [ "$ALLOW_STALE_MIGRATION" = "1" ]; then
    echo "   已设置 ALLOW_STALE_MIGRATION=1，继续打包"
  else
    echo "   如确认无需新增迁移，可使用 ALLOW_STALE_MIGRATION=1 pnpm electron:build 显式跳过"
    exit 1
  fi
fi

echo "✅ 检查通过"
