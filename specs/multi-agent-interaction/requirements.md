# Requirements Document: 多 Agent 群聊交互流程控制

**Generated**: 2026-05-16
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 针对现在软件的模式。有助手流程混乱、相互艾特循环的问题。真如之前 docs 下那个文档。把现在这些问题都列出来。针对我们的软件。应该如何去解决这些问题。要通过算法或者工程型的改造。去规避。主要是解决群里多 agent·交互的问题。单独在 docs 新建一个文件夹。先把问题都列出来。如何能一劳永逸的解决这些问题

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| **AutoGen GroupChat** | `max_round` 硬上限 + `is_termination_msg` 回调函数 + `speaker_selection` 返回 `None` 优雅终止 | 外部硬上限 + 终止信号回调 + 发言权算法三层防御 |
| **Google ADK LoopAgent** | `max_iterations` + 子 agent 通过 `escalate=True` 提前退出；Loop Guardrails 是外部、客观、确定性机制，覆盖 agent 内部逻辑 | 外部守卫优先于 LLM 自律，不依赖模型判断 |
| **LangGraph** | 有向图 + 条件边（conditional_edge）+ interrupt 节点；状态机图替代自由消息流 | 结构化流程图 vs 无结构消息触发 |
| **CrewAI** | `Process.hierarchical`：只有 manager 发起扇出；每 agent 独立工具白名单 | 扇出只从 manager 发起；能力即权限 |
| **Azure AI Agent / Fan-out** | 显式 merge 函数 + `completion_status` 合并策略 + 超时阈值 | 扇入必须有合并逻辑，不能各触发一次 |

### 用户心智模型
> 用户期望"AI 助手团队"像真实团队一样：分工明确、有始有终，不会自己"开小会"停不下来。AI 群聊一旦失控循环，用户会完全失去信任，直接切回手动模式或放弃平台。

### 行业惯例（2025 年工业共识，违背需极强理由）
1. **终止责任在平台，不在 LLM**：「The system running the agent, not the agent itself, is ultimately responsible for guaranteeing termination」—— Google ADK Dev Guide, 2025
2. **扇出必须配显式扇入合并**：fan-out 缺 merge 函数是「最常见的生产级失效模式」—— QUBytes, 2025
3. **硬轮次上限是基础必备**：AutoGen、ADK、LangGraph 均强制实现，是 Basic 需求

### 已知反模式
- **"Bag of Agents"**：无层级无守门人，每个 agent 向所有人开放通道 → 循环逻辑 / 幻觉回声（Towards Data Science, 2025）
- **让 LLM 自己判断终止**：模型倾向礼貌响应，注意力在长上下文末尾衰减，终止信号失效
- **用对话 @ 作为状态汇报**：触发器被误用为状态机事件，产生指数级扇出风暴

### 基准结论
- ✅ 我们的方向（消息总线外部强制终止）与 2025 工业共识完全对齐
- ⚠️ 当前偏离：把"何时停止"委托给系统提示词（自律层），违背行业惯例
- ❌ 风险："Bag of Agents"反模式已在生产中触发，不修复持续损失用户信任

---

## 三、可行性 & 假设清单

### 隐性假设

| # | 假设 | 风险等级 | 不成立时的影响 |
|---|---|---|---|
| 1 | 消息总线可以在不破坏 Socket.io 实时性前提下加拦截层 | Low | 已有 `agentTriggerMode` 开关验证可拦截 |
| 2 | @ 列表可以从消息内容可靠解析 | Low | `parseMentions()` 已实现且内部已去重 |
| 3 | 群内"轮次"可通过内存状态按 chatRoomId 追踪 | Low | Node.js 单线程，Map 足够 |
| 4 | agent 不会通过 `sendMessageToAgent` 工具绕过 @ 解析直接触发循环 | **High** | `sendMessageToAgent` 同样走 `globalEmit` → `receivedMessage`，是第二条循环路径，**必须也加守卫** |
| 5 | 协调者（总控）可通过 `defaultAgentId` 或 `agentLevel: system` 识别 | Medium | 需确认群内协调者的识别方式 |

### 技术可行性

- **当前栈**：Fastify + Socket.io + Node.js EventEmitter 消息总线，Prisma/SQLite，TypeScript
- **可复用入口**：
  - `handler.ts:setupAIHandlers` 的 `receivedMessage` 监听器（路径 1 拦截点）
  - `agent-dispatch.service.ts:sendMessageToAgent`（路径 2 拦截点）
  - `enqueueAgentTask()` 调用前（最终收口）
- **gitnexus 发现**：`setupAIHandlers` 使用 EventEmitter 动态分发，gitnexus 无法追踪完整调用链，但代码已人工确认。当前 diff 已涉及 handler.ts / message-utils.ts / status.ts，风险等级 **HIGH**。
- **已知关键细节**：`parseMentions()` 已在第 161 行做了 `!mentions.includes(name)` 去重，单条消息内重复 @ 已不是问题。
- **可行性**：✅ 清晰路径——所有拦截点已定位，改动范围可控

### 依赖方识别

- **受影响方**：所有开启 auto 模式的群聊（当前最常用模式）
- **上游依赖**：`taskQueueService.enqueue()`、`processQueue()`——守卫在这两者之前介入，不改接口
- **下游依赖**：无——守卫只拦截触发，不改执行链

### 范围边界

**本期做：**
- 消息总线层的 A→B→A 循环检测（两条路径均覆盖）
- 每群硬轮次上限（`maxAgentRounds`，默认 5）
- `[讨论结束]` 终止信号代码层检测与状态设置
- 超轮次时向协调者注入强制收尾指令

**本期不做（明确推迟）：**
- 扇入聚合窗口（Should 级，涉及更多状态设计，Week 2-3）
- 工具白名单（F 节，独立模块）
- 任务卡 verifications 客观验收（G 节，独立模块）
- 消息分级订阅（B 节，大架构改动）

