# 快速开始

## 前置要求

- Node.js >= 18
- pnpm >= 10
- SQLite（桌面版内置）

## 克隆项目

```bash
git clone https://github.com/your-org/teamagentx.git
cd teamagentx
```

## 安装依赖

```bash
pnpm install
```

## 启动 Web 模式

Web 模式会在后台启动服务器（端口 3001）和前端开发服务器（端口 5173）：

```bash
./start.sh
# 或
./start.sh web
```

启动后访问 http://localhost:5173。

## 启动 Electron 桌面版

桌面版会嵌入后端服务（端口 11053）：

```bash
./start.sh electron
```

## 数据库初始化

首次启动时，数据库会自动创建和迁移。如需手动操作：

```bash
cd server
pnpm db:migrate   # 运行迁移
pnpm db:seed      # 初始化数据
pnpm db:studio    # 打开 Prisma Studio
```

## 登录

默认情况下，系统会创建一个管理员账户。你可以通过登录界面进入系统。

## 下一步

- [功能介绍](/features) - 了解平台的核心功能
- [安装部署](/installation) - 生产环境部署指南
- [配置指南](/configuration) - 系统配置说明