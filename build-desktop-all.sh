#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

START_TIME=$(date +%s)

cleanup() {
  local exit_code=$?
  local end_time
  local elapsed
  end_time=$(date +%s)
  elapsed=$((end_time - START_TIME))
  echo ""
  if [ "$exit_code" -eq 0 ]; then
    log_info "Build completed in ${elapsed}s"
  else
    log_error "Build failed (exit code $exit_code) after ${elapsed}s"
  fi
  exit "$exit_code"
}

trap cleanup EXIT

run_step() {
  local title="$1"
  shift
  echo ""
  log_info "$title"
  "$@"
}

if ! command -v pnpm >/dev/null 2>&1; then
  log_error "pnpm is not installed. Please install pnpm first."
  exit 1
fi

echo "=================================================="
echo "  TeamAgentX Desktop Build (Win + macOS DMG x2)"
echo "=================================================="
echo ""
log_warn "Windows packaging on macOS requires electron-builder cross-build dependencies such as Wine."

run_step "Step 0/6: Cleaning build outputs..." bash -c "
  rm -rf '$SCRIPT_DIR/apps/desktop/release'
  rm -rf '$SCRIPT_DIR/apps/desktop/dist'
  rm -rf '$SCRIPT_DIR/apps/desktop/dist-electron'
  rm -rf '$SCRIPT_DIR/server/dist'
  rm -rf '$SCRIPT_DIR/server/node_modules-prod'
"

run_step "Step 1/6: Building server..." bash -c "
  cd '$SCRIPT_DIR/server'
  pnpm db:generate
  pnpm build
  pnpm prebuild:electron
"

run_step "Step 2/6: Deploying server production dependencies..." bash -c "
  cd '$SCRIPT_DIR'
  pnpm --filter=server deploy server/node_modules-prod --prod --frozen-lockfile --force
  cd '$SCRIPT_DIR/server'
  pnpm verify:electron-deps
  pnpm sync:prisma:prod
"

run_step "Step 3/6: Building Electron renderer/main/preload..." bash -c "
  cd '$SCRIPT_DIR/apps/desktop'
  pnpm typecheck
  pnpm exec tsc -p ../web/tsconfig.json
  cd '$SCRIPT_DIR/apps/web'
  pnpm exec vite --config ../desktop/vite.config.ts --mode electron build
"

run_step "Step 4/6: Packaging Windows x64 NSIS installer..." bash -c "
  cd '$SCRIPT_DIR/apps/desktop'
  pnpm exec electron-builder --win nsis --x64
"

run_step "Step 5/6: Packaging macOS Apple Silicon DMG..." bash -c "
  cd '$SCRIPT_DIR/apps/desktop'
  pnpm exec electron-builder --mac dmg --arm64
"

run_step "Step 6/6: Packaging macOS Intel DMG..." bash -c "
  cd '$SCRIPT_DIR/apps/desktop'
  pnpm exec electron-builder --mac dmg --x64
"

echo ""
echo "=================================================="
log_info "Build successful!"

RELEASE_DIR="$SCRIPT_DIR/apps/desktop/release"
if [ -d "$RELEASE_DIR" ]; then
  log_info "Output files:"
  find "$RELEASE_DIR" -maxdepth 1 \( -name '*.dmg' -o -name '*.exe' -o -name '*.blockmap' \) -print0 \
    | sort -z \
    | xargs -0 ls -lh 2>/dev/null \
    | while read -r line; do
      echo "  $line"
    done
  echo ""
  log_info "Release directory: $RELEASE_DIR"
fi

echo "=================================================="