**永不做：**
- 用随机 sleep/延迟"伪装"解决循环——只隐藏症状不治根因

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | `maxAgentRounds` 新增字段，已有数据不受影响 |
| API 合同变更 | Low | 不改 Socket.io 事件接口 |
| 用户侧行为变更 | **Medium** | auto 模式群聊现有行为改变（循环被打断、消息减少），需用 feature flag 灰度 |
| 下游系统影响 | Low | 仅影响触发逻辑，执行链不变 |

**总体可逆性**：Low cost（feature flag 可一键回滚）

---

## 四、5W2H 全景分析

**What** — 做什么
> 在 `server/src/core/agent/agent-handler/` 层，新增 LoopGuard（循环检测）、RoundCounter（轮次计数）、TerminationDetector（终止信号）三个独立守卫模块，在 `handler.ts` 的 `receivedMessage` 处理入口和 `agent-dispatch.service.ts` 的 `sendMessageToAgent` 工具路径中统一注入，实现平台层强制流程控制。

**Why** — 为什么做
> auto 模式下 agent 之间的任何 @ 或 `sendMessageToAgent` 工具调用都直接入队，无循环检测、无轮次上限、无终止信号处理。用户实际遭遇"群一直在转、token 飙升、永远不收尾"，已影响产品可用性和用户信任。2025 年工业共识明确：终止责任在平台不在 LLM。

**Who** — 谁来用
> 主要用户：在群里配置多个 AI 助手并开启 auto 模式的产品开发者 / 团队管理者
> 次要用户：群管理员（调整 `maxAgentRounds` 参数）
> 受影响方：所有当前正在 auto 模式运行的群聊中的 agent

**When** — 什么时候用
> 触发时机：任何 agent 消息包含 @ 其他助手，或任何 agent 调用 `sendMessageToAgent` 工具时（auto 模式）
> 使用频率：高频——每次 agent 发言都经过此逻辑
> 时间约束：P0 问题，当前已影响产品可用性

**Where** — 在哪里用
> 使用环境：服务端消息总线，Web / Mobile / Desktop 所有端共享
> 入口位置：`server/src/core/agent/agent-handler/handler.ts` + `agent-dispatch.service.ts` + 新增守卫模块

**How** — 怎么做
> 核心路径：消息/工具调用到达 → 终止状态检测（已终止→直接返回）→ 轮次检查（超限→注入收尾指令）→ 循环检测（已在链→发系统消息阻断）→ 通过则入队
> 技术方向：新增三个独立 TypeScript 模块，在两个入口统一注入守卫链；内存 Map 维护每群状态

**How Much** — 做到什么程度
> 规模：单群并发 agent 数量 < 20，消息频率 < 10/秒
> 质量标准：循环检测误判率 = 0（不误杀合法对话）；守卫延迟 < 1ms；硬上限 maxAgentRounds 100% 生效
> 验收底线：auto 模式下不再出现超过 `maxAgentRounds` 轮的 agent 对话；A→B→A 链在第 2 轮时被检测并终止

---

## 五、用户角色 & 使用场景

### 主要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 多 agent 平台运营者（产品开发者 / 技术团队负责人）|
| 使用频率 | 高频（每天）|
| 技术熟练度 | 技术专家 |
| 核心目标 | 让多个 AI 助手自动协作完成任务，不需要手动盯群 |
| 最大痛点 | auto 模式下群聊失控循环，token 飙升，任务永远不收尾 |

### 次要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 群配置管理员（负责设置群规则和参数）|
| 使用频率 | 低频（偶尔）|
| 技术熟练度 | 普通用户 |
| 核心目标 | 为不同类型的任务设置合适的轮次上限 |
| 最大痛点 | 不知道何时群聊"卡死"了，没有可见的状态提示 |

### 受影响方
- **AI 助手（agent）**：行为会被守卫拦截，某些 @ 触发会被阻断

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 协调者派单给 3 个助手 | 协调者发出含 3 个 @ 的消息 | 3 助手执行，协调者汇总一次 | 协调者不能被触发 3 次 |
| 两个助手互相等待反馈 | A 回复中 @ B，B 回复中 @ A | 任务推进而非无限循环 | 同一对 agent 的来回超过 N 轮应截断 |
| 协调者宣布任务完成 | 协调者消息含 `[讨论结束]` | 群聊闭环，不再触发任何 agent | 终止信号必须代码层处理，不依赖 LLM |
| agent 使用工具触发循环 | agent 调用 `sendMessageToAgent` 向另一 agent 发送消息，对方又用工具回传 | 工具触发的循环同样被检测 | 两条路径（@ 和工具）都需守卫 |

---

## 六、核心痛点 & 业务价值

### 场景 1：A→B→A 互 @ 循环

**现在的痛点**
> handler.ts 对任何 @ 直接调用 `enqueueAgentTask()`，无循环检测。A @ B 触发 B 执行，B 回复中 @ A 触发 A 再次执行，无限循环直到 token 耗尽或用户手动停止。`sendMessageToAgent` 工具调用同样走 `globalEmit` → `receivedMessage`，是第二条无防护路径。
> ✅ 代码已确认：handler.ts 和 agent-dispatch.service.ts 均无循环检测逻辑

**实现后的业务价值**
> 循环在第 2 轮（链中出现重复 agent）时被检测并自动阻断，用户不需要手动干预，不产生多余 token 消耗

**不实现的负面影响**
> 平台被定性为"不稳定"，用户切回手动模式或放弃使用 auto 功能，核心差异化能力失效

**价值可信度**：✅ 有代码确认（非推演）

---

### 场景 2：协调者被触发 N 次（扇出风暴）

