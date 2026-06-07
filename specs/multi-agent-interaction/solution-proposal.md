# 多 Agent 群聊交互问题 — 解决方案提案

> 供团队讨论。完整需求分析见 [requirements.md](./requirements.md)。

---

## 一、核心问题

### 根本原因

> **平台把"何时停止"的控制权委托给了概率性的 LLM，而不是在代码层实现确定性的终止机制。**

系统提示词里写了"讨论完毕后输出 [讨论结束]"，但代码层没有读这个信号。LLM 在长上下文末尾注意力衰减，会忘记规则，且默认倾向礼貌推进对话而不是主动终止。

2025 年 multi-agent 行业共识（Google ADK）：
> "The system running the agent, not the agent itself, is ultimately responsible for guaranteeing termination."

---

## 二、具体问题清单

### P0：代码确认，现在就会出问题

| # | 问题 | 触发条件 | 代码位置 |
|---|---|---|---|
| P0-1 | **A→B→A 无限循环** | 助手 A 触发 B，B 回复中 @ 了 A，无限循环 | `handler.ts` 无循环检测 |
| P0-2 | **sendMessageToAgent 工具也会触发循环** | 助手用工具调用向另一助手发消息，同样走 `receivedMessage` 事件，无守卫 | `agent-dispatch.service.ts:182` |
| P0-3 | **扇出风暴：协调者同时 @ 多个助手，所有回复各自触发协调者** | 1 条消息 → N 个助手 → N 条回复各自触发协调者 → 指数级放大 | `handler.ts:226-258` 无扇入聚合 |
| P0-4 | **[讨论结束] 信号没有代码实现** | 协调者发出 `[讨论结束]`，消息里其他 @ 照常被处理，群继续运转 | `handler.ts` 无该字符串检测 |

### P1：架构设计缺陷，会限制扩展

| # | 问题 | 影响 |
|---|---|---|
| P1-1 | 无轮次计数器 | 无法给群设置"最多跑 N 轮"的硬上限 |
| P1-2 | agent 间无通信层级 | 所有 agent 平等，任意 agent 可触发任意 agent，缺乏 manager/worker 层级 |
| P1-3 | 任务无验收标准 | agent 汇报"完成了"但无客观验收，任务质量无法评估 |

---

## 三、解决方案

### 方案概述

在消息总线层（`handler.ts` + `agent-dispatch.service.ts`）注入三个轻量守卫模块，不改变现有架构，不引入新基础设施。

```
用户消息
  │
  ▼
[TerminationDetector] ──── 群已终止？→ 阻断
  │
  ▼
[RoundCounter] ──────────── 超轮次上限？→ 注入强制收尾指令
  │
  ▼
[LoopGuard] × 每个被 @ 的 agent ──── 目标 agent 已在对话链中？→ 阻断
  │
  ▼
enqueueAgentTask（入队执行）
```

两条触发路径都注入：消息中的 `@` 解析路径（handler.ts）和 `sendMessageToAgent` 工具路径（agent-dispatch.service.ts）。

---

### 守卫 1：LoopGuard — 对话链循环检测

**解决问题**：P0-1、P0-2

**原理**：用内存 Set 追踪当前对话链中出现过的 agent，每次 agent 触发前检查目标 agent 是否已在链中。

```
用户触发 → A 加入链 Set{A}
A 触发 B → Set{A, B}
B 回复中 @A → 检查 Set，A 已在 → 阻断，广播"[系统] 检测到对话循环，已阻断 @A 的触发"
```

**关键设计决策**

| 决策 | 选择 | 理由 |
|---|---|---|
| 状态存储 | 内存 Map/Set | 会话级短暂数据，重启可接受；不引入 Redis |
| 检测算法 | Set 包含检测 | 链长 < 20，O(1)；Tarjan SCC 是过度工程 |
| 链重置时机 | 用户发新消息 / 60 秒超时 | 新话题应允许重新触发 |
| 异常处理 | try/catch 降级放行 | 守卫 bug 不应阻塞消息流 |

**代码位置**：新建 `server/src/core/agent/agent-handler/loop-guard.ts`

---

### 守卫 2：RoundCounter — 每群轮次计数器

**解决问题**：P0-3（兜底）、P1-1

**原理**：计数每次用户消息后 agent 自动触发的轮次。达到上限时向协调者注入强制收尾指令，并阻断后续所有触发。

```
用户消息 → round = 0
A 触发 B → round = 1
B 触发 C → round = 2
...
round = maxAgentRounds → 向协调者注入：
  "[系统强制] 对话已达第 5 轮上限，请立即生成最终汇总并输出 [讨论结束]"
  → 此后所有触发阻断，等待用户下一条消息
```

