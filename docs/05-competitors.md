# 05 · 竞品分析

[English](05-competitors_EN.md) | 中文

> 把"AI 帮人写代码 / 干活"这件事的所有玩家分成 5 条赛道，逐家拆**它最值钱的设计是什么、我们能借鉴什么、不能学什么**。

## 1. 赛道地图

| 赛道 | 代表产品 | 调度方式 | 与本平台关系 |
|------|---------|---------|-----------|
| **IDE 单 Agent** | Cursor、GitHub Copilot、JetBrains AI | 编辑器内补全 + 一问一答 + 单 Agent | 互补：他们专注"在编辑器里写代码"，我们专注"调度多个角色干一件复杂事" |
| **CLI 单 Agent** | Claude Code、Aider、Cline / Roo Code、Continue | 终端内单 Agent + 工具调用 | 互补：可以把它们当作我们的 Engineer Agent 嵌进群里 |
| **自主代理** | Devin、SWE-agent、OpenHands、Manus | Agent 自规划长任务 | **直接竞争**：他们也搞"完成一个工程任务"，但走"超级员工"路线 |
| **多 Agent 框架** | CrewAI、AutoGen、LangGraph、MetaGPT | 代码定义角色和流程 | 间接竞争：他们是开发者写代码用的库，我们是 GUI 产品 |
| **工作流编排** | Dify、Coze、n8n、Flowise | 拖拉拽 DAG | 间接竞争：他们做的是固定流程，我们做的是**对话式流程** |

---

## 2. 逐家拆解

### 2.1 Cursor

**最值钱的设计**：
- **编辑器深度集成**：上下文不需要用户主动塞——光标位置、当前文件、项目结构、最近变更全自动给模型
- **Auto 模式**：按上下文长度和任务类型智能路由模型（Sonnet / Opus / Haiku 自动选）
- **Composer / Tab 补全 / Inline Edit 三档**：覆盖从"小修小补"到"多文件重构"

**我们可以借鉴**：
- 上下文自动收集思路 → 任务卡 `related_files` 自动反向索引
- 模型路由策略 → 任务卡 `complexity` 字段驱动 model_strategy
- 三档体验对应：快速对话（轻）→ 单助手任务（中）→ 群协作（重）

**不该学**：
- 锁死在编辑器里（我们要走出 IDE，做"虚拟办公室"）

---

### 2.2 GitHub Copilot / Copilot Workspace

**最值钱的设计**：
- **Workspace** 概念：从 issue → spec → plan → code → PR 一条龙，每步用户可改
- 跟 GitHub 深度集成：天然有 PR / Issue / CI 上下文

**我们可以借鉴**：
- "spec → plan → code → PR" 链路结构 → 任务卡的 `steps` + `expected_output` 是同思路
- "每步用户可改" → 风险等级 + 权限模式（详见 04 章 K 节）

**不该学**：
- 重度依赖 GitHub 生态（我们要支持任意本地项目）

---

### 2.3 Claude Code（参考价值最高）

**最值钱的设计**：
- **Permission mode**：`plan` / `acceptEdits` / `bypass` 三档权限模式
- **Hooks 钩子系统**：`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop` 等事件点拦截
- **Skills 包系统**：用 frontmatter + markdown 描述能力包，可装载、可触发，社区生态化
- **Plan mode**：不直接执行，先出计划交用户审
- **Subagent**：可在主 agent 内调度子 agent
- **Memory**：file-based 持久记忆系统

**我们可以借鉴**：
- ⭐ **Permission mode** → 直接抄成群级权限设置，对应 04 章 K 节
- ⭐ **Hooks** → 群规则的"他律层"就是抄 hooks 思路（pre_message_send / post_tool_use 等）
- ⭐ **Skills 格式兼容** → v0.1.0 已通过 symlink 兼容
- **Plan mode** → 总控的 task_card 拆解就是同思路
- **Subagent** → 群隐喻天然就是多 subagent 的可视化版

**已经学的**：
- ✅ Skill 格式兼容（symlink 模式直接挂 `~/.claude/skills/`）
- ✅ 流式 thinking 可视化
- ✅ 本地 Agent 复用（"使用本地 Agent 配置" → 接 Claude Code key）

**不该学**：
- 锁死在 CLI（我们要做 GUI 产品）

---

### 2.4 Aider