**现在的痛点**
> 协调者 @ 3 个助手，3 个助手各自完成后均在回复里 @ 协调者。消息总线把这 3 条 @ 各自处理为独立触发，协调者被入队 3 次，分别产生 3 条汇总消息，每条汇总又可能 @ 其他助手……形成 3ⁿ 级别消息爆炸。
> ✅ 代码已确认：`for (const agentName of mentionNames)` 逐条入队，无聚合机制

**实现后的业务价值**
> 轮次计数兜底：即使无扇入聚合，超过 `maxAgentRounds` 后强制协调者收尾，将无限爆炸截断为有限次数

**不实现的负面影响**
> 单次用户指令可能触发数十次 LLM 调用，用户账单超预期，体验极差

**价值可信度**：✅ 有代码确认（非推演）

---

### 场景 3：群聊无法收尾

**现在的痛点**
> 文档设计了 `[讨论结束]` 标记，但 handler.ts 无对应代码：协调者发出含该标记的消息后，消息里的其他 @ 照常被处理，群聊继续运转。同时无轮次计数，group 对话可永续进行。
> ✅ 代码已确认：handler.ts 无 `[讨论结束]` 关键词检测，无 round counter

**实现后的业务价值**
> 协调者宣布结束后真正停止一切触发；达到轮次上限时强制注入收尾指令

**不实现的负面影响**
> 产品文档承诺的功能未实现，降低用户对平台的信任

**价值可信度**：✅ 有代码确认（非推演）

---

## 七、标准用户故事 & 验收标准

### Story 1：A→B→A 循环自动阻断

**User Story**: 作为多 agent 平台运营者，我想要当助手 B 在回复中 @ 回已在本轮对话链中的助手 A 时，平台自动检测并阻断该触发，以便我不需要手动停止失控的群聊。

**Acceptance Criteria**:
- [ ] AC1.1: When 助手 A 的消息触发助手 B，且 B 的回复中包含 `@A`，the system shall 检测到 A 已在当前对话链中，跳过 A 的入队，并向群内发送系统消息 `[系统] 检测到对话循环，已阻断 @A 的触发`
- [ ] AC1.2: When 用户发送新消息时，the system shall 重置当前群的对话链状态，此后 A 可被正常触发
- [ ] AC1.3: When 合法场景（用户 → A → B → 协调者，协调者回复不包含 @A），the system shall 不触发循环检测误判，协调者的触发正常入队
- [ ] AC1.4: When 助手通过 `sendMessageToAgent` 工具调用触发循环（而非消息中的 @），the system shall 同样检测并阻断，不因触发路径不同而漏判

**Out of scope for this story**: 超过 3 个 agent 的多跳循环（A→B→C→A）本期同样覆盖，只要链中出现重复即阻断

---

### Story 2：轮次硬上限强制收尾

**User Story**: 作为群配置管理员，我想要为群设置最大 agent 对话轮次（默认 5），当自动触发的轮次超过上限时系统强制让协调者收尾，以便即使 agent 无法达成共识，对话也在可预期步数内终止。

**Acceptance Criteria**:
- [ ] AC2.1: When 群内 agent 自动触发的轮次达到 `maxAgentRounds`，the system shall 向协调者（`defaultAgentId`）注入前置指令 `[系统强制] 对话已达第N轮上限，请立即生成最终汇总并输出 [讨论结束]`，且该轮之后不再处理任何新的 agent @ 触发
- [ ] AC2.2: When 用户发送新消息，the system shall 将当前群的轮次计数重置为 0
- [ ] AC2.3: When 群管理员在群设置界面将 `maxAgentRounds` 从默认值 5 修改为 10，the system shall 在该群后续对话中使用新上限
- [ ] AC2.4: When 群为手动模式（`agentTriggerMode: 'manual'`），the system shall 不执行轮次计数，不影响手动触发行为

**Out of scope for this story**: 快速对话（quickChat）群的轮次计数——快速对话为 1v1 模式，无多 agent 协作

---

### Story 3：终止信号代码层实现

**User Story**: 作为多 agent 平台运营者，我想要当协调者在消息中输出 `[讨论结束]` 标记时，平台代码层立即将该群标为已终止状态并阻断所有后续 agent 触发，以便协调者宣布结束后群聊真正停止。

**Acceptance Criteria**:
- [ ] AC3.1: When 协调者（群的 `defaultAgentId`）发送的消息内容包含字符串 `[讨论结束]`，the system shall 将该 chatRoomId 标记为 `terminated`，并阻断后续所有 agent 触发直到用户下一条消息
- [ ] AC3.2: When 非协调者 agent 的消息包含 `[讨论结束]`，the system shall 忽略该标记，记录一条 warn 日志，不触发终止
- [ ] AC3.3: When 群处于 `terminated` 状态时，用户发送新消息，the system shall 重置 `terminated` 状态，该消息按正常流程触发助手响应
- [ ] AC3.4: When 服务重启，the system shall 将所有群视为非 terminated 状态（内存状态不持久化，可接受）

**Out of scope for this story**: 其他终止词（`[任务完成]` 等）——本期只实现 `[讨论结束]`

---

### Decision Log

| Decision | Alternatives Considered | Why This Choice |
|---|---|---|
| 用内存 Map 维护群状态 | Redis / Prisma 持久化 | Node.js 单进程，状态是会话级短暂数据，重启可接受；不引入新基础设施 |
| 循环检测用 Set 包含检测 | Tarjan SCC 图论算法 | 实际链长 < 20，O(1) Set 查找已足够；Tarjan 是 YAGNI |
| 协调者识别用 `defaultAgentId` | 新增 DB coordinator 字段 | 避免 schema 改动；`defaultAgentId` 语义已对应总控 |
| 两条路径（@ 和工具）都加守卫 | 只守 handler.ts | sendMessageToAgent 也走 receivedMessage，只守一条路径会有漏洞 |

