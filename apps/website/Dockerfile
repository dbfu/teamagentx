# ── Stage 1: 构建阶段 ──
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 先复制依赖声明文件，利用 Docker 缓存
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 将构建参数写入 .env 文件，Vite 构建时会自动读取
RUN echo "VITE_APP_VERSION=${VITE_APP_VERSION}" > .env && \
    echo "VITE_DOWNLOAD_URL_MAC=${VITE_DOWNLOAD_URL_MAC}" >> .env && \
    echo "VITE_DOWNLOAD_URL_WIN=${VITE_DOWNLOAD_URL_WIN}" >> .env

# 执行构建
RUN pnpm build

# ── Stage 2: 运行阶段（nginx 静态文件服务） ──
FROM nginx:alpine

# 复制自定义 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 从构建阶段复制产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制启动脚本（容器启动时用运行时环境变量重写 update.json）
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 暴露 80 端口
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