**最值钱的设计**：
- **每步 git commit**：每次助手改动自动 commit，靠 git 做断点和回滚
- **Repo map**：自动维护项目结构摘要，每轮注入模型上下文
- **`weak-model` 参数**：复杂改动用大模型、简单编辑用小模型
- **`/architect` 模式**：让 architect 模型规划、editor 模型实现

**我们可以借鉴**：
- ⭐ **每步 git commit** → 任务卡 ↔ git 分支强绑定（详见 04 章 D/I 联动方案）
- ⭐ **architect / editor 双模型** → 助手 model_strategy 的 primary / fallback_simple / fallback_complex
- **Repo map 自动注入** → 文件变更事件总线（详见 04 章 E 节）

**不该学**：
- 单 Agent 路线（我们押多 Agent）

---

### 2.5 Cline / Roo Code / Continue

**最值钱的设计**：
- VS Code 扩展，深度集成编辑器
- 工具调用透明（每个 file edit / bash 命令都展示）
- Plan / Act 双模式

**借鉴**：透明工具调用 → v0.1.0 已实现 `toolCalls` 流式展示

---

### 2.6 Devin（直接竞争对手 ⭐⭐）

**最值钱的设计**：
- **完整 session snapshot**：可暂停可恢复，跨天接着跑
- **行为录像**：屏幕级别的 session replay，事后可看 Devin 是怎么做的
- **批准点（Approval Points）**：在关键决策处停下来等用户拍板
- **卡住自救**：尝试别的路径或主动 ask user
- **完整虚拟环境**：Devin 有自己的容器、浏览器、IDE

**我们可以借鉴**：
- ⭐ **Session snapshot** → 任务卡 step_progress + 决策日志（详见 04 章 I 节）
- ⭐ **行为录像** → 流式 thinking + executionRecords 已经接近，可加屏幕录像作为客观证据
- ⭐ **批准点** → 风险等级 + 权限模式（详见 04 章 K 节）
- ⭐ **卡住自救** → 任务卡心跳产出 + 静默告警 + 自动换路（详见 04 章 H 节）

**不该学**：
- 单 Agent "超级员工"路线（我们押多 Agent 群协作的可观测性）
- 完全黑盒执行（用户看不到中间过程，对工程师不友好）

---

### 2.7 SWE-agent / OpenHands

**最值钱的设计**：
- 开源、可自托管
- ACI（Agent-Computer Interface）抽象，让 agent 用类似人类的方式操作终端 / 浏览器

**借鉴**：ACI 思路 → 我们的工具集（Read/Edit/Bash 等）就是同思路；可考虑加 Browser 工具支持。

---

### 2.8 CrewAI

**最值钱的设计**：
- ⭐ **Role-based agents**：每个 agent 有 role / goal / backstory，明确分工
- ⭐ **Tools 硬白名单**：每个 role 装载不同 tools，没装就不能用——**能力即权限**
- **Task 串/并行**：task 之间显式声明依赖
- **Task.context**：任务可声明依赖哪些前置任务的输出，不让全部历史漫灌
- **Pydantic 输出 schema**：task 输出绑定结构，schema 不对就重生成
- **Manager agent**：可以由 LLM 担任 manager 动态分配 task

**我们可以借鉴**：
- ⭐⭐⭐ **Tools 硬白名单**：04 章 F 节角色越界的核心方案就是抄这个
- ⭐⭐ **Task.context** 显式依赖：04 章 B 节上下文订阅可借鉴
- ⭐⭐ **Pydantic schema**：04 章 G 节客观验收的 verifications 字段是同思路

**不该学**：
- 写代码定义流程（我们做 GUI）

---

### 2.9 AutoGen

**最值钱的设计**：
- **GroupChat + GroupChatManager**：多 Agent 对话的核心抽象
- ⭐ **Speaker selection function**：显式选下一发言人的函数，可注入业务规则
- 各种**对话模式**：round-robin、selector、broadcast、nested-chat
- **Conversable Agent** 抽象：所有 agent 都能对话

**我们可以借鉴**：
- ⭐⭐⭐ **Speaker selection function**：04 章 A1 防循环、A2 扇出风暴、C @ 触发歧义都可以借这个思路——**把发言权调度从"被 @ 触发"升级为"显式调度函数"**
- 多种对话模式 → 群规则的不同预设（流水线模式 / 自由讨论模式 / 角色组模式）

**不该学**：
- Python 库形态（我们做 GUI）

---

### 2.10 MetaGPT

