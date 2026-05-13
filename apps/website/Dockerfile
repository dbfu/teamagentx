# ── Stage 1: 构建阶段 ──
FROM node:20-alpine AS builder

# 构建参数：版本号 + 各平台下载链接
ARG VITE_APP_VERSION=v1.2.0
ARG VITE_DOWNLOAD_URL_MAC=https://releases.teamagentx.com/1.2.0/TeamAgentX-1.2.0-mac.dmg
ARG VITE_DOWNLOAD_URL_WIN=https://releases.teamagentx.com/1.2.0/TeamAgentX-1.2.0-win.exe

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

# 暴露 80 端口
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