---

## 八、5Why 根因挖掘

**Surface requirement**: 防止助手相互 @ 形成无限循环

**Why 1**: 为什么助手会相互 @ 形成循环？
> Because: 每个助手收到 @ 后，在回复中提及其他助手来"汇报进展"或"请求协作"，触发新的 @ 入队

**Why 2**: 为什么这个触发链没有终止？
> Because: `handler.ts` 在 auto 模式下对任何 @mention 直接调用 `enqueueAgentTask()`，无循环检测、无轮次上限、无终止信号处理代码

**Why 3**: 为什么 handler.ts 没有这些判断？
> Because: 产品初期把"何时停止"的责任交给助手的系统提示词（群规则），依赖 LLM 自律，平台层没有实现对应机制

**Why 4**: 为什么 LLM 自律在这里失效？
> Because: LLM 在长上下文末尾注意力衰减，群规则被"遗忘"；且语言模型的默认倾向是有礼貌地推进对话，而非主动终止；「The system running the agent, not the agent itself, is ultimately responsible for guaranteeing termination」

**Why 5**: 为什么当时选择了 LLM 自律？
> Because: 早期产品形态不确定时，在代码层定义"何时停止"的规则难以决策。但现在真实使用场景已经明确，决策条件已成熟。

**Root Insight**: 平台把确定性的流程控制责任委托给了概率性的语言模型。终止条件、轮次上限、循环检测这类「确定性逻辑」必须在代码层实现，不能依赖 LLM。

**Implication for design**: 需求方向正确，无需重新定义范围。三个守卫模块就是把"流程控制"从提示词层迁移到消息总线代码层的最小改动。

---

## 九、Kano 需求分类

### Basic（用户默认期望，不做扣分）
- **循环检测与自动阻断** — 为什么是 Basic：AutoGen/ADK/LangGraph 均有硬终止机制，用户已建立"AI 框架必然有循环保护"的心智。缺失直接判产品不可靠
- **硬轮次上限** — 为什么是 Basic：所有 2025 主流 multi-agent 框架标配，用户期望默认存在，无上限的 AI 对话是完全不可接受的
- **终止信号有效执行** — 为什么是 Basic：文档承诺了 `[讨论结束]`，承诺未兑现等同于 Bug

### Performance（做得越好用户越满意）
- **循环误判率** — 改善轴：误判率越低，用户越敢用复杂的多 agent 协作模式
- **强制收尾指令质量** — 改善轴：协调者收到指令后生成的汇总越完整，用户体感越好

### Excitement（超预期惊喜）
- **扇入聚合窗口（协调者等所有回复后只汇总一次）** — ⚠️ Benchmark check：AutoGen 有类似机制（等待所有 worker 回复后 merge），但需要更多状态设计；当前 Basic 问题修复后再做
- **消息流可视化（agent 触发链实时图）** — ⚠️ Benchmark check：AutoGen Studio 有可视化，但对核心可用性无直接影响，属于加分项

### Indifferent / Reverse
- **Tarjan SCC 循环检测算法** — Indifferent：用户感知不到算法差异，Set 包含已足够，过度工程反而增加维护负担。建议不做

### Kano-MoSCoW 对齐检查

| Kano 类型 | 期望 MoSCoW | 当前分配 | 是否有偏差 |
|---|---|---|---|
| Basic：循环检测 | Must | M1 | ✅ 对齐 |
| Basic：轮次上限 | Must | M2 | ✅ 对齐 |
| Basic：终止信号 | Must | M3 | ✅ 对齐 |
| Performance：误判率 | Should | S1 | ✅ 对齐 |
| Excitement：扇入聚合 | Could | S2（Should）| ⚠️ 略偏高，但有实际需求支撑，保留 Should |

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | Requirement | Evidence |
|---|---|---|
| M1 | 消息总线层 A→B→A 循环检测与阻断（两条路径：@ 消息 + sendMessageToAgent 工具）| ✅ 代码已确认 handler.ts / agent-dispatch.service.ts 均无循环检测；用户明确反馈"相互艾特循环"；AutoGen/ADK 均为 Basic |
| M2 | 每群轮次计数器 + 硬上限（默认 5，可配置）+ 超限强制注入收尾指令 | ✅ 代码已确认 handler.ts 无 round counter；行业惯例：所有主流框架标配 max_round |
| M3 | `[讨论结束]` 终止信号代码层检测 + 群 terminated 状态管理 | ✅ 文档设计有此信号但代码无实现（handler.ts 已确认）；用户反馈助手"收不了尾" |
| M4 | feature flag `ENABLE_LOOP_GUARD` 支持一键灰度和回滚 | ✅ 影响范围 HIGH（所有 auto 群聊），必须有回滚路径 |

### Should（应该做）

| # | Requirement | Why Not Must |
|---|---|---|
| S1 | 守卫异常（throw）时 try/catch 降级放行 + error 日志 | 守卫自身 bug 不应阻塞消息流转；但守卫正确时 Must 已覆盖 |
| S2 | 扇入聚合窗口：协调者 1→N 派单后等所有回复聚合为一次触发 | 有实际价值，但需要更多状态设计；轮次上限（M2）已提供基础兜底 |
| S3 | 终止时系统消息通知群内用户（`[系统] 群聊已达轮次上限，协调者正在收尾`）| 提升可观测性，但无此功能核心问题已解决 |

### Could（可做可不做）

| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | `maxAgentRounds` 在群设置 UI 界面可配置 | env var 默认值已解决核心问题，界面配置是提升 |
| C2 | 消息流可视化（agent 触发链实时图）| 核心问题解决后的加分项，UI 工作量大 |
| C3 | 基于余弦相似度的重复响应检测 | 链追踪已解决主问题，相似度方案增加复杂度且阈值难调 |