**最值钱的设计**：
- ⭐ **SOP 强制**：把行为约束变成代码层的标准操作流程，不是提示词——不遵守的输出根本不会进入下一步
- **Role inheritance**：role 之间可继承
- **Message bus + 角色订阅**：每个角色只对自己关心的消息类型响应（不是无差别 @ 触发）
- **PRD → 设计 → 代码 → 测试** 完整软件工程 SOP

**我们可以借鉴**：
- ⭐⭐⭐ **代码层 SOP**：04 章 L 节群规则失效的核心方案就是这个——把"他律层"做成代码而非提示词
- ⭐⭐ **Message bus + 订阅**：04 章 B 节上下文爆炸的核心方案——助手按级订阅消息
- "测试通过"作为 SOP 硬节点 → 04 章 G/M 节客观验收

**不该学**：
- 完整软件工程 SOP 太死板（我们要的是"群协作"灵活度）

---

### 2.11 LangGraph

**最值钱的设计**：
- ⭐ **State machine 显式建模**：把多 agent 协作做成有向图，节点是 agent，边是状态转移
- **Checkpointer**：状态快照可持久化、可恢复
- **Time travel**：可回到过去某个状态分叉重跑
- **Human-in-the-loop**：节点级显式插入用户介入点

**我们可以借鉴**：
- ⭐⭐ **Checkpointer** → 任务卡的 step_progress + git 分支已经是类似方向
- **Human-in-the-loop** → 04 章 K 节风险等级 + 权限模式
- **Time travel** → 任务卡级别的"重做"

**不该学**：
- DAG 显式建模（我们要"对话式动态调度"，不是预编排）

---

### 2.12 Dify / Coze

**最值钱的设计**：
- 节点级人工介入点
- 试运行调试器（看每个节点的输入输出）
- 模板市场

**借鉴**：
- 模板市场 → 06 章路线图阶段三的"团队模板市场"
- 试运行调试器 → 已通过 cron 的"立即测试"+ executionRecords 实现

**不该学**：拖拉拽 DAG 模式

---

### 2.13 LangSmith / Langfuse / Helicone

**最值钱的设计**：
- LLM 应用的可观测性平台：trace、eval、cost tracking
- 每次输出按规则打分，沉淀质量曲线

**借鉴**：04 章 J/M 节的成本看板 + 质量看板就是同思路。可考虑直接对接 OTLP 协议导出。

---

## 3. 横向对比表

### 3.1 能力维度

| 维度 | Cursor | Claude Code | Devin | CrewAI | AutoGen | MetaGPT | Dify | **TeamAgentX** |
|-----|--------|-------------|-------|--------|---------|---------|------|---------------|
| 多 Agent 协作 | ❌ | 部分（subagent） | ❌（单超级 Agent） | ✅ | ✅ | ✅ | ❌ | ✅✅ |
| GUI 配置 | ✅ | 部分（CLI 为主） | ✅ | ❌（写代码） | ❌（写代码）| ❌（写代码）| ✅ | ✅ |
| 任务卡 / 结构化任务 | ❌ | 部分（plan） | ❌ | ✅ | ❌ | ✅（SOP） | 节点级 | ✅ |
| 上下文项目隔离 | 项目级 | 项目级 | session 级 | 进程级 | 进程级 | 进程级 | 工作流级 | **群级三层** |
| Skill / 能力包系统 | ❌ | ✅（最完整） | ❌ | tools | tools | actions | 节点 | ✅（兼容 Claude Code） |
| 工具白名单（强约束） | ❌ | ✅ | ❌ | ✅ | 部分 | ✅ | ✅ | 🔵（计划） |
| 人工介入策略 | 自由问 | permission mode | 批准点 | 任务级 | 节点级 | 节点级 | 节点级 | 三触发点 + 计划权限模式 |
| 客观验收 / SOP | ❌ | ❌ | 测试 + 截图 | guardrails | ❌ | ✅ | 节点校验 | 🔵（计划） |
| 中断恢复 | ❌ | plan 持久 | ✅（snapshot） | ❌ | checkpointer | ❌ | ❌ | 🔵（计划） |
| 模型路由 | ✅ auto | 部分 | ❌ | 配置 | 配置 | 配置 | 节点配 | 🔵（计划） |
| 群级 Cron | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 部分 | ✅⭐ |
| 适合场景 | 写代码 | 中复杂度任务 | 长任务自动化 | 工程师定制 | 工程师定制 | 工程师定制 | 重复流程 | **个人开发者复杂多步** |

