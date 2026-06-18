# 15. 助手 @ 派发改造 PRD：从「正则反推 prose」到「工具显式意图」

> 状态：草案（待定稿）
> 关联代码：`server/src/core/agent/agent-handler/handler.ts`、`server/src/core/agent/agent-handler/message-utils.ts`、`server/src/core/agent/tools/`、`apps/web/src/components/chat/mention-input.tsx`、`apps/web/src/lib/remark-mentions.ts`
> 后续设计：`docs/13-unified-collaboration-mode-design.md`、`docs/14-agent-dispatch-flowcharts.md`

---

## 1. 背景与问题

### 1.1 现状

群聊里「@助手」全程是**纯文本 + 正则反推**的设计：

- 用户/助手发出的消息以纯文本 `@助手名` 存储。
- 有 **3 处独立的正则**靠「已知助手名列表」反推到底 @ 了谁：
  - 输入框高亮：`apps/web/src/components/chat/mention-input.tsx:169` `parseMentions`
  - 服务端派发：`server/src/core/agent/agent-handler/message-utils.ts:347` `parseKnownMentions`
  - Markdown 渲染：`apps/web/src/lib/remark-mentions.ts:66` `mentionRegex`
- 助手之间的接力派发，是直接对**助手输出的自由文本**跑 `parseKnownMentions(message.content, ..., { allowInline: true })`（`handler.ts:385`）。

### 1.2 根因：正则反推 = 事后猜意图

| 误解析场景 | 说明 |
|---|---|
| 中文无空格边界 | 助手叫「产品」，`@产品帮我看下` —— 名字后紧跟名字字符，边界判定失败，**本该派发却没命中** |
| 前缀歧义 | 同时有「产品」「产品经理」，靠 `sort length desc` + 边界硬凑，规则一复杂就脆 |
| 字面 @ | 邮箱 `a@b.com`、代码块里的 `@admin`，目前靠 `maskCodeSpans`（`message-utils.ts:340`）和一堆 `prevChar` 判断打补丁 |
| 描述性 @ 被误派发 | **助手生成的消息**最严重：助手草拟方案时写「交给 @UI设计 进行界面设计」「@admin 请审阅」，这些是**叙述**，却被当成真实派发触发 |

**核心矛盾**：

- 人类选中助手的那一刻、助手决定交接的那一刻，意图本是明确的；却被丢弃成纯文本，事后再用正则猜。
- 尤其助手侧，作者是 LLM、输出是自由 prose，**无从在录入时固化意图** —— 这是正则方案的死结。

---

## 2. 设计目标与范围

### 2.1 目标

1. 助手派发改为**显式结构化意图**（工具调用），不再依赖 parse 自由 prose。
2. 根除描述性 @ 误派发、中文无空格、前缀歧义、邮箱/代码块误判。
3. 保证多助手协作**可终止、可收敛、不死循环**。
4. 保持「平级群聊接力 + 共享可见 + 人类可介入」的产品模型，**不退化为 subagent**。

### 2.2 本期范围（最小版）

- ✅ 助手侧新增 `mention_agents` 工具 + 执行期 buffer。
- ✅ 轮末决策派发（单 @ / 多 @ / 收敛 / 叶子上报）。
- ✅ 防环与终止护栏（血缘 / depth / 扇出 / 预算）。
- ✅ **派发数据来源从「parse prose」改为「读 buffer」**（真正修复误解析的关键改动）。
- ✅ 轮末把派发意图拼成 `@助手名 task` 文本块追加到消息尾（纯展示，复用现有高亮）。
- ✅ **保持 `@助手名` 纯文本格式不变**，所有显示用正则原样不动。

### 2.3 非本期（后续迭代）

- 人类侧 token（`@[名称](mention:agentId)`）方案。
- 关闭 prose fallback 的「第二步」（彻底让 prose @ 失效）。
- ACP 执行器（Claude SDK / Codex / 通用 ACP）的工具挂载适配。
- 移动端（Flutter）展示与解析对齐。