### Won't（本期不做）

| # | Requirement | Decision Reason |
|---|---|---|
| W1 | Tarjan SCC 图论循环检测 | YAGNI：链长 < 20 时 Set 包含 O(1) 已足够，Tarjan 是过度工程 |
| W2 | 工具白名单（每 agent 限制可调用工具）| 独立模块（F 节），不与消息循环耦合，独立排期 |
| W3 | 任务卡 verifications 客观验收 | 独立模块（G 节），本期范围外 |
| W4 | 消息分级订阅（上下文爆炸）| 大架构改动（B 节），独立排期 |
| W5 | 状态持久化到 Redis/DB | YAGNI：单进程 + 服务重启可接受，引入 Redis 无必要 |

---

## 十一、功能详细需求定义

### 功能 1：LoopGuard — 对话链循环检测

**功能描述**
> 在每次 agent 触发前，检测目标 agent 是否已在当前对话链中。如已在链中，则阻断本次入队并发出系统提示消息，防止 A→B→A 型无限循环。覆盖两条触发路径：消息中的 @ 解析（handler.ts）和 sendMessageToAgent 工具调用（agent-dispatch.service.ts）。

**输入**

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID | 当前群 ID |
| triggerMessage | Message | 是 | — | 触发本次任务的消息对象 |
| targetAgentId | string | 是 | UUID | 被 @ 的目标助手 ID |

**处理逻辑**
1. 若 `triggerMessage.isHuman === true`：重置该群对话链（`chainAgentIds = new Set()`），返回 `allowed: true`
2. 若当前对话链最近活跃时间距今 > 60 秒：视为过期，重置链，返回 `allowed: true`
3. 将 `triggerMessage.agentId`（发言者）加入当前链 Set
4. 检测 `targetAgentId` 是否在链 Set 中
5. 若在链中：返回 `allowed: false, reason: '循环检测'`
6. 若不在链中：返回 `allowed: true`

**输出**

| 情况 | 输出内容 |
|---|---|
| 允许 | `{ allowed: true }` |
| 阻断 | `{ allowed: false, reason: string }`，同时向群广播系统消息 `[系统] 检测到对话循环，已阻断 @{agentName} 的触发` |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| triggerMessage.agentId 为 null（系统消息触发）| chainAgentIds 不更新，target 仍可触发 |
| 链中 agent 数量超过 20 | 记录 warn 日志，重置链，放行（防内存泄漏）|
| 并发请求（同一群两条消息同时处理）| Node.js 单线程，天然串行，无并发问题 |
| 服务重启 | 内存状态丢失，所有群视为新链，可接受 |
| sendMessageToAgent 工具触发 | 同消息触发，相同守卫逻辑，两路径共用 |

**与其他功能的依赖关系**
- 依赖：无
- 被依赖：功能 2（RoundCounter）、功能 3（TerminationDetector）均需在 LoopGuard 之后执行

---

### 功能 2：RoundCounter — 每群轮次计数器

**功能描述**
> 追踪每群内单次用户消息后 agent 自动触发的轮次数。达到 `maxAgentRounds` 上限时，向协调者注入强制收尾指令，并阻断该轮之后所有新的 agent 触发。

**输入**

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID | 当前群 ID |
| message | Message | 是 | — | 当前处理的消息 |
| maxRounds | number | 否 | 1-20，默认 5 | 从 ChatRoom.maxAgentRounds 或 env var 读取 |

**处理逻辑**
1. 若 `message.isHuman === true`：将该群 round 计数重置为 0，同时清除 `terminatedAt`，返回 `{ allowed: true }`
2. 若当前群 `terminatedAt` 已设置（已强制终止）：返回 `{ allowed: false }`
3. 当前 round + 1
4. 若 round < maxRounds：返回 `{ allowed: true }`
5. 若 round === maxRounds：设置 `terminatedAt = Date.now()`，返回 `{ allowed: true, forceTerminate: true }`（本条消息仍处理，但触发注入收尾指令）
6. 若 round > maxRounds（状态异常兜底）：返回 `{ allowed: false }`

**输出**

| 情况 | 输出内容 |
|---|---|
| 允许 | `{ allowed: true }` |
| 强制收尾 | `{ allowed: true, forceTerminate: true }` → 调用方向协调者注入 `[系统强制] 对话已达第N轮上限，请立即生成最终汇总并输出 [讨论结束]` |
| 已超限 | `{ allowed: false }` → 跳过入队 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| `maxAgentRounds` 未在 DB 配置 | 读取 env var `DEFAULT_MAX_AGENT_ROUNDS`，默认 5 |
| 手动模式群（`agentTriggerMode: 'manual'`）| 跳过轮次计数，直接返回 `allowed: true` |
| 协调者（defaultAgentId）不在群中 | 将注入指令改发给群内 agentLevel = 'system' 的 agent |
| 快速对话群（isQuickChatRoom）| 跳过轮次计数（1v1 模式无多 agent 协作）|

**与其他功能的依赖关系**
- 依赖：需在 TerminationDetector 之后执行（避免 terminated 群再计数）
- 被依赖：handler.ts 调用方根据 `forceTerminate` 注入收尾指令

---

### 功能 3：TerminationDetector — 终止信号检测

**功能描述**
> 检测协调者消息中的 `[讨论结束]` 标记，将群置为 `terminated` 状态，阻断所有后续 agent 触发，直到用户发送新消息为止。

**输入**

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID | 当前群 ID |
| message | Message | 是 | — | 当前处理的消息 |
| coordinatorAgentId | string | 否 | UUID or null | 群的 defaultAgentId |