### 3.2 用户体验维度

| 维度 | Cursor | Claude Code | Devin | CrewAI | Dify | **TeamAgentX** |
|------|--------|-------------|-------|--------|------|---------------|
| 上手成本 | 低 | 中（CLI） | 低 | 高（写代码） | 中（拖拽）| **极低（人人会用群）** |
| 透明度 | 中 | 高（流式 + tool） | 中（行为录像）| 低 | 中 | **高（流式 thinking + executionRecords）** |
| 调试能力 | 一般 | 好 | 好 | 弱 | 好 | **好（context 检视 + execution 详情）** |
| 协作可见性 | N/A | 弱（subagent 黑盒）| N/A | 弱 | DAG 可视 | ✅ **群对话天然可见** |

---

## 4. 该抄的招（汇总）

按"投产比 × 可行性"排序：

| 灵感来源 | 招式 | 用在我们哪个问题 | 优先级 |
|---------|------|----------------|--------|
| Claude Code | Permission mode + Hooks | K 人类介入 + L 群规则 | 🔴 高 |
| CrewAI | Tools 硬白名单 | F 角色越界 | 🔴 高 |
| AutoGen | Speaker selection function | A1 防循环 + A2 扇出 + C @歧义 | 🔴 高 |
| MetaGPT | 代码层 SOP + 消息订阅 | L 群规则失效 + B 上下文爆炸 | 🔴 高 |
| Aider | 每步 git commit | D 文件冲突 + I 中断恢复 | 🔴 高 |
| CrewAI | Pydantic 输出 schema | G 状态漂移 + M 评估盲区 | 🔴 高 |
| Devin | Session snapshot | I 中断恢复 | 🟡 中 |
| Devin | 卡住自救 | H 死锁僵局 | 🟡 中 |
| Cursor | Auto 模型路由 | J 模型错配 | 🟡 中 |
| Devin | 行为录像 | M 评估盲区 | 🟢 低 |
| Dify | 模板市场 | 路线图阶段三 | 🟢 低 |
| LangSmith | OTLP trace 导出 | M 评估盲区扩展 | 🟢 低 |

## 5. 不该抄的（避坑）

| 设计 | 为什么不抄 |
|------|-----------|
| 完全自主"超级员工"（Devin 路线）| 我们押注"群聊 + 多角色"，不押单 Agent 万能；用户体感"看见多角色协作"是核心价值 |
| 拖拉拽 DAG（Dify/Coze 路线）| 我们押注"对话式动态调度"，DAG 太僵 |
| 代码定义流程（CrewAI/LangGraph 路线）| 目标用户是"动手开发者但不想写编排代码的人"，GUI 配置才是核心 |
| 完全开源框架（AutoGen/MetaGPT 路线）| 框架是开发者工具，我们是面向终端用户的产品；可以**借鉴架构思路**但不用**做成框架** |
| 锁死在编辑器（Cursor/Copilot 路线）| 编辑器是工作流的一部分而非全部；我们要做"虚拟办公室"，覆盖编辑器 + 文档 + 资料调研 + 任务管理 |
| GitHub 强绑定（Copilot Workspace）| 用户的项目可能不在 GitHub，本地项目也要支持 |

## 6. 一句话差异化

**别人解决"让 AI 替我干一件事"，我们解决"让 AI 团队替我干一件复杂的事"。**

把开发协作里"分工 / 职责 / 边界 / 收尾 / 验收"这些**人类团队已经验证过的工程实践**，平移到 AI 团队里。

## 7. 我们已经超过竞品的地方

不只是"模仿 + 整合"——v0.1.0 已经有几个独有亮点：

| 独有特性 | 价值 |
|---------|------|
| **群级 Cron** | 没人做"在群里挂定时任务" |
| **粘贴文本一键解析模型配置** | UX 上一骑绝尘 |
| **流式提示词优化** | 帮用户写好 system prompt 是新角度 |
| **通过聊天创建 skill**（统一"@群助手"系统助手）| Skill 创建无门槛 |
| **本地 Agent 复用**（接 Claude Code key）| 跟 Claude Code 互补而非竞争 |
| **三层 workDir 策略** | 群级共享 + 助手默认 + 快速对话独立 |
| **每个助手在每个群独立的上下文 / 历史注入开关** | 比 CrewAI 等更细粒度 |
| **移动端扫码连接** | 跨端协作 |

---

详细路线图见 [06-roadmap.md](06-roadmap.md)。
