# GitHub Issue 自动化开发工作流 — 设计文档

> 基于 TeamAgentX 现有群聊 + Agent + TaskQueue + CronTask 架构的增量设计

## 1. 概述

### 1.1 目标

为 TeamAgentX 增加 GitHub 仓库项目管理能力，实现以下闭环：

**关联仓库 → 创建项目群聊 → 同步 Issues → 分析分配 → Agent 执行 → 创建 PR**

核心原则：**最大程度复用现有架构**，将 GitHub Issue 管理映射到群聊体系中，而非构建独立的子系统。

### 1.2 目标用户

- **v1（个人版）**：个人开发者管理自己的开源/私有仓库，用 Agent 辅助处理积压 Issues
- **v2（团队版）**：小团队协作，多人共享看板，分配和跟踪 Issue 处理进度

### 1.3 核心映射

| 现有概念 | 新功能映射 | 说明 |
|---------|----------|------|
| `ChatRoom` | **项目** | 一个 GitHub 仓库对应一个群聊 |
| `Todo`（增强） | **Issue 任务卡** | GitHub Issue 同步为群内 Todo |
| `Agent`（系统级） | **项目管理助手** | 负责同步、分析、分配任务 |
| `Agent`（普通级） | **开发助手** | 接收任务后编码、测试，复用现有 executor |
| `Message` | **执行日志流** | Agent 执行过程的消息流自然成为项目动态 |
| `TaskQueue` | **任务队列** | 直接复用排队、中断、恢复机制 |
| `CronTask` | **Issues 同步定时任务** | 复用定时能力定期拉取新 Issues |

---

## 2. 完整用户流程

### 2.1 创建项目（导入仓库）

```
用户操作流程：

1. 点击「创建项目」→ 进入项目创建向导
   │
   ├─ Step 1：关联远程仓库
   │   ├─ GitHub OAuth 授权（首次使用）
   │   ├─ 选择仓库（列出用户的所有仓库）
   │   └─ 或手动输入 owner/repo
   │
   ├─ Step 2：配置工作目录
   │   ├─ 默认路径：~/TeamAgentX/projects/{repo-name}
   │   ├─ 用户可选择已有本地目录（仓库已 clone 的情况）
   │   └─ 自动 git clone（如果本地不存在）
   │
   ├─ Step 3：创建群聊（复用现有创建群聊流程）
   │   ├─ 群聊名称默认为仓库名（用户可修改）
   │   ├─ 群聊描述自动填充仓库描述
   │   ├─ workDir 设为步骤 2 的工作目录
   │   ├─ 自动加入「项目管理助手」（系统级 Agent）
   │   └─ 自动创建 CronTask：定时拉取 Issues
   │
   └─ Step 4：邀请开发助手
       ├─ 用户从已有 Agent 列表中选择（可多选）
       ├─ 每个被选中的 Agent 加入群聊
       └─ 项目管理助手自动识别群内可用的开发 Agent
```

### 2.2 Issues 同步

```
定时任务（CronTask）触发：
  │
  ├─ 调用 GitHub API 获取仓库的 open Issues
  │   └─ 支持过滤：label、assignee、milestone
  │
  ├─ 对比本地已有 Todo（通过 githubIssueNumber 匹配）
  │
  ├─ 新增 Issues → 创建 Todo（status: pending, 标签: 待分配）
  │   └─ Todo 内容：Issue 标题 + Issue URL + 标签 + 优先级
  │
  ├─ 已关闭 Issues → 更新对应 Todo status: completed
  │
  └─ 发送同步摘要消息到群聊
      └─ "📥 同步完成：新增 3 个 Issue，已关闭 1 个"
```

### 2.3 任务分析与分配

