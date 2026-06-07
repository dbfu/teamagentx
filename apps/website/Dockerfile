# ── Stage 1: 构建阶段 ──
FROM node:22-alpine AS builder

ARG PNPM_VERSION=10.30.3

# 版本号与下载链接全部改为「容器启动时」由 docker-entrypoint.sh 注入到
# update.json，前端运行时 fetch 读取，构建阶段不再烧入任何 VITE_* 配置。

# 设置工作目录
WORKDIR /repo

# 安装 pnpm。不要使用 latest，避免 Corepack 拉到需要更高 Node 版本的新 pnpm。
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# 先复制 workspace 依赖声明文件，利用 Docker 缓存。
# build-image.sh 会把 monorepo 根 package/workspace/lock 文件放进临时构建上下文。
COPY package.root.json ./package.json
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY package.json ./apps/website/package.json

# 安装依赖
RUN pnpm --filter @teamagentx/website install --frozen-lockfile

# 复制源代码
COPY . ./apps/website
WORKDIR /repo/apps/website

# 执行构建
RUN pnpm build

# ── Stage 2: 运行阶段（nginx 静态文件服务） ──
FROM nginx:alpine

# 复制自定义 nginx 模板配置
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# 从构建阶段复制产物
COPY --from=builder /repo/apps/website/dist /usr/share/nginx/html

# 复制启动脚本（容器启动时用运行时环境变量重写 update.json）
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 暴露 80 端口
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
