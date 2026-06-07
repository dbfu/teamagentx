# 贡献指南

感谢你对 TeamAgentX 的关注！欢迎通过 Issue 和 Pull Request 参与共建。

## 开始之前

- 提交较大改动前，建议先开一个 Issue 讨论方案，避免重复劳动或方向不符。
- 报告 Bug 时请尽量提供：复现步骤、期望行为、实际行为、运行环境（操作系统 / Node 版本 / 运行模式 web 还是桌面端）。

## 环境要求

- **Node.js** ≥ 20
- **pnpm** 10（仓库已锁定 `pnpm@10.24.0`，请勿使用 npm / yarn）
- **Flutter**（仅在开发 `apps/mobile/` 时需要）

## 本地启动

```bash
# 安装依赖（仓库根目录）
pnpm install

# Web 模式：server 3001 + Vite 5173
./start.sh web

# Electron 桌面开发模式：内置 server 11053
./start.sh electron
```

数据库初始化（在 `server/` 下）：

```bash
pnpm db:migrate     # 执行 Prisma 迁移
pnpm db:generate    # 生成 Prisma client
pnpm db:seed        # 可选：填充种子数据
```

环境变量请复制各包下的 `.env.example` 为 `.env` 后按需修改，详见 `server/.env.example`。

## 项目结构

```
apps/web/        React 前端（飞书风格 UI）
apps/desktop/    Electron 桌面壳
apps/mobile/     Flutter 移动端
server/          Fastify 后端（Socket.io / Prisma / Agent 执行 / 定时任务）
docs/            项目文档
```

更多架构说明见 `ARCHITECTURE.md` 与 `CLAUDE.md`。

## 提交规范

### 分支

- 从 `main` 切出特性分支，命名建议 `feature/xxx`、`fix/xxx`。

### Commit Message

采用 [Conventional Commits](https://www.conventionalcommits.org/)，描述可用中文：

```
feat: 新增 3D 办公室视角功能
fix: 修复流式输出面板宽度超出屏幕
docs: 完善贡献指南
refactor: 拆分超长组件
```

常用类型：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf`。

### 代码风格

- TypeScript 严格模式（server / web / desktop 均已开启）。
- 使用 ES Modules。
- React 组件文件控制在 **500 行以内**，超出请拆分子组件或抽取 hooks。
- 优先复用已有的本地 helper、service、store 和 UI 组件，避免引入重复模式。
- 中文注释可以接受，项目源码中已大量使用。
- UI 主题色为蓝色（`bg-blue-500` / `hover:bg-blue-600`），新增界面请与现有风格保持一致。

### 数据库变更

- Prisma 迁移是 schema 的唯一来源。修改 `server/prisma/schema.prisma` 必须配套生成 `server/prisma/migrations/` 下的迁移，并按需重新生成 client。
- 不要用启动时的 schema 校正脚本或临时 `ALTER TABLE` 来绕过迁移。

## 提交 PR 前的检查

请确保以下命令通过：

```bash
# Web（apps/web/）
pnpm lint
pnpm build

# 桌面端（apps/desktop/）
pnpm typecheck

# 后端（server/）
pnpm build
pnpm test

# 移动端（apps/mobile/，如有改动）
flutter analyze
flutter test
```

## Pull Request

1. Fork 仓库并基于 `main` 创建分支。
2. 保持单个 PR 聚焦一个主题，便于评审。
3. PR 描述请说明改动动机、主要变更点，必要时附上截图或录屏（UI 改动）。
4. 关联相关 Issue（如 `Closes #123`）。

## 许可

提交贡献即表示你同意以本项目的 [MIT License](./LICENSE) 授权你的代码。
