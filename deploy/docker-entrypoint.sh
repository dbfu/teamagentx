#!/bin/sh
# 容器以 root 启动：先确保数据卷 /data 与家目录可被 node(uid 1000) 写入，
# 再降权为 node 运行实际进程。
# —— Claude Code CLI 拒绝在 root 下使用 --dangerously-skip-permissions，必须非 root。
# 这样无论 docker run / docker compose 何种启动方式，挂载的命名卷都能开箱即用。
set -e

chown -R node:node /data 2>/dev/null || true
chown node:node /home/node 2>/dev/null || true

exec su-exec node:node "$@"
