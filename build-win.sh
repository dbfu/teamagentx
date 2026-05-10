#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 计时开始
START_TIME=$(date +%s)

# 清理函数
cleanup() {
  local exit_code=$?
  END_TIME=$(date +%s)
  ELAPSED=$((END_TIME - START_TIME))
  echo ""
  if [ $exit_code -eq 0 ]; then
    log_info "Build completed in ${ELAPSED}s"
  else
    log_error "Build failed (exit code $exit_code) after ${ELAPSED}s"
  fi
  exit $exit_code
}

trap cleanup EXIT

# 检查依赖
if ! command -v pnpm &> /dev/null; then
  log_error "pnpm is not installed. Please install pnpm first."
  exit 1
fi

echo "======================================="
echo "  TeamAgentX Desktop Build (Windows)"
echo "======================================="
echo ""

# Step 1: 编译后端
log_info "Step 1/4: Building server..."
cd "$SCRIPT_DIR/server"
pnpm db:generate && pnpm build && pnpm prebuild:electron
if [ $? -ne 0 ]; then
  log_error "Server build failed"
  exit 1
fi
log_info "Server build done"
echo ""

# Step 2: 部署生产依赖
log_info "Step 2/4: Deploying production dependencies..."
cd "$SCRIPT_DIR"
pnpm --filter=server deploy server/node_modules-prod --prod --frozen-lockfile --force
if [ $? -ne 0 ]; then
  log_error "Production dependency deployment failed"
  exit 1
fi
cd "$SCRIPT_DIR/server"
pnpm verify:electron-deps && pnpm sync:prisma:prod
if [ $? -ne 0 ]; then
  log_error "Electron dependency verification failed"
  exit 1
fi
log_info "Production dependencies deployed"
echo ""

# Step 3: 编译前端
log_info "Step 3/4: Building renderer..."
cd "$SCRIPT_DIR/apps/desktop"
pnpm typecheck
if [ $? -ne 0 ]; then
  log_error "TypeScript type check failed"
  exit 1
fi
pnpm exec tsc -p ../web/tsconfig.json
if [ $? -ne 0 ]; then
  log_error "Frontend TypeScript compilation failed"
  exit 1
fi
cd ../web && pnpm exec vite --config ../desktop/vite.config.ts --mode electron build
if [ $? -ne 0 ]; then
  log_error "Vite build failed"
  exit 1
fi
log_info "Renderer build done"
echo ""

# Step 4: 打包 Windows
log_info "Step 4/4: Packaging Windows installer..."
cd "$SCRIPT_DIR/apps/desktop"
pnpm electron-builder --win nsis
if [ $? -ne 0 ]; then
  log_error "Windows packaging failed"
  exit 1
fi
echo ""

# 输出产物
echo "======================================="
log_info "Build successful!"
echo ""

RELEASE_DIR="$SCRIPT_DIR/apps/desktop/release"
if [ -d "$RELEASE_DIR" ]; then
  log_info "Output files:"
  ls -lh "$RELEASE_DIR"/*.{exe,blockmap} 2>/dev/null | while read line; do
    echo "  $line"
  done
  echo ""
  log_info "Release directory: $RELEASE_DIR"
fi

echo "======================================="
