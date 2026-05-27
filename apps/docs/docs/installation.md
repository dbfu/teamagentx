# 安装部署

## 开发环境

### Web 模式

```bash
# 安装依赖
pnpm install

# 启动 Web 模式（服务器 + 前端）
./start.sh web
```

服务：
- 前端: http://localhost:5173
- 后端: http://localhost:3001
- 数据库: SQLite (`server/dev.db`)

### Electron 桌面版

```bash
# 开发模式
./start.sh electron

# 打包桌面应用
./build-dmg.sh       # macOS
./build-win.sh       # Windows
```

桌面版数据存储位置：
- macOS: `/Users/<user>/Library/Application Support/@teamagentx/desktop/`
- Windows: `%APPDATA%\@teamagentx\desktop\`

## 生产部署

### 后端服务

1. 构建后端：

```bash
cd server
pnpm build
```

2. 配置环境变量：

```bash
export PORT=3001
export DATABASE_URL=file:./prod.db
export JWT_SECRET=your-secret-key
export JWT_EXPIRES_IN=7d
```

3. 运行迁移：

```bash
pnpm db:migrate
```

4. 启动服务：

```bash
pnpm start
```

### 前端构建

```bash
cd apps/web
pnpm build
pnpm preview  # 预览构建结果
```

构建产物位于 `apps/web/dist/`，可部署到任何静态文件服务器。

### Docker 部署（待完善）

项目正在添加 Docker 支持，敬请期待。

## 环境变量

详细的环境变量说明请参考 [环境变量配置](/configuration/env)。