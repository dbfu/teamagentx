# 环境变量

## 后端配置

后端服务的环境变量在 `server/src/config/index.ts` 中管理。

### 基础配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3001` | 服务端口 |
| `SERVER_HOST` | `0.0.0.0` | 服务主机 |
| `DATABASE_URL` | `file:./dev.db` | 数据库连接 URL |
| `JWT_SECRET` | - | JWT 密钥（必须设置） |
| `JWT_EXPIRES_IN` | `7d` | JWT 过期时间 |

### 智能体配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AGENT_HISTORY_THRESHOLD` | - | 历史消息阈值 |
| `AGENT_MEMORY_RECENT_MESSAGES` | - | 近期消息数量 |
| `AGENT_MEMORY_COMPACT_MESSAGES` | - | 压缩消息数量 |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | - | 摘要目标 Token 数 |

### ACP 配置

| 变量名 | 说明 |
|--------|------|
| `ANTHROPIC_API_KEY` | Claude API 密钥 |
| `ANTHROPIC_MODEL` | Claude 模型名称 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `OPENAI_MODEL` | OpenAI 模型名称 |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw ACP 网关令牌 |

## 桌面版配置

桌面版使用固定端口：

- **后端服务**: `11053`
- **移动端 Web 入口**: `11054`

数据存储位置：

- macOS: `/Users/<user>/Library/Application Support/@teamagentx/desktop/`
- Windows: `%APPDATA%\@teamagentx\desktop\`

文件：
- `teamagentx.db`: SQLite 数据库
- `uploads/images`: 上传文件目录
- `electron-debug.log`: 调试日志

## 前端配置

前端开发服务器：

- 端口: `5173`
- API 端点: `http://localhost:3001`（可配置）

## 配置示例

开发环境 `.env`：

```bash
PORT=3001
DATABASE_URL=file:./dev.db
JWT_SECRET=dev-secret-key
JWT_EXPIRES_IN=7d
```

生产环境 `.env`：

```bash
PORT=3001
DATABASE_URL=file:./prod.db
JWT_SECRET=your-secure-secret-key
JWT_EXPIRES_IN=7d
```