```
项目管理助手（自动/手动触发）：
  │
  ├─ 扫描群内 status=pending 且未分配的 Todos
  │
  ├─ 分析每个 Issue：
  │   ├─ 读取 Issue title + body + labels
  │   ├─ 结合仓库代码结构判断任务类型
  │   │   ├─ bug fix（bug 标签 → 适合修复型 Agent）
  │   │   ├─ feature（enhancement 标签 → 适合功能开发 Agent）
  │   │   ├─ docs（documentation 标签 → 适合文档型 Agent）
  │   │   └─ 其他 → 通用 Agent
  │   ├─ 评估复杂度（简单/中等/复杂）
  │   └─ 推荐执行 Agent 和自动化等级
  │
  ├─ 在群聊中发送分析报告：
  │   └─ "📋 任务分析：Issue #42 [bug] 内存泄漏 — 建议分配给 @bug-fixer，全自动执行"
  │
  └─ 等待用户确认（半自动）或直接分配（全自动配置）
      ├─ 更新 Todo.assignedAgentId
      └─ 更新 Todo.automationLevel
```

### 2.4 Agent 执行任务

```
开发 Agent 接收任务：
  │
  ├─ 1. 环境准备
  │   ├─ git fetch origin
  │   ├─ git checkout -b fix/issue-{number} origin/main
  │   └─ 设置 workDir 为仓库分支目录
  │
  ├─ 2. 分析阶段
  │   ├─ 读取 Issue 完整内容
  │   ├─ 分析相关代码文件
  │   └─ 生成修改方案
  │   └─ semi_auto: 发送方案到群聊，等待用户确认
  │   └─ full_auto: 直接进入编码
  │
  ├─ 3. 编码阶段
  │   ├─ 实现代码修改
  │   └─ 编写/补充针对本次改动的测试用例
  │
  ├─ 4. 测试阶段
  │   ├─ 自动检测项目测试命令（package.json / Makefile / Cargo.toml）
  │   ├─ 运行已有测试套件
  │   ├─ 运行新增测试
  │   ├─ 全部通过 → 进入下一步
  │   └─ 失败 → Agent 自动修复重试（最多 3 次）
  │       └─ 3 次仍失败 → 暂停，发送错误报告到群聊，等待人工介入
  │
  ├─ 5. 提交阶段
  │   ├─ git add + git commit（自动生成 commit message）
  │   ├─ git push origin fix/issue-{number}
  │   ├─ 通过 GitHub API 创建 Pull Request
  │   │   └─ PR 标题：fix #N: {issue title}
  │   │   └─ PR 正文：包含 Issue 链接、修改说明、测试结果
  │   └─ 更新 Todo 状态 → pr_opened
  │
  └─ 6. 完成通知
      ├─ 在群聊中发送完成报告
      │   └─ "✅ Issue #42 已完成，PR #15 已创建：{PR URL}"
      └─ 项目管理助手更新 Todo status → completed
```

### 2.5 用户手动干预

用户随时可以在群聊中手动操作：

- `@agent 处理 Issue #5` — 直接手动分配任务
- `@agent 暂停` — 中断当前执行（复用 TaskQueue interrupt）
- `@agent 继续` — 恢复执行（复用 TaskQueue resume）
- 在看板视图中拖拽 Issue 卡片分配给不同 Agent
- 修改某个 Issue 的自动化等级

---

## 3. 数据模型设计

### 3.1 新增模型

#### GitHubAccount（GitHub 授权信息）

```prisma
model GitHubAccount {
  id              String   @id @default(uuid())
  userId          String   @unique
  githubId        Int      @unique        // GitHub 用户 ID
  githubUsername  String                    // GitHub 用户名
  accessToken     String                    // OAuth access token（加密存储）
  refreshToken    String?                   // OAuth refresh token
  tokenExpiresAt  DateTime?                 // token 过期时间
  avatarUrl       String?                   // GitHub 头像
  scopes          String   @default("[]")  // 授权的 scope（JSON array）
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  repositories Repository[]

  @@index([userId])
  @@index([githubUsername])
}
```

#### Repository（仓库关联）

```prisma
model Repository {
  id              String   @id @default(uuid())
  githubAccountId String
  fullName        String                    // owner/repo
  description     String?
  defaultBranch   String   @default("main")
  localPath       String                    // 本地工作目录路径
  htmlUrl         String?                   // GitHub 仓库 URL
  isPrivate       Boolean  @default(false)
  syncInterval    Int      @default(5)     // Issues 同步间隔（分钟）
  lastSyncedAt    DateTime?
  syncEnabled     Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  githubAccount GitHubAccount @relation(fields: [githubAccountId], references: [id], onDelete: Cascade)
  chatRoom      ChatRoom?     // 一对一关联群聊

  @@unique([githubAccountId, fullName])
  @@index([fullName])
}
```