---

## 3. 整体模型

### 3.1 三层职责切分

| 层 | 职责 | 由谁完成 | 是否需要 LLM |
|---|---|---|---|
| 意图 | 派给谁、交什么活 | 助手调 `mention_agents`（显式） | 是（模型决策） |
| 安全/终止 | 不死循环、有边界 | 机械护栏（血缘 / depth / 扇出 / 预算） | 否（确定性规则） |
| 收敛 | 走向结论 + 收口 | 目标导向协议 + 「扇出者收口」 | 部分（收口者综合） |

> 原「协调器」作为**猜意图的 LLM 仲裁者**退役（意图已由工具显式给出）；其**防环职责**改为机械规则；真正不可替代的只剩**并行分支收口**，且收口者就是「发起多 @ 的那个助手」，不再是独立实体。

### 3.2 收敛规则（核心两条 + 两个兜底）

| 场景 | 行为 |
|---|---|
| **单 @**（A@B） | 自由接力，B 可继续 @；末端不再接力时自然交还人类。无需收敛者 |
| **多 @**（A@[B,C]） | A 是收敛者；B、C 是**叶子**，它们执行时的 @ **不派发**，作为「建议」回报给 A，由 A 拿回控制权决定下一步 |

兜底：

- **叶子的 @ 不丢**：`isLeaf` 时不派发，但把意图作为建议上报给 `convergenceOwner`，信息不流失。
- **单 @ 最小防环**：单 @ 链仍可能 A@B→B@C→C@B 循环，需保留轻量血缘/depth 兜底。

### 3.3 终止性说明（为什么不会死循环）

每个派发任务携带血缘链 `lineage: agentId[]`。**目标若已在自己这条血缘里 → 拒绝派发（或升级 ask_owner）。**

- 多 @：子助手降级为叶子，叶子之间不可能 ping-pong（它们的 @ 不触发任何派发），天然无环。
- 单 @：助手总数有限（N 个），任何链长超过 N 必然出现重复节点 → 被环检测拦下 → **级联在数学上必然收敛**。

### 3.4 模型边界：平级接力 ≠ subagent

| | Subagent | 本设计（群聊接力） |
|---|---|---|
| 拓扑 | 父→子，层级 + 调用栈 | 群内平级广播 |
| 输出去向 | 私有，回灌给父 | 进共享群，所有人（含人类）可见 |
| 返回语义 | 父 await 子结果 | 无返回，发完即退出，下一个接力 |
| 人能看到啥 | 只看父的最终答案 | 看到每个助手的每条消息 |
| 身份/记忆 | 临时、无独立身份 | 持久身份 + 每房间记忆（`AgentRoomMemory`） |

此处的 `depth` 只是一条**扁平的接力血缘标签**（用于防环），**不是调用栈**；群聊里没有「栈回退」。**严禁**把助手接力实现成 subagent（父调子、await、私有返回），否则将摧毁可见性、人类介入、并行能力。

---

## 4. 接口契约

### 4.1 工具入参（LLM 面对，越简单越好）

```ts
// mention_agents
{
  mentions: Array<{
    agent: string;   // 助手名称（群内可见名），服务端校验并解析成 id
    task: string;    // 交给它的具体任务/剩余工作 —— 驱动「收敛」的关键信号
  }>;
  intent?: string;   // 可选：本次接力的整体意图，便于收口者/审计理解
}
```

设计取舍：

- **按名字传，不按 id**：LLM 只认得群内助手名，内部 id 易幻觉。服务端负责 name→id 解析 + 校验。
- **per-target `task`**：扇出时各目标任务不同，必须分别带；「交出去的是哪部分活」是工作量单调递减、能收敛的根本。
- **不要 `mode`（parallel/sequential）字段**：单/多由**最终并集数量**决定（1 个=自由接力，≥2=发起者收敛）。
- **不向工具暴露 leaf/收敛语义**：同一工具，叶子调它也是这个 schema；派不派、上不上报由运行时上下文判定，模型无感。