**处理逻辑**
1. 若 `message.isHuman === true`：调用 `resetTermination(chatRoomId)`，返回（不阻断用户消息）
2. 检查 `isTerminated(chatRoomId)`：若已终止，返回 `blocked: true`（在消息处理最前端拦截）
3. 判断当前消息发送者是否为协调者：`message.agentId === coordinatorAgentId`（若 coordinatorAgentId 为 null，则任何 agent 均可触发终止）
4. 若是协调者，且消息内容包含 `[讨论结束]`：调用 `setTerminated(chatRoomId)`
5. 终止信号检测不阻断当前这条消息本身（协调者的收尾消息需要被广播给用户）

**输出**

| 情况 | 输出内容 |
|---|---|
| 当前群已 terminated，拦截后续触发 | `blocked: true` |
| 检测到终止信号，设置状态 | 设置内存 terminated 标记，当前消息照常广播 |
| 非协调者发出 `[讨论结束]` | 忽略，记录 warn 日志 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 消息含 `[讨论结束]` 但为示例文字（如"不要说[讨论结束]"）| 误判风险低，当前阶段接受；后续可改为结构化标记 |
| 服务重启 | 所有终止状态清空，群重置，可接受 |
| terminatedAt 超时无人重置 | 仅等待用户下一条消息，无 TTL 机制（保持简单）|

**与其他功能的依赖关系**
- 依赖：无（最先执行）
- 被依赖：LoopGuard 和 RoundCounter 在 terminated 状态下均无需执行

---

### 功能 4：handler.ts 守卫链集成

**功能描述**
> 在 `setupAIHandlers` 的 `receivedMessage` 处理逻辑中，按顺序注入三个守卫，统一管控所有 auto 模式下的 agent 触发入口。

**处理逻辑（集成后的完整消息路由）**

```
receivedMessage 事件到达
  │
  ├─ 1. ENABLE_LOOP_GUARD 检查（false 则跳过所有守卫，走原有逻辑）
  │
  ├─ 2. TerminationDetector.check(chatRoomId, message, coordinatorId)
  │     └─ blocked=true → 直接 return，不处理任何触发
  │
  ├─ 3. message.isHuman?
  │     → true: 重置所有守卫状态 → 走原有逻辑（defaultAgent / quickChat 触发）
  │
  ├─ 4. RoundCounter.check(chatRoomId, message, maxRounds)
  │     └─ allowed=false → return
  │     └─ forceTerminate=true → 注入收尾指令到协调者任务（继续处理本条消息）
  │
  ├─ 5. parseMentions → uniqueMentions（parseMentions 内部已去重）
  │
  └─ 6. for each targetAgent:
        LoopGuard.check(chatRoomId, message, targetAgent.id)
          └─ allowed=false → 广播系统消息，跳过
          └─ allowed=true → enqueueAgentTask(...)
```

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 任意守卫 throw 异常 | try/catch 降级：记录 error 日志，放行（守卫 bug 不阻塞消息流）|
| `ENABLE_LOOP_GUARD=false` | 跳过所有守卫，行为与改动前完全一致 |

**与其他功能的依赖关系**
- 依赖：功能 1、2、3
- 被依赖：agent-dispatch.service.ts 中的 sendMessageToAgent（需同步注入相同守卫逻辑）

---

### 功能 5：数据库字段 ChatRoom.maxAgentRounds

**功能描述**
> 为 ChatRoom 表新增 `maxAgentRounds` 字段，存储每群的 agent 对话轮次上限。

**输入（schema 变更）**

```prisma
model ChatRoom {
  // ...existing fields...
  maxAgentRounds Int @default(5)
}
```

**处理逻辑**
1. 新增 Prisma migration
2. 运行 `pnpm db:generate` 更新客户端
3. `enqueueAgentTask` 调用前，从 `chatRoom.maxAgentRounds` 读取上限值传入 RoundCounter

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 现有数据库缺少该列 | migration 自动补充，DEFAULT 5 覆盖所有现有群 |
| 值为 0 | 视为禁用轮次限制（等同于手动模式），不触发强制收尾 |
| 值超过 20 | 服务端 clamp 到 20，防止极端配置 |

---

## 十二、非功能需求

### Performance（性能）
- 守卫链总延迟：< 1ms（全 Map/Set 内存操作，无 I/O）
- 降级行为：任意守卫 throw 时 try/catch 放行，守卫异常不引入额外延迟
- 高并发场景：Node.js 单线程天然串行，无锁需求；单群 QPS < 10，无性能瓶颈

### Security（安全）
- 终止信号只响应协调者（coordinatorAgentId），防止非授权 agent 恶意终止群聊
- 循环检测基于 agentId（UUID），不可被 agentName 字符串伪造绕过
- 内存状态不暴露给外部 API，无安全风险
- 无特殊 PII 处理要求

### Compatibility（兼容性）
- 不改变现有 Socket.io 事件接口（`agent:done`、`agent:typing` 等保持不变）
- `ENABLE_LOOP_GUARD=false` 时行为与改动前完全一致（全量向后兼容）
- Prisma migration 向后兼容（新增字段 + DEFAULT，不破坏现有数据）
- Web / Desktop / Mobile 三端均通过 Socket.io 消费事件，无需修改客户端

### Usability（易用性）
- 循环被阻断时，群内出现明确的系统提示消息，不静默失败
- 强制收尾时，协调者收到的系统指令以系统消息形式在群内可见
- `maxAgentRounds` 有默认值说明，用户无需配置即可使用

### Maintainability（可维护性）
- 三个守卫模块独立文件（`loop-guard.ts` / `round-counter.ts` / `termination-detector.ts`），各自有单元测试
- 所有守卫状态用明确的 Map/Set 数据结构，不用全局变量
- 使用现有 `debugLog()` 日志机制，统一格式
- feature flag 通过 env var 控制，无代码改动即可回滚