### 3.2 修改现有模型

#### ChatRoom 增强

```prisma
// 在现有 ChatRoom 模型中新增字段
model ChatRoom {
  // ... 现有字段 ...

  isProjectRoom    Boolean    @default(false)  // 标识为项目群聊
  repositoryId     String?    @unique          // 关联的仓库
  repository       Repository @relation(fields: [repositoryId], references: [id], onDelete: SetNull)

  @@index([isProjectRoom])
}
```

#### Todo 增强

```prisma
// 在现有 Todo 模型中新增字段
model Todo {
  // ... 现有字段 ...

  // GitHub Issue 关联
  githubIssueNumber Int?                     // GitHub Issue 编号
  githubIssueUrl    String?                  // Issue URL
  githubLabels      String?                  // 标签（JSON array: ["bug","enhancement"])
  githubMilestone   String?                  // 里程碑

  // 执行追踪
  automationLevel   String    @default("semi_auto")  // full_auto | semi_auto
  assignedAgentId   String?                           // 分配的执行 Agent
  assignedAgent     Agent?     @relation("TodoAssignedAgent", fields: [assignedAgentId], references: [id], onDelete: SetNull)
  branchName        String?                           // 创建的分支名
  prUrl             String?                           // 创建的 PR 链接
  prNumber          Int?                              // PR 编号
  executionStage    String?                           // 当前执行阶段：analyzing | coding | testing | committing | pr_opened

  @@index([githubIssueNumber])
  @@index([assignedAgentId])
  @@index([executionStage])
}
```

#### Agent 增强

```prisma
// 在现有 Agent 模型中新增字段
model Agent {
  // ... 现有字段 ...

  agentRole     String  @default("worker")   // worker | project_manager
  // project_manager: 项目管理助手（同步、分析、分配）
  // worker: 开发执行助手（编码、测试）

  assignedTodos Todo[]  @relation("TodoAssignedAgent")

  @@index([agentRole])
}
```

---

## 4. 服务端新增模块

### 4.1 模块总览

```
server/src/
├── core/
│   ├── agent/                    # 现有，不变
│   └── github/                   # 新增
│       ├── auth.service.ts       # GitHub OAuth 授权
│       ├── sync.service.ts       # Issues 同步服务
│       ├── issue-executor.ts     # Issue 执行流程编排
│       └── pr.service.ts         # PR 创建服务
├── modules/
│   ├── github/                   # 新增
│   │   ├── github-account.service.ts   # 账号管理 CRUD
│   │   └── repository.service.ts       # 仓库管理 CRUD
│   └── project/                  # 新增
│       └── project-import.service.ts   # 项目导入编排
└── gateway/
    └── github/                   # 新增 API 路由
        ├── auth.gateway.ts       # OAuth 回调
        ├── repository.gateway.ts # 仓库 API
        └── project.gateway.ts    # 项目管理 API
```

### 4.2 GitHubAuthService

职责：GitHub OAuth 授权流程，Token 管理。

```
核心方法：
  - initiateOAuth()        → 生成授权 URL，返回给前端打开
  - handleCallback(code)   → 用 code 换取 access token
  - getAccessToken(userId) → 获取有效 token（自动刷新）
  - revokeAccess(userId)   → 撤销授权
  - getOctokit(userId)     → 返回已认证的 Octokit 实例
```

授权流程：
1. 前端调用 `initiateOAuth()` 获取授权 URL
2. Electron 通过 `shell.openExternal(url)` 打开浏览器
3. 用户授权后 GitHub 回调到本地 HTTP server（`http://localhost:{port}/github/callback`）
4. 服务端用 code 换取 token，存入 `GitHubAccount`

### 4.3 GitHubSyncService

职责：定期同步 GitHub Issues 到本地 Todo。