### 4.2 工具返回（让模型能自纠）

```ts
{
  ok: boolean;
  accepted: Array<{ agent: string; agentId: string }>;
  rejected: Array<{
    agent: string;
    reason: 'unknown_agent' | 'self' | 'in_lineage' | 'fanout_limit';
  }>;
  note: string;  // 人类可读确认，如「已登记，将在你本轮结束后统一处理」
}
```

- `unknown_agent` / `self` → **调用即时校验**返回，模型当场改。
- `in_lineage`（环）/ `fanout_limit`（扇出超限）→ 依赖最终并集，**轮末判定**，可在下一次工具返回或系统提示里回灌。

### 4.3 派发上下文（挂在 `enqueueAgentTask` 的 options 上向下传）

```ts
interface HandoffContext {
  rootMessageId: string;        // 级联根（发起的人类消息）→ 整条级联的预算归属
  lineage: string[];            // agentId 血缘链 → 单 @ 路径的环检测
  depth: number;                // 链深 → depth 上限
  batchId?: string;             // 多 @ 时的批次标识
  convergenceOwnerId?: string;  // 收敛者 = 发起这次多 @ 的助手 id
  isLeaf?: boolean;             // true → 本执行的 mention 不派发，改为上报给 convergenceOwner
}
```

---

## 5. 实现说明

### 5.1 关于「Buffer」

**Buffer = 工具处理函数和派发逻辑之间的一块「暂存内存」。** 工具往里写意图、不行动；派发在轮末读它、统一行动。这样「调几次工具」都只是往同一个箱子里攒，真正派发只发生一次。

仿照现有工厂式工具写法（参考 `server/src/core/agent/tools/execution-context.tools.ts`）：

```ts
export function createMentionTools(ctx: {
  chatRoomId: string
  selfAgentId: string
  activeAgentByName: Map<string, Agent>
}) {
  // 👇 这就是 buffer：一个收集箱，跟着这一轮执行走
  const pending = new Map<string, { agentId: string; agentName: string; task: string }>()

  const mentionAgents = tool(
    async (input: { mentions: { agent: string; task: string }[]; intent?: string }) => {
      const accepted: { agent: string; agentId: string }[] = []
      const rejected: { agent: string; reason: string }[] = []
      for (const m of input.mentions) {
        const agent = ctx.activeAgentByName.get(m.agent.trim())
        // ① 即时校验（便宜、当场可判的才在这判）
        if (!agent || !agent.isActive) { rejected.push({ agent: m.agent, reason: 'unknown_agent' }); continue }
        if (agent.id === ctx.selfAgentId) { rejected.push({ agent: m.agent, reason: 'self' }); continue }
        // ② 写入缓冲：按 agentId 并集去重，重复时 task 后写覆盖
        pending.set(agent.id, { agentId: agent.id, agentName: agent.name, task: m.task })
        accepted.push({ agent: agent.name, agentId: agent.id })
      }
      // ③ 关键：什么都不派发！只返回确认
      return { ok: rejected.length === 0, accepted, rejected, note: '已登记，将在你本轮结束后统一处理' }
    },
    { name: 'mention_agents', description: '...', schema: /* zod */ }
  )

  return { tools: [mentionAgents], getPending: () => [...pending.values()] }
}
```

**生命周期：**

```
助手开始这一轮
  → createMentionTools(...) 建出工具 + 空 buffer
  → LLM 调 mention_agents（可能调多次）
       每次都往 buffer 写（并集去重），不派发
  → LLM 输出结束（这一轮完）
  → 派发层调 getPending() 读 buffer → 决定派给谁
  → 这一轮结束，buffer 跟着丢弃
```

> ⚠️ **缓存注意点**：执行器按 chatRoom-agent 缓存（见 `CLAUDE.md` 执行系统说明）。若工具实例被复用，buffer 必须**每一轮开始时新建/清空**，绑在「单次执行」而非「被缓存的执行器」上，否则上一轮残留的 mention 会漏到下一轮。