**关键设计决策**

| 决策 | 选择 | 理由 |
|---|---|---|
| 默认上限 | 5 轮 | AutoGen 默认 10，我们场景更简单；可通过 DB 字段 / env var 调整 |
| 强制收尾方式 | 向协调者注入前置指令 | 比直接截断更优雅，用户能看到汇总 |
| 协调者识别 | `chatRoom.defaultAgentId` | 避免新增 DB 字段；语义已对应总控 |
| 手动模式 | 跳过计数 | 手动模式无多 agent 协作，不应影响 |

**需要的 DB 改动**：
```prisma
model ChatRoom {
  maxAgentRounds Int @default(5)  // 新增字段
}
```

**代码位置**：新建 `server/src/core/agent/agent-handler/round-counter.ts`

---

### 守卫 3：TerminationDetector — 终止信号检测

**解决问题**：P0-4

**原理**：检测协调者消息中的 `[讨论结束]` 标记，将群置为 terminated 状态，阻断所有后续 agent 触发。

```
协调者发送消息含 "[讨论结束]"
  → 群置为 terminated 状态（内存）
  → 该消息正常广播给用户（用户能看到收尾内容）
  → 后续所有 agent @ 触发阻断
  → 用户发新消息 → terminated 状态清除，恢复正常
```

**关键设计决策**

| 决策 | 选择 | 理由 |
|---|---|---|
| 只有协调者能触发终止 | coordinatorAgentId = defaultAgentId | 防止非授权 agent 恶意中止群聊 |
| 终止状态持久化 | 不持久化（内存）| 服务重启可接受；避免引入 DB 操作 |
| 当前消息本身是否阻断 | 不阻断 | 协调者的收尾消息需要让用户看到 |

**代码位置**：新建 `server/src/core/agent/agent-handler/termination-detector.ts`

---

### Feature Flag

所有守卫通过一个 env var 控制，支持灰度和一键回滚：

```
ENABLE_LOOP_GUARD=true   # 开启所有守卫（默认 true）
ENABLE_LOOP_GUARD=false  # 跳过所有守卫，行为与改动前完全一致
```

---

## 四、实现范围边界

### 本期做

- LoopGuard（A→B→A 循环阻断）
- RoundCounter（轮次硬上限 + 强制收尾）
- TerminationDetector（`[讨论结束]` 代码层实现）
- Feature flag 支持灰度回滚
- 守卫异常降级放行（不阻塞消息流）

### 本期不做

- 扇入聚合窗口（协调者等所有 worker 回复后统一汇总）— 轮次上限已提供基础兜底，聚合窗口需要更多状态设计
- `maxAgentRounds` 在 UI 界面可配置 — env var 默认值已解决核心问题
- 消息流可视化（agent 触发链实时图）— 核心问题解决后的加分项
- 状态持久化到 Redis/DB — 单进程 + 重启可接受
- Tarjan SCC 图论循环检测 — Set 包含 O(1) 已足够，过度工程

---

## 五、实现计划（Week 1 MVP）

| 天 | 任务 | 产出 |
|---|---|---|
| Day 1 | 新建 `loop-guard.ts` + `termination-detector.ts`，单元测试 | 两个守卫模块 |
| Day 2 | 新建 `round-counter.ts`，单元测试 | 轮次守卫模块 |
| Day 3 | Prisma migration 加 `maxAgentRounds` 字段 | DB schema 更新 |
| Day 4 | 在 `handler.ts` 和 `agent-dispatch.service.ts` 注入守卫链 | 两条路径均受保护 |
| Day 5 | Feature flag 接入，集成测试（A→B→A / 扇出 / 收尾信号） | 可灰度发布 |

**改动涉及文件**（3 个现有文件 + 3 个新文件）：
- `server/src/core/agent/agent-handler/handler.ts` — 注入守卫链
- `server/src/core/agent/agent-handler/agent-dispatch.service.ts` — sendMessageToAgent 注入守卫
- `server/prisma/schema.prisma` — 新增 maxAgentRounds
- `loop-guard.ts`（新建）
- `round-counter.ts`（新建）
- `termination-detector.ts`（新建）

---

## 六、讨论议题

1. **`maxAgentRounds` 默认值** — 建议 5，是否合适？某些复杂群聊需要更多轮次？
2. **协调者识别方式** — 用 `defaultAgentId` 还是新增一个显式"协调者"角色？
3. **扇入聚合** — 是否本期就做？（协调者等所有 worker 回复聚合后再执行，需要状态机设计）
4. **系统提示词配合** — 守卫上线后，是否需要同步更新助手的群规则提示词，让 LLM 更主动地输出 `[讨论结束]`？