```
核心方法：
  - syncIssues(repositoryId)  → 同步指定仓库的 Issues
  - detectTestCommand(workDir) → 检测项目的测试运行命令

同步逻辑：
  1. 通过 Octokit 获取仓库的 open issues
  2. 查询本地已有 Todo（匹配 githubIssueNumber）
  3. 计算 diff：
     - 新增的 Issue → 创建 Todo (status: pending, executionStage: null)
     - 已关闭的 Issue → 更新 Todo status: completed
     - 已更新的 Issue → 更新 title/body/labels
  4. 发送同步摘要消息到关联群聊
```

### 4.4 IssueExecutorService

职责：编排单个 Issue 的完整执行流程。

```
核心方法：
  - executeIssue(todoId, agentId, automationLevel) → 执行 Issue 处理流程

执行流程（状态机）：
  pending → preparing → analyzing → coding → testing → committing → pr_opened → completed
                                ↓           ↓          ↓
                             (用户确认)  (测试失败重试) (失败等待)

每个阶段：
  preparing:  git checkout -b fix/issue-{n}
              更新 Todo.executionStage = "preparing"

  analyzing:  调用 Agent 分析 Issue
              semi_auto: 发送方案到群聊，等待用户消息确认
              full_auto: 直接进入 coding
              更新 Todo.executionStage = "analyzing"

  coding:     Agent 执行编码 + 编写补充测试
              更新 Todo.executionStage = "coding"

  testing:    检测并运行项目测试命令
              通过 → 进入 committing
              失败 → Agent 修复重试（最多 3 次）
              超过重试次数 → 暂停，群聊通知用户
              更新 Todo.executionStage = "testing"

  committing: git add + commit + push
              更新 Todo.executionStage = "committing"

  pr_opened:  通过 GitHub API 创建 PR
              更新 Todo.prUrl, prNumber
              更新 Todo.executionStage = "pr_opened"

  completed:  群聊通知完成
              更新 Todo.status = completed
```

### 4.5 ProjectImportService

职责：编排「导入仓库 → 创建群聊」的完整流程。

```
核心方法：
  - importProject(options) → 导入项目

流程：
  1. 验证 GitHub 授权有效
  2. 获取仓库信息（通过 Octokit）
  3. 处理本地目录：
     - 用户指定已有路径 → 验证是否为 git 仓库，验证 remote 是否匹配
     - 用户未指定 → git clone 到默认目录
  4. 创建/查找 Repository 记录
  5. 创建 ChatRoom：
     - name = 仓库名（用户可自定义）
     - workDir = 本地仓库路径
     - isProjectRoom = true
     - 关联 Repository
  6. 自动加入「项目管理助手」：
     - 查找或创建 agentRole = "project_manager" 的 Agent
     - 将该 Agent 加入群聊
  7. 用户选择开发助手加入群聊
  8. 创建 CronTask：
     - payload = "同步 Issues"
     - agentIds = [项目管理助手 ID]
     - scheduleType = interval
     - intervalMinutes = syncInterval（默认 5 分钟）
  9. 执行首次同步
```

### 4.6 项目管理助手（Agent）

一种特殊的系统级 Agent，通过预置 prompt 实现以下能力：

**Prompt 核心内容：**

```
你是一个项目管理助手，负责管理 GitHub Issues 的同步、分析和分配。

你的职责：
1. 定期同步远程仓库的 Issues 到本地任务池
2. 分析每个新 Issue 的类型和复杂度
3. 根据群内可用的开发助手的能力，推荐或自动分配任务
4. 跟踪任务执行状态，汇总报告

你可以使用的工具：
- sync_issues: 同步远程 Issues
- analyze_issue: 分析 Issue 并生成处理建议
- assign_todo: 将 Todo 分配给指定 Agent
- update_todo_status: 更新 Todo 状态
- list_available_agents: 列出群内可用的开发助手

分析 Issue 时请考虑：
- Issue 标签（bug → 修复类，enhancement → 功能类，documentation → 文档类）
- Issue 复杂度（基于描述长度、涉及模块、是否有 reproduction steps）
- 群内各助手的能力配置和工作负载
```

该助手通过 `CronTask` 定时触发，也可由用户在群聊中 `@项目管理助手 同步Issues` 手动触发。

