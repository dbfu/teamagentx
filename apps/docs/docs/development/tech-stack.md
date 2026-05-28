# 技术栈

## 后端技术

### 框架

- **Fastify 5**: 高性能 HTTP 服务器
  - 低延迟、高吞吐
  - 强类型 Schema 支持
  - 丰富的插件系统

### 数据库

- **Prisma 7**: ORM 框架
  - SQLite/libsql adapter
  - 类型安全查询
  - 自动迁移管理

### 实时通信

- **Socket.io 4**: WebSocket 库
  - 双向实时通信
  - 房间和命名空间
  - 断线重连

### AI 集成

- **LangChain**: LLM 应用框架
- **LangGraph**: 智能体编排
- **Anthropic SDK**: Claude API
- **OpenAI SDK**: GPT API

### 认证

- **JWT**: JSON Web Token
- **bcryptjs**: 密码加密

## 前端技术

### 核心框架

- **React 19**: UI 库
  - Concurrent Rendering
  - Suspense
  - Server Components（未来）

- **TypeScript**: 类型系统
  - 严格模式
  - 完整类型覆盖

### 构建工具

- **Vite 6**: 构建工具
  - 快速开发启动
  - HMR 热更新
  - ESM 优先

### 样式系统

- **Tailwind CSS 4**: CSS 框架
  - 原子化 CSS
  - JIT 编译
  - 自定义主题

- **shadcn/ui**: UI 组件库
  - new-york 风格
  - 可复制组件
  - Radix UI 基础

### 状态管理

- **Zustand**: 状态库
  - 简洁 API
  - 无 Provider
  - 中间件支持

### 其他库

- **react-mentions**: @ 提及功能
- **react-markdown**: Markdown 渲染
- **Socket.io-client**: 实时连接

## 桌面版技术

### 核心

- **Electron 41**: 桌面框架
  - Chromium 渲染
  - Node.js 主进程
  - 跨平台支持

### 进程模式

- **utilityProcess**: 后端嵌入
  - 独立进程
  - 无渲染开销
  - Node.js 环境

### 打包

- **electron-builder**: 打包工具
  - DMG (macOS)
  - EXE (Windows)
  - 自动更新

## 移动端技术

### 框架

- **Flutter**: UI 框架
  - Dart 语言
  - 跨平台渲染
  - 原生性能

### 状态管理

- **Provider**: 状态管理
  - 简单易用
  - InheritedWidget

### 路由

- **go_router**: 声明式路由
  - Deep linking
  - 路由守卫

### 网络

- **Dio**: HTTP 客户端
- **socket_io_client**: WebSocket

### 其他

- **WebView**: 内嵌网页
- **QR scanner**: 扫码功能

## 开发工具

### 包管理

- **pnpm**: 包管理器
  - 快速安装
  - Monorepo 支持
  - Workspace 协议

### 代码质量

- **ESLint**: 代码检查
- **TypeScript**: 类型检查
- **Prettier**: 代码格式化（可选）

### 测试

- **node:test**: 后端测试
- **Vitest**: 前端测试（可选）
- **Flutter test**: 移动端测试