### 5.2 工具内逻辑（薄登记）

工具内**只做**：名字解析校验 + 写 buffer + 返回确认。**绝不**：派发、开批次、环检测、拉起别的助手。

排除原因：

- **环检测 / 扇出上限**依赖「本轮最终并集」（模型可能分多次调），调用中途判会误杀 → 留到轮末。
- **派发**放工具里会导致「还没说完就派生新助手」的再入失控 —— 整个设计的前提是「一轮一个决策点」。
- 工具薄 → 天然幂等，调几次都只是往同一个 Map 里并集，无副作用、可单测。

### 5.3 轮末决策（真正的派发逻辑）

执行器在助手这条消息产出完成后，跑一次：

```
读 pending(已并集去重) + handoffContext：

  pending.size === 0
    → 不接力，收敛：交还人类 / 若自己是某 batch 的 leaf 则正常结束

  handoffContext.isLeaf === true
    → 不派发，把 pending 作为「建议」回报给 convergenceOwner(进它的下一轮上下文)

  pending.size === 1(单 @)
    → 环检测：目标 ∈ lineage?  → 拒(或 ask_owner)
    → depth 超限?              → 拒(或 ask_owner)
    → 通过：派发，lineage 追加 self、depth + 1

  pending.size >= 2(多 @)
    → 扇出上限校验
    → 开 batch：self 设为 convergenceOwner，
      各目标以 isLeaf=true 派发，绑 batchId
    → 所有 leaf 跑完 → 重新拉起 self(带齐各分支结果 + 它们的建议)做收口
```

### 5.4 派发数据来源（⭐ 唯一关键改动）

**这是真正修复误解析的一处，本期必做。**

```
派发 ← 读 tool 的内存 buffer(已经有 agentId，确定无歧义)
        ✗ 不再 parse message.content
```

- buffer 是工具调用时就攒好的结构化数据，**不需要正则**。
- prose 里的 `@UI设计` 自然失效（没人 parse 它了）→ **原始问题解决**。
- 改动只在派发那一处（`handler.ts:385` 那段），不是「所有正则」。
- 可选：关掉/弱化 `handler.ts` 中对 prose 的 `parseKnownMentions`，让 prose @ 彻底失效。

> ❗ 诚实提醒：若本期连派发都不改、继续 parse 拼接后的 content，则只能靠「提示助手别在 prose 里写 @」的软约束，**原始误解析风险仍在**。「派发读 buffer」这一步省不掉，但它很小，值得本期就做。

### 5.5 展示：轮末拼接 `@助手名 task` 块

**保持 `@助手名` 纯文本格式**，把 buffer 序列化成块追加到消息尾，纯展示，复用现有高亮：

```
<助手正文>

@设计 负责界面视觉稿
@前端 实现交互逻辑
```

```ts
function appendMentionBlock(content: string, pending: PendingMention[]): string {
  if (pending.length === 0) return content
  const block = pending.map(m => `@${m.agentName} ${m.task}`).join('\n')
  return `${content.trimEnd()}\n\n${block}`
}
```

注意：

- 因为这块是**机器生成的规范文本**（行首 `@助手名 ` + 空格 + task），现有 `remark-mentions.ts` 能正确高亮，无需改格式/正则。
- **派发权威仍是 buffer，不是 parse 这个块**；块只承担「显示 + 历史记录」。
- **叶子（isLeaf）的块**：要么不拼，要么拼成「建议」样式（如 `建议 @D ...`）只给收敛者看；派发层凭 `handoffContext.isLeaf` 跳过，不能因为块里有 @ 文本就派发。

---

## 6. 不变项（本期不动）