---

## 5. API 设计

### 5.1 GitHub 授权

```
POST   /api/github/auth/url           → 获取 OAuth 授权 URL
GET    /api/github/auth/callback       → OAuth 回调（GitHub 调用）
GET    /api/github/auth/status         → 查询授权状态
DELETE /api/github/auth                → 撤销授权
```

### 5.2 仓库管理

```
GET    /api/github/repositories        → 列出用户 GitHub 仓库（远程）
GET    /api/github/repositories/local  → 列出已关联的本地仓库
POST   /api/github/repositories/clone  → clone 仓库到本地
```

### 5.3 项目管理

```
POST   /api/projects                  → 创建项目（导入仓库 + 创建群聊）
GET    /api/projects                  → 列出所有项目
GET    /api/projects/:id              → 获取项目详情（含仓库信息 + 群聊信息）
DELETE /api/projects/:id              → 删除项目（可选是否删除本地仓库）
POST   /api/projects/:id/sync         → 手动触发 Issues 同步
GET    /api/projects/:id/board        → 获取看板数据（按状态分组的 Todos）
```

### 5.4 Issue 任务操作

```
PUT    /api/todos/:id/assign          → 分配 Agent 给 Issue 任务
PUT    /api/todos/:id/automation      → 修改自动化等级
POST   /api/todos/:id/execute         → 手动触发执行
POST   /api/todos/:id/pause           → 暂停执行
POST   /api/todos/:id/resume          → 恢复执行
```

### 5.5 Socket.io 新增事件

```
// 项目相关
project:synced              → Issues 同步完成通知
project:todo:created        → 新 Issue 同步为 Todo
project:todo:stage-changed  → 任务执行阶段变更

// 看板相关
board:updated               → 看板数据更新（拖拽等操作）
```

---

## 6. 前端设计

### 6.1 新增页面/组件

#### 项目创建向导（`ProjectWizard`）

分步骤引导用户：
- Step 1: GitHub 授权（如果未授权）
- Step 2: 选择仓库 + 配置本地路径
- Step 3: 创建群聊（复用 `create-chatroom-modal` 组件，自动填充字段）
- Step 4: 选择开发助手（复用 Agent 选择器）

#### 看板视图（`ProjectBoard`）

替代或增强现有群聊的 Todo 视图：

```
┌─ 看板视图 ─────────────────────────────────────────────────────┐
│ 项目：my-awesome-project                    [同步] [设置]       │
│                                                                │
│ ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────────┐ │
│ │ 待分配(5) │  │ 分析中(1) │  │ 开发中(2) │  │ 待合并(3)     │ │
│ ├──────────┤  ├───────────┤  ├──────────┤  ├───────────────┤ │
│ │ #42 bug  │  │ #38 feat │  │ #35 feat │  │ #33 bug      │ │
│ │ 内存泄漏 │  │ 添加导出 │  │ 重构API  │  │ 修复登录     │ │
│ │ [未分配] │  │ @agent-A │  │ @agent-B │  │ PR #12       │ │
│ ├──────────┤  └───────────┘  └──────────┘  ├───────────────┤ │
│ │ #40 feat │                                │ #31 feat     │ │
│ │ 用户注册 │                                │ 新增搜索     │ │
│ │ [未分配] │                                │ PR #10       │ │
│ └──────────┘                                └───────────────┘ │
│                                                                │
│ ┌─ 开发助手 ────────────────────────────────────────────────┐ │
│ │ 🟢 @bug-fixer (空闲)  🟡 @feature-dev (执行中 #35)       │ │
│ │ 🟢 @doc-writer (空闲)                                    │ │
│ └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

#### Issue 卡片组件（`IssueCard`）

展示单个 Issue 的详细信息：
- Issue 编号、标题、标签（颜色标识）
- 分配的 Agent（头像 + 名称）
- 当前执行阶段（进度指示）
- PR 链接（可点击跳转）
- 自动化等级标记（全自动/半自动）
- 操作按钮：分配、执行、暂停、恢复

### 6.2 现有页面修改

- **群聊列表**：项目群聊显示仓库图标 + 仓库名标记
- **群聊详情**：项目群聊增加「看板」Tab，与「消息」「设置」并列
- **助手管理**：增加 Agent 的 `agentRole` 配置（worker / project_manager）
- **群聊设置**：项目群聊增加「同步设置」（同步间隔、过滤标签）

---

## 7. 技术依赖

### 7.1 新增 npm 依赖

| 包名 | 用途 |
|------|------|
| `@octokit/rest` | GitHub API 调用（Issues、PR、Repos） |
| `@octokit/auth-oauth-device` | OAuth Device Flow（适合桌面应用） |
| `simple-git` | Git 操作封装（branch、commit、push） |

### 7.2 现有依赖复用

| 依赖 | 复用场景 |
|------|---------|
| `@anthropic-ai/claude-agent-sdk` | Claude Agent 执行（已有） |
| `socket.io` | 实时状态推送（已有） |
| `@prisma/client` | 数据模型（已有） |
| LangChain | 内置 Agent 执行器（已有） |

---

## 8. 配置项

### 8.1 环境变量新增

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GITHUB_CLIENT_ID` | 无 | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | 无 | GitHub OAuth App Client Secret |
| `GITHUB_SYNC_DEFAULT_INTERVAL` | `5` | 默认同步间隔（分钟） |
| `GITHUB_OAUTH_PORT` | `18921` | OAuth 本地回调监听端口 |
| `ISSUE_EXECUTION_MAX_RETRIES` | `3` | 测试失败最大重试次数 |
| `ISSUE_DEFAULT_AUTOMATION` | `semi_auto` | 默认自动化等级 |

