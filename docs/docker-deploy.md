# Docker 部署服务端（客户端经 IP 浏览器访问）

把 TeamAgentX 服务端以**单容器**部署：Fastify 同时托管前端 SPA + API + Socket.io，
用户用浏览器访问 `http://<服务器IP>:<端口>` 即可使用，无需安装桌面版。前端因同源自动
解析 API/Socket 地址（`window.location.origin`），HTTP/HTTPS 均自动适配，零前端配置。

## 一、快速开始（纯内网 HTTP）

```bash
# 1. 准备环境变量
cp .env.docker.example .env
# 编辑 .env：必须设置 AUTH_PASSWORD；建议设置 JWT_SECRET（openssl rand -hex 32）

# 2. 构建并启动
docker compose up -d --build

# 3. 访问（局域网内任意机器浏览器）
#    http://<服务器局域网IP>:3001
```

用 `.env` 里的 `AUTH_USERNAME` / `AUTH_PASSWORD` 直接登录即可。账号在容器启动时即由
环境变量建好，**避免服务起来后被同网络其他人抢先注册占用唯一账号**。

## 二、数据持久化

容器内 `/data` 为持久化数据卷（compose 命名卷 `teamagentx-data`），包含：

| 路径 | 内容 |
|------|------|
| `/data/teamagentx.db` | SQLite 数据库（`DATABASE_URL`） |
| `/data/uploads` | 上传的图片/音频（`UPLOADS_DIR`） |
| `/data/.tools` | 运行时安装的 ACP 工具 Claude/Codex（`TOOLS_DIR`） |
| `/data/user.json` | 单账号文件（`TEAMAGENTX_USER_FILE`） |
| `/data/.jwt-secret` | 未显式设置 `JWT_SECRET` 时自动生成的密钥 |

重启/升级容器数据不丢。备份只需备份该卷。

## 三、账号与口令

单账号模型，口令由环境变量管理，启动即建好账号（防止他人抢注）：

- 设置 `AUTH_USERNAME` / `AUTH_PASSWORD`，容器启动时：账号不存在则创建；与现有不一致则
  **以环境变量为准更新**。改完口令 `docker compose up -d` 重启即生效。
- 账号文件写入 `/data/user.json`（`TEAMAGENTX_USER_FILE`），持久化在数据卷，重启不丢。
- 头像、语言等在 Web 端的修改会保留（不会被 env 覆盖）。
- 登录后在「设置」里配置 LLM 模型 / ACP 工具（浏览器模式不走桌面版的完整引导页）。

## 四、数据库迁移

镜像启动（`pnpm start`）的 `prestart` 会自动执行 `prisma migrate deploy`，对挂载卷里的
SQLite 库建表/升级。**这是 schema 的唯一来源**，不要手动 `db push` 或改表。

## 五、三种网络暴露模式

前端同源自适应，三种模式只靠部署配置切换，无需改代码。

### 1) 纯内网 HTTP（默认）
见「快速开始」。仅在可信局域网/VPN 内使用。注意 HTTP 明文，局域网抓包可见口令/token。

### 2) 内网/公网 HTTPS（前置 Caddy 反代）

```bash
docker compose --profile tls up -d --build
```

- 编辑 `deploy/Caddyfile`：
  - **公网域名**：改用 `your.domain.com { reverse_proxy server:3001 }`，Caddy 自动签发证书。
  - **内网 IP**：默认 `tls internal`（Caddy 自签 CA），访问 `https://<服务器IP>`，浏览器确认放行自签证书即可。
- 反代会把前端、API、WebSocket 统一同源转发，前端自动走 `https` / `wss`。

### 3) 公网访问
在 HTTPS 基础上务必：
- 显式设置强随机 `JWT_SECRET`；
- 收紧 `CORS_ORIGIN` 为具体来源；
- 加防火墙/限流，限制可访问来源。

## 六、安全须知（重要）

- **登录用户可在容器内执行任意 shell / ACP 命令**（这是 Agent 的设计能力）。本部署**未做容器强隔离**，因此：账号必须可信，并配合网络层（反代 / VPN / 防火墙）控制谁能访问。
- 不要把未加固的实例直接裸暴露到公网。

## 七、ACP 工具运行时

首次触发 LLM 对话/ACP 工具时，会在 `/data/.tools` 运行时 `npm install` Claude/Codex，
需要容器具备外网访问。安装结果持久化，后续重启不再重装。

## 八、常用运维

```bash
docker compose logs -f server      # 查看日志
docker compose up -d --build       # 升级（重建镜像 + 自动迁移）
docker compose down                # 停止（数据卷保留）
docker run --rm -v teamagentx_teamagentx-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/teamagentx-data.tgz -C /data .   # 备份数据卷
```
