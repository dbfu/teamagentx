#!/bin/bash

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 默认模式为 web（纯浏览器调试）
MODE="${1:-web}"

# 检查并杀死占用端口的进程
kill_port() {
  local port=$1
  local process=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$process" ]; then
    echo "Port $port is occupied by process $process, killing it..."
    kill -9 $process 2>/dev/null
    sleep 1
    echo "Port $port is now free"
  fi
}

# 清理函数：退出时杀死所有子进程
cleanup() {
  echo "Stopping all processes..."
  kill $(jobs -p) 2>/dev/null
  exit
}

# 捕获退出信号
trap cleanup EXIT INT TERM

if [ "$MODE" = "electron" ]; then
  # Electron 模式：前端启动 Electron，Electron 会自动启动后端
  echo "Starting in Electron mode..."

  # 检查端口 11053（Electron 内置后端）和 5173（Vite dev server）
  kill_port 11053
  kill_port 5173

  # 杀掉持有单实例锁的旧 Electron 进程，否则新实例会因 requestSingleInstanceLock() 返回 false 而立即退出
  pkill -f "Electron.*apps/desktop" 2>/dev/null || true
  sleep 0.5

  echo "Building embedded server for Electron..."
  cd "$SCRIPT_DIR/apps/desktop" && pnpm dev:full
else
  # Web 模式：分别启动后端和前端
  echo "Starting in Web mode..."

  # 检查端口 3001（后端）
  kill_port 3001

  # 检查端口 5173（前端 Vite）
  kill_port 5173

  # 设置 OpenClaw Gateway Token（如果配置文件存在）
  OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
  if [ -f "$OPENCLAW_CONFIG" ]; then
    GATEWAY_TOKEN=$(grep -o '"token": *"[^"]*"' "$OPENCLAW_CONFIG" | sed 's/"token": *"\([^"]*\)".*/\1/')
    if [ -n "$GATEWAY_TOKEN" ]; then
      export OPENCLAW_GATEWAY_TOKEN="$GATEWAY_TOKEN"
      echo "OpenClaw Gateway Token loaded from config"
    fi
  fi

  # 启动后端
  echo "Starting server..."
  cd "$SCRIPT_DIR/server" && pnpm start &

  # 启动前端（纯网页模式）
  echo "Starting client..."
  cd "$SCRIPT_DIR/apps/web" && pnpm dev &

  # 等待所有后台进程
  wait
fi