### 8.2 GitHub OAuth App 配置

需在 GitHub 上创建 OAuth App：
- Homepage URL: `https://teamagentx.dev`（或应用主页）
- Authorization callback URL: `http://localhost:{port}/github/callback`
- 权限范围：`repo`（访问仓库）、`read:org`（读取组织）

---

## 9. 错误处理

### 9.1 常见错误场景

| 场景 | 处理策略 |
|------|---------|
| GitHub Token 过期 | 自动刷新，刷新失败通知用户重新授权 |
| 本地仓库冲突（branch 已存在） | 自动用时间戳后缀生成唯一分支名 |
| 测试持续失败 | 3 次重试后暂停，Agent 输出诊断报告到群聊 |
| Git push 失败（网络问题） | 自动重试 2 次，仍失败通知用户 |
| PR 创建失败（权限不足） | 检测权限，提示用户检查仓库权限 |
| Agent 执行超时 | 可配置超时时间（默认 30 分钟），超时后暂停 |
| 合并冲突（main 分支有新提交） | Agent 自动 rebase，冲突过大则暂停通知 |

### 9.2 状态回滚

Issue 执行过程中任何阶段失败，系统：
1. 保留当前进度（已修改的文件不回滚）
2. 更新 Todo 状态为 `failed`
3. 在群聊中发送错误报告，包含失败原因和当前进度
4. 用户可以修复问题后手动触发 resume

---

## 10. 分期实施计划

### Phase 1：基础框架（v1.0）

- GitHub OAuth 授权流程
- 仓库导入 + 群聊创建
- Issues 同步（CronTask 驱动）
- 看板视图（基础版：列展示 + 拖拽分配）
- 手动分配 Agent + 手动触发执行

### Phase 2：自动执行（v1.1）

- 项目管理助手（分析 + 自动分配）
- Issue 完整执行流程（分支 → 编码 → 测试 → PR）
- 自动化等级配置
- 执行过程实时流式输出到群聊
- 失败重试 + 错误处理

### Phase 3：体验优化（v1.5）

- 多仓库项目（一个群聊关联多个仓库）
- Issue 评论同步（双向）
- PR Review 集成（Agent 回应 Review 意见）
- 执行报告仪表盘（成功率、耗时、Token 消耗）
- 智能调度（根据 Agent 负载和能力自动分配）

### Phase 4：团队协作（v2.0）

- 多用户共享看板
- 权限控制（谁能分配、谁能执行）
- 审批流程（重要 Issue 需要审批才能执行）
- 活动日志和审计