### Scalability & Extensibility（可扩展性）
- 守卫接口预留：`interface MessageGuard { check(chatRoomId, message, target?): CheckResult }`；新增守卫只需实现接口并注册，不改 handler.ts 主逻辑
- `TERMINATION_SIGNALS` 数组可后续配置化（当前硬编码 `[讨论结束]`）
- 状态 store 封装为独立模块，若未来多实例部署，换 Redis 实现不影响调用方
- 无多租户特殊要求，按 chatRoomId 隔离已满足

---

## 十三、架构影响分析

### 受影响模块（基于代码人工审查 + gitnexus 扫描）

| 模块 | 文件路径 | 影响类型 | 风险等级 |
|---|---|---|---|
| 消息处理入口 | `server/src/core/agent/agent-handler/handler.ts` | 直接修改（注入守卫链）| **d=1 WILL BREAK if not tested** |
| Agent 工具触发路径 | `server/src/core/agent/agent-handler/agent-dispatch.service.ts` | 直接修改（sendMessageToAgent 加守卫）| d=1 |
| 守卫模块（新增）| `server/src/core/agent/agent-handler/loop-guard.ts` | 新增 | Low |
| 守卫模块（新增）| `server/src/core/agent/agent-handler/round-counter.ts` | 新增 | Low |
| 守卫模块（新增）| `server/src/core/agent/agent-handler/termination-detector.ts` | 新增 | Low |
| 数据库 Schema | `server/prisma/schema.prisma` | 新增字段 `maxAgentRounds` | Low（DEFAULT 兼容）|
| 数据库迁移 | `server/prisma/migrations/` | 新增 migration | Low |

> **gitnexus 注记**：`setupAIHandlers` 使用 EventEmitter 动态分发，gitnexus 无法追踪完整上游调用链（confirm: 0 upstream callers in graph）。实际影响范围通过人工代码审查确认，current diff 风险等级 HIGH（15 changed symbols）。

### 数据模型变更
- 新增字段：`ChatRoom.maxAgentRounds: Int @default(5)`
- Migration 必须：Yes — 复杂度 Low（仅新增列，DEFAULT 覆盖现有数据）
- Breaking changes：无（现有行为通过 DEFAULT 保持不变）

### 接口合同变更
- Socket.io 事件接口：不变
- HTTP API：不变
- 新增：`chatRoomService` 需暴露 `maxAgentRounds` 字段读取（已在 findById 返回的 ChatRoom 对象中，无需改接口）

### 集成点
- 守卫调用链：handler.ts → LoopGuard → RoundCounter → TerminationDetector → enqueueAgentTask
- agent-dispatch.service.ts:sendMessageToAgent → 同守卫链（复用相同守卫实例）

### 风险总结

| Risk | Level | Mitigation |
|---|---|---|
| auto 模式群聊行为变化 | **High** | `ENABLE_LOOP_GUARD` feature flag，false 时完全回退 |
| 守卫误判阻断合法对话 | Medium | 单元测试覆盖所有边界情况；初期灰度开放 |
| Migration 失败 | Low | DEFAULT 字段，无数据迁移；本地开发前备份 dev.db |
| 守卫自身 bug 阻塞消息 | Low | try/catch 降级兜底，异常时放行并记录 error |

**Overall architecture risk**: **Medium**（feature flag 使风险可控）

---

## 十四、认知复杂度评估

### 主流程分析（开发者接入守卫链的配置路径）

**步骤拆解**:
1. 设置 env var `ENABLE_LOOP_GUARD=true`
2. 运行 `pnpm db:migrate`（新增 maxAgentRounds 字段）
3. 守卫自动生效，无需额外配置

**指标统计**:

| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 3 | 低（≤3）|
| 决策点 | 1（是否调整 maxAgentRounds 默认值）| 低（≤2）|
| 新概念数量 | 3（对话链/轮次上限/终止状态）| 中（3-5）|

**综合评级**: 中等（新概念 3 个，但均有明确语义，学习成本低）

### 基准对比

| 产品 | 同功能配置步骤数 | 来源 |
|---|---|---|
| AutoGen GroupChat | 3 步（设 max_round / is_termination_msg / speaker_selection）| Phase 0.5 benchmark |
| Google ADK LoopAgent | 2 步（设 max_iterations / 可选 escalate 逻辑）| Phase 0.5 benchmark |

**结论**: 我们的设计与 AutoGen 持平（3 步），未超基准上限

---

## 十五、扩展预留建议

**架构扩展点**:
- `MessageGuard` 接口：`check(chatRoomId, message, targetAgentId?): Promise<CheckResult>`，新增守卫（token 预算守卫、成本上限守卫等）只需实现接口并注册到守卫链
- `TerminationDetector.TERMINATION_SIGNALS` 数组化设计，未来支持用户自定义终止词时直接改配置

**后续迭代方向（Won't 列表候选）**:
- 扇入聚合窗口（S2）— 触发条件：轮次上限（M2）稳定运行 2 周后，协调者被多触发的投诉仍存在
- 工具白名单（W2）— 触发条件：角色越界（质检改代码等）投诉 > 3 次/月
- 消息分级订阅（W4）— 触发条件：token 成本超过用户预算的 30% 时

**配置化建议**:
- 应配置化：`ENABLE_LOOP_GUARD`（env var）、`DEFAULT_MAX_AGENT_ROUNDS`（env var）
- 可配置化（后续）：`TERMINATION_SIGNALS`（逗号分隔列表）
- 不应配置化：守卫链执行顺序（TerminationDetector → RoundCounter → LoopGuard 顺序有语义依赖）、循环检测算法（Set 包含是最优解，无需可配置）

---

## 十六、YAGNI 检查

### 已通过 YAGNI 审查的需求项

