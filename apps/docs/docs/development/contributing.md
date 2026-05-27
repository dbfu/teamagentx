# 贡献指南

## 开发环境设置

### 1. 克隆项目

```bash
git clone https://github.com/your-org/teamagentx.git
cd teamagentx
```

### 2. 安装依赖

确保使用 pnpm 10.24.0：

```bash
corepack enable
corepack prepare pnpm@10.24.0 --activate
pnpm install
```

### 3. 启动开发

```bash
# Web 模式
./start.sh web

# Electron 模式
./start.sh electron
```

## 项目结构

遵循 Monorepo 结构：

- `apps/web/`: React 前端
- `apps/desktop/`: Electron 桌面版
- `apps/mobile/`: Flutter 移动端
- `server/`: Fastify 后端
- `docs/`: 项目文档

## 代码规范

### TypeScript

- 启用严格模式
- 所有代码必须有类型定义
- 避免 `any` 类型

### React 组件

- 每个组件不超过 500 行
- 超过时拆分为子组件或抽取 hooks
- 使用函数组件和 hooks

### 样式

- 使用 Tailwind CSS
- 遵循项目 UI 规范：
  - 主题色: `bg-blue-500`
  - 输入框: `rounded-lg border border-gray-200`
  - 按钮: `bg-blue-500 hover:bg-blue-600`

### 命名

- 使用有意义的变量名
- 遵循文件命名约定
- 中文注释可以接受

## 提交规范

### Commit Message

使用简洁的提交信息：

```
feat: 添加新功能
fix: 修复 bug
docs: 文档更新
refactor: 代码重构
style: 样式调整
test: 测试相关
chore: 构建/工具
```

### Pull Request

1. 从 main 创建分支
2. 完成开发和测试
3. 提交 PR 并描述变更
4. 等待审核

## 测试

### 后端测试

```bash
cd server
pnpm test           # 运行测试
pnpm test:watch     # 监听模式
```

### 前端测试

暂未配置测试框架，欢迎贡献。

### 移动端测试

```bash
cd apps/mobile
flutter test
```

## 文档

### 更新文档

修改相关功能时，请同步更新文档：

- `apps/docs/`: VitePress 文档
- `docs/`: 项目文档

### 文档风格

- 使用简洁清晰的语言
- 提供示例代码
- 保持结构一致

## 安全

### 注意事项

- 不要提交敏感信息
- 使用环境变量存储密钥
- 避免 SQL 注入、XSS 等漏洞

## 问题反馈

发现问题请提交 Issue，包含：

- 问题描述
- 复现步骤
- 环境信息
- 相关日志