| 模块 | 状态 |
|---|---|
| `@助手名` 纯文本格式 | 不变 |
| `remark-mentions.ts`（气泡高亮） | 不变（干净块本就能正确高亮） |
| `mention-input.tsx` 的 `parseMentions`（人类输入显示） | 不变 |
| 人类侧 token 方案 | 后续迭代 |

---

## 7. 风险与后续迭代

| 项 | 说明 |
|---|---|
| ACP 执行器工具挂载 | Claude SDK / Codex / 通用 ACP 能否稳定挂 `mention_agents` 待调研；挂不上的退回「prose 哨兵语法 + 校验 id」兜底（可靠性打折，需标风险） |
| 关闭 prose fallback（第二步） | 全部助手 prompt 切到工具后，关闭对 prose 的解析，彻底消除歧义；属行为变更，需灰度 |
| 人类侧 token | `@[名称](mention:agentId)`，改名后旧消息仍指向正确 id；需做「显示态/值态」分离 + 喂 LLM 前 token→名字还原 |
| 移动端对齐 | Flutter 的输入与渲染需单独适配，避免三端行为不一致 |
| 喂回 LLM 的历史 | 后续若引入 token，需在构造上下文前将 token 还原成 `@名称`，内部 id 不进 prompt |

---

## 8. 定稿决策

| # | 决策 | 结论 |
|---|---|---|
| 1 | 本期是否包含「派发读 buffer」 | ✅ **是**（否则原始 bug 未修，见 5.4） |
| 2 | 单 @ 防环策略 | ✅ **有限重访 K 次 + depth 上限**（允许正当往返，非硬环禁止） |
| 3 | 护栏阈值 | ✅ 见下表（做成可配置） |
| 4 | 叶子「建议」块是否展示给群 | ✅ **展示**，保持透明（视觉上与正式派发区分） |

### 8.1 护栏阈值（决策 3）

三个阈值从三个正交维度给级联树设界：**扇出管宽、depth 管深、预算管总和**。环检测保证「一定终止」，这三者保证「终止得又小又快」。

| 阈值 | 限制维度 | 推荐起始值 | 理由 |
|---|---|---|---|
| 扇出上限 M | 单点宽度（一次 @ 几个） | **3** | 同时问 2~3 个是常态，≥4 多为失控信号 |
| depth 上限 N | 单链长度（A→B→C…） | **100（仅作背书）** | 终止由环检测 + K 保证、成本由级联预算保证；depth 平时触发不到，只当最后保险丝 |
| 级联预算 | 整棵树总量（一条人类消息触发的全部派发） | **总派发数 ≤ 20** | **主成本闸**；用计数比 token/时间更易实现与观测 |
| 有限重访 K | 同一助手在一条血缘里的重复上限 | **1** | 允许「回头补一句」的正当往返，又不来回弹；**这是「不死循环」的真正保证，勿动** |

> **终止性归属说明**：保证「不会无限循环」的是**环检测 + 有限重访 K**（同一助手单链最多出现 K+1 次，助手有限 → 任何链最长 2N，必然到顶被拦），**不是 depth**。控制成本/规模的是**级联预算**。因此 depth 设为很大的背书值（100）即可，平时不会触发；调护栏时**只调 M / 预算 / K，depth 一般不动**。

实现要点：

- 建议做成可配置，沿用项目 `AGENT_*` 环境变量惯例（如 `AGENT_HANDOFF_FANOUT_MAX`、`AGENT_HANDOFF_DEPTH_MAX`、`AGENT_HANDOFF_BUDGET_MAX`、`AGENT_HANDOFF_REVISIT_MAX`）。
- 撞到任何上限**不静默杀，而是升级 ask_owner**：在群里问房主「已达 XX 上限，是否继续？」—— 保留人类安全阀。
- 阈值先按上表上线，跑一段时间看真实级联数据再调。

> 决策全部确定，可交 @UI设计 进行界面设计（重点：`mentions[].agent/task` 在气泡内的展示、batch 收口结果的呈现、叶子「建议」与正式派发的视觉区分、撞顶 ask_owner 的交互）。
