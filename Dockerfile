# TeamAgentX 单容器服务端镜像：Fastify 同时托管前端 SPA + API + Socket。
#
# 客户端通过浏览器访问 http://<服务器IP>:3001 即可使用（同源，零配置）。
# 基于 node:22-alpine（musl）：Codex / Claude Agent SDK 的 Linux 预编译二进制为 musl 变体，
# @libsql/client 亦提供 musl 预编译绑定，Alpine 原生匹配。
#
# 三阶段瘦身：
#  - web-build：装全量依赖、构建前端产物 apps/web/dist
#  - server-deps：只装 server 运行时依赖（含 tsx/prisma 等 devDeps，因运行时需要），
#                 并裁掉多余的 glibc 平台包，避免把前端构建期依赖带进运行镜像
#  - runtime：精简基础 + 只拷贝 server 依赖树与前端产物

# ---------- 阶段 1：安装全量依赖 + 构建前端 ----------
FROM node:22-alpine AS web-build
RUN apk add --no-cache openssl python3 make g++ git
RUN corepack enable
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    HUSKY=0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
    --filter "@teamagentx/web..." \
    --filter "./server..."
RUN pnpm --filter "@teamagentx/web" build


# ---------- 阶段 2：只装 server 运行时依赖（剔除前端构建依赖）----------
FROM node:22-alpine AS server-deps
RUN apk add --no-cache openssl python3 make g++ git
RUN corepack enable
ENV HUSKY=0
WORKDIR /app
COPY . .
# 仅安装 server 包及其依赖（不含 @teamagentx/web 的 vite/esbuild 等构建期依赖）
RUN pnpm install --frozen-lockfile --filter "./server..."
# 为当前平台生成 Prisma Client
RUN pnpm --dir server exec prisma generate
# 裁掉用不到的 glibc 平台包（Alpine 是 musl，仅保留 *-musl 变体）
RUN rm -rf /app/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-x64@* \
 && find /app/node_modules -type l -name 'claude-agent-sdk-linux-x64' -exec rm -f {} + 2>/dev/null || true


# ---------- 阶段 3：运行时 ----------
FROM node:22-alpine AS runtime
# 运行时系统依赖（SDK 已内置、无需运行时 npm 安装/编译，故不带 g++/make）：
# - openssl/ca-certificates：Prisma 迁移引擎 + TLS
# - git/bash：Agent 在容器内执行 shell 工具
# - python3：常见 agent 脚本任务
# - su-exec：entrypoint 降权（root 启动 → chown 数据卷 → 切到 node 运行）
RUN apk add --no-cache openssl ca-certificates git bash python3 su-exec
RUN corepack enable && corepack prepare pnpm@10.24.0 --activate

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    PORT=3001 \
    WEB_DIST_DIR=/app/apps/web/dist \
    DATABASE_URL=file:/data/teamagentx.db \
    UPLOADS_DIR=/data/uploads \
    TOOLS_DIR=/data/.tools \
    TEAMAGENTX_USER_FILE=/data/user.json \
    HOME=/home/node

# 工作区根标识文件（供 pnpm 识别）+ server 依赖树（来自 server-deps）+ 前端产物（来自 web-build）
COPY --from=server-deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/
COPY --from=server-deps /app/node_modules /app/node_modules
COPY --from=server-deps /app/server /app/server
COPY --from=web-build /app/apps/web/dist /app/apps/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 让 node 可在 cwd 写诊断日志（agent-exec.log / debug-messages.jsonl 写到 /app/server）。
# 其余可写数据均在 /home/node（~/.teamagentx 工作区/配置）与 /data（DB/uploads/TOOLS_DIR）。
RUN chown node:node /app/server

WORKDIR /app/server

VOLUME ["/data"]
EXPOSE 3001

# 以 root 启动 entrypoint：chown 数据卷后降权为 node 运行（Claude Code 拒绝 root）。
# pnpm start 的 prestart 会自动执行 `prisma migrate deploy`，对挂载卷里的库建表/升级后再启动。
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["pnpm", "start"]