| 需求项 | 保留理由 | 对应验收标准 |
|---|---|---|
| 循环检测（M1）| 用户已反馈，代码已确认无此机制 | AC1.1-1.4 |
| 轮次计数器（M2）| 代码已确认缺失，行业 Basic 标准 | AC2.1-2.4 |
| 终止信号检测（M3）| 文档有设计但代码无实现，差距明确 | AC3.1-3.4 |
| feature flag（M4）| 影响范围 HIGH，必须有回滚路径 | — |
| sendMessageToAgent 工具路径守卫 | 两条路径都不守则循环检测有漏洞 | AC1.4 |

### Deferred 项（同步到 MoSCoW Won't）

| 需求项 | 标记原因 | 触发条件 |
|---|---|---|
| Tarjan SCC 循环检测 | 链长 < 20 时 Set 包含已足够（YAGNI 问题 1：为将来可能的需求）| agent 数量 > 50 且误判率 > 1% |
| 余弦相似度 debounce | 无向量基础设施，且链追踪已解决主问题（YAGNI 问题 4：AI 自行补全）| 引入向量检索基础设施后 |
| 状态持久化（Redis）| 单进程足够，重启可接受（YAGNI 问题 1）| 多实例水平扩展需求出现时 |
| 消息流可视化 | 核心问题解决后的加分项，UI 工作量大（YAGNI 问题 1）| 核心守卫稳定运行 1 个月后 |

### 扩展预留建议

| 扩展点 | 预留方式 | 为什么现在预留 |
|---|---|---|
| 新增消息守卫 | `MessageGuard` 接口定义，守卫链用数组维护 | 不预留则每加一个守卫都要改 handler.ts 主逻辑 |
| 状态 store 替换 | 将 Map 封装为独立 store 模块，接口隔离 | 早期抽象成本低；多实例时直接换 Redis 实现 |

---

## 十七、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 循环检测用 Set 包含而非图论算法 | Tarjan SCC、Floyd 判圈 | 实际链长 < 20，Set O(1) 足够；复杂算法是 YAGNI | 2026-05-16 |
| 状态用内存 Map 而非 Redis/DB | Prisma 持久化、Redis | 单进程 Node.js，状态是会话级短暂数据，重启可接受 | 2026-05-16 |
| 两条路径都加守卫（@ 和 sendMessageToAgent）| 只守 handler.ts | sendMessageToAgent 也走 receivedMessage，只守一条有漏洞 | 2026-05-16 |
| 协调者识别用 `defaultAgentId` | 新增 coordinator DB 字段 | 避免 schema 改动；语义已对应；后续可升级 | 2026-05-16 |
| 加 feature flag `ENABLE_LOOP_GUARD` | 直接改 handler.ts 无开关 | 影响所有 auto 群，HIGH 风险必须有回滚路径 | 2026-05-16 |
| parseMentions @ 去重不需要新增 | 新增去重逻辑 | 已确认 parseMentions 第 161 行内部已去重，无需重复 | 2026-05-16 |

---

## 附录：当前问题清单总览

> 基于代码审查（handler.ts / agent-dispatch.service.ts）+ docs/04-problems-and-solutions.md

### 🔴 P0 · 代码层缺失（本期修复）

| ID | 问题 | 代码确认 | 对应 04 文档 |
|----|------|---------|------------|
| P0-1 | A→B→A 互 @ 循环，auto 模式无终止 | ✅ handler.ts 无循环检测，sendMessageToAgent 同样无防护 | A1 节 |
| P0-2 | 扇出风暴：协调者被触发 N 次 | ✅ for loop 逐条入队，无聚合机制 | A2 节 |
| P0-3 | 无轮次计数器，对话永不收尾 | ✅ handler.ts 无 round counter | A1/A2 节 |
| P0-4 | `[讨论结束]` 文档有设计但代码无实现 | ✅ handler.ts 无关键词检测 | A1 节 |

### 🟡 P1 · 架构设计缺失（后续迭代）

| ID | 问题 | 影响 | 对应 04 文档 |
|----|------|------|------------|
| P1-1 | 群规则仅自律层（提示词），无他律层（消息总线 hook）| 规则在长对话中失效 | L 节 |
| P1-2 | 无工具白名单，角色越界无代码层阻止 | 质检可改代码、总控可执行 | F 节 |
| P1-3 | 无心跳 / 死锁检测，agent 互等时群冷场 | 用户不知任务卡在哪 | H 节 |
| P1-4 | 任务卡状态自我申报，无客观验收钩子 | 显示 done 但实际未完成 | G 节 |
| P1-5 | 上下文爆炸：所有消息注入所有 agent | token 飙升，关键信息被淹没 | B 节 |
| P1-6 | 文件并发无锁，两 agent 同改同一文件 | 工作被静默覆盖 | D 节 |
| P1-7 | 文件变更无广播，agent B 不知 A 改了什么 | 合并冲突 / 运行时报错 | E 节 |
| P1-8 | 无任务卡中断恢复机制 | 重启后 agent 不知进行到哪 | I 节 |

### 🟢 P2 · 长期优化

| ID | 问题 | 对应 04 文档 |
|----|------|------------|
| P2-1 | 无模型能力路由，简单任务用大模型浪费 | J 节 |
| P2-2 | 无质量看板和评估盲区 | M 节 |

---

## 附录：Week 1 MVP 实施建议

```
Day 1-2: 新建 loop-guard.ts + termination-detector.ts + 单元测试
Day 3:   新建 round-counter.ts + 单元测试
Day 4:   handler.ts 集成三个守卫 + agent-dispatch.service.ts 加守卫
         + schema.prisma 新增 maxAgentRounds + migration
Day 5:   ENABLE_LOOP_GUARD feature flag + 集成测试 + dev.db 验证

Week 2-3: fan-in-aggregator.ts（扇入聚合窗口，S2）
Week 4+:  P1 问题依次推进（L 群规则 hooks → F 工具白名单 → H 死锁检测）
```
