# 04 · Major Problems and Solutions

English | [中文](04-problems-and-solutions.md)

> This is the **Core Chapter** of the documentation. It categorizes 13 real pitfalls of group-chat orchestrated multi-AI agents into 4 themes, each problem expanded using the same **7-section format**: Symptom / Root Cause / Current Handling / **Recommended Solution (with implementation steps)** / **Alternative/Supplementary Solutions** (multiple paths listed) / Priority / Work Effort Estimate.
> Priority legend: 🔴 High (P0, must do next phase) / 🟡 Medium (P1, 3-6 months) / 🟢 Low (P2, long-term).

> **2026-06 progress (some problems hardened)**: after Smart Collaboration (merged auto/coordinator) landed, the following are now covered by "collaboration budget (two breakers) + parallel-batch/serial-chain + 5-point coordinator fallback" (full flowcharts in [14-agent-dispatch-flowcharts_EN.md](14-agent-dispatch-flowcharts_EN.md)):
> - **A1 loop prevention / A2 fan-out storm**: two breakers (hops 20 / consecutive cycle 3 round-trips) on the "agent single-`@` direct relay"; on a trip it stops and `@`s the owner; user multi-`@` is handed to the coordinator to split into single task / parallel batch / serial chain (no silent truncation).
> - **C @ trigger ambiguity**: an agent `@` anomaly (typo/multi-`@`) escalates to the coordinator for correction; the default agent fallback is kept.
> - **H deadlock**: cycle detection + stall watchdog fallback; a human message takes over at any time.
> See [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md) and [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md). The solutions below remain as design rationale and as reference for the parts not yet covered (objective acceptance, file concurrency, hard state-machine constraints, etc.).

## How to Read "Alternative/Supplementary Solutions"

Each problem's "Alternative/Supplementary Solutions" table uses the same fields:

| Field | Meaning |
|-------|---------|
| **Number** | Format like `A1-α`, `A2-β`, for cross-reference |
| **Approach** | One-line description of the method |
| **Pros/Cons** | Help you judge suitability for your scenario |
| **Relation** | One of three: **Stack** (use with recommended) / **Replace** (pick one) / **Wrapper** (package multiple solutions as presets for users) |

Each problem ends with a **Recommended Combination** —拼接 recommended solution + several high-ROI alternatives into an整体打法.

> Design philosophy: **Single silver bullets rarely exist, multi-layer defense covers long-tail**. Reading multiple solutions isn't wasting time, it's picking the组合最适合你团队当前阶段.

## Theme Overview

| Theme | Problem | Priority | Keywords |
|-------|---------|----------|----------|
| **Flow Control** | A1 Agents endlessly @ each other | 🔴 | Collaboration budget + cycle breaker (shipped); completion authority can still be hardened |
| | **A2 Fan-out-Fan-in Storm** | 🔴 | Parallel-batch/serial-chain + fork-join (shipped); task-event aggregation still pending |
| | C @ trigger ambiguity | 🟡 | Smart Collaboration anomaly escalation + default recipient |
| | H Deadlock/Stalemate | 🟡 | Stall watchdog + human takeover |
| | K Human intervention timing | 🟡 | Risk level + permission mode |
| **Context & State** | B Context explosion | 🟡 | Message tiered subscription |
| | E Info sync blind spot | 🔴 | File change event bus |
| | G Task card state drift | 🔴 | Objective acceptance hook |
| | I Long task interrupt resume | 🟡 | Task card bound to git branch |
| **Boundaries & Conflicts** | D File concurrency conflict | 🔴 | File-level pessimistic lock |
| | F Role boundary crossing | 🟡 | Tool whitelist (capability = permission) |
| | L Group rule失效 | 🟡 | Self-discipline vs External-discipline (hooks) |
| **Quality & Cost** | J Model capability mismatch | 🟡 | Task card complexity routing |
| | M Evaluation blind spot | 🟢 | Three-tier acceptance + regression suite |

---

## Theme 1 · Flow Control

### A1 · Agents Endlessly @ Each Other

#### Symptom

Coordinator @s → everyone replies → Coordinator summarizes → everyone补充 → Coordinator再summarizes → ……
Tokens burned out, user feels "group一直在吵".

#### Root Cause

1. Every agent treats "polite response" as default, no one has "announce completion" power.
2. No one has "I shouldn't speak" restraint — whenever @mentioned, respond.
3. Missing explicit "completion condition".

#### Current Handling (v0.1.x)

- ✅ **Smart Collaboration / Manual trigger modes** — Manual blocks agent-message `@` triggers; Smart Collaboration uses the single-`@` fast path and escalates anomalies to the coordinator.
- ✅ **Two collaboration-budget breakers** — hop and consecutive-cycle detection on single-`@` relay stop auto-dispatch and `@` the owner.
- ✅ **Stall watchdog** — when collaboration stalls, the coordinator adjudicates the fallback.
- ✅ Group rules exist (still a soft constraint).
- 🔵 The v1 "exclusive completion right" concept is not yet a hard platform state.

#### Recommended Solution

**Short-term (1 week) · Group Rule Default条款硬化**

Write three强制条款 into group rules, default checked when creating new group:

```
1. Only Coordinator (group owner指定) can announce discussion complete. Other agents不得使用 [Discussion Complete] marker.
2. Agent发言后只准@ Coordinator,不得@ other agents.
3. Single topic最多discuss 3 rounds,第3轮Coordinator必须force wrap-up.
```

**Medium-term (2-4 weeks) · Platform-level "Completion Right" Code Enforcement**

Add判断 at message bus layer:

```typescript
// pseudo
function shouldStopGroupChat(group, message): boolean {
  if (message.contains('[Discussion Complete]') && message.sender === group.coordinator) {
    return true;
  }
  if (group.currentRound >= 3) {
    triggerForceSummary(group.coordinator);
    return true;
  }
  if (detectConsensus(group.recentMessages)) {  // LLM judges consensus
    return true;
  }
  return false;
}
```

配套 UI: "Completed" status display, disable further发言 (input box grayed).

**Long-term** · Consensus detection upgraded from Coordinator prompt to **independent judge model** call,避免Coordinator既当裁判又当队长.

#### Alternative/Supplementary Solutions

> Recommended solution core is "Coordinator exclusive completion right". Following solutions单独用或叠加都行, pick by cost and scenario.

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **A1-α · Token budget hard cap** | Task card set token budget, burned out auto wrap-up and report | Simple implementation (1 day), absolute fallback | May截断useful讨论 | Stack: as最后兜底 |
| **A1-β · Duration budget hard cap** | Group discussion持续超过 X minutes auto wrap-up | Good user experience (avoid "挂群烧钱") | Long tasks may be误伤 | Stack |
| **A1-γ · Independent judge model仲裁** | Use small model不参与对话 every N rounds判 "whether should end" | Doesn't依赖Coordinator self-judgment | Extra model cost | Replace "consensus detection"那一档 |
| **A1-δ · Message similarity detection** | Last 3 messages cosine similarity >0.85 with previous 3 →判loop auto wrap-up | Objective,不靠 LLM judgment | Recap-style讨论 may误判 | Stack |
| **A1-ε · User hard截断button** | UI上"Immediately End Discussion" button, group owner一键截断 + let Coordinator immediate summarize | Give user fallback control感 | Need UI work | Stack, as最后逃生口 |
| **A1-ζ · Phase-based discussion** | Split discussion into phases ("propose /反驳 / summarize"), each phase最多 1 round | Strong structure,防发散 | Low flexibility | Replace "round limit" |

**Recommended Combination**: Recommended solution + α (token fallback) + ε (user escape hatch). Three-layer defense covers 95% of loops.

#### Priority · 🔴 High (P0)
#### Work Effort · S (Small: 1-2 weeks)

---

### A2 · Fan-out-Fan-in Storm ⭐

> User emphasized痛点. Original doc未单列,本节单列.

#### Symptom

```
Coordinator @EngineerA @EngineerB @QA (one dispatch message)
  ↓
EngineerA replies: "Completed, waiting @Coordinator summarize"
EngineerB replies: "Completed, waiting @Coordinator summarize"
QA replies: "Reviewed, waiting @Coordinator summarize"
  ↓
Message bus receives 3 @Coordinator → Coordinator triggered 3 times (each runs LLM)
  ↓
Coordinator each response又分别 @ EngineerA / EngineerB / QA
  ↓
3 agents各被@ once,又都回 @ Coordinator …… Snowball滚越大
```

One normal 1→3 dispatch,几轮后变成 **3^n level** message and token explosion.

#### Root Cause

Three layers叠加:

1. **逐条响应**: Message bus treats each @Coordinator as独立 event trigger, Coordinator每次都重新跑一次 LLM inference.
2. **Reply必带@**: Agents misuse "state change" through "dialogue" channel —本来只该说 "I delivered",结果变成 @Coordinator来一次对话.
3. **No aggregation window**: Coordinator没有 "wait all then summarize" concept,每收到一条就独立处理一次.

#### Current Handling (v0.1.x)

- ✅ **Coordinator structured dispatch**: user multi-`@` or agent multi-`@` is handed to the coordinator, split into independent tasks run in parallel or serial per `dispatchMode` (no blind fan-out).
- ✅ **Parallel-batch / serial-chain fork-join**: parallel members complete, or the serial chain's tail finishes, then the coordinator adjudicates the next step.
- ✅ **Collaboration-budget breaker**: repeated fan-out/cycles on single-`@` relay stop auto-dispatch and `@` the owner.
- 🔵 **Task-card event aggregation** is still not fully implemented; the "state-change channel + aggregation window" below remains a recommended next step.

#### Recommended Solution

**Core Principle**: **Dialogue channel只跑discussion, state change走task card. Reply不主动@,让事件聚合而不是消息回声.**

**Step 1 (1 week) · Group rule add "Completion-type Reply禁@"**

```
Group Rule - Completion-type Reply禁@:
Agent在「task complete / delivered / reviewed完毕」type replies中,
不得@ anyone. State change应通过task card state machine推进,
而非通过dialogue channel @Coordinator.
```

Platform layer hook validation: Before message send regex match "complete|delivered|done|完毕" keywords,命中且message含@则reject并提示.

**Step 2 (2-3 weeks) · State Change Channel vs Dialogue Channel Separation**

引入**Task Card Event Flow** as独立 channel:

```
Dialogue message (chat message):原有@trigger逻辑
   ↓完全独立
Task event (task event): State change走task_card state machine
   ↓
   Coordinator subscribes "task_event:in_review" event, events入aggregation window
```

Task card state machine transitions `in_progress → in_review`时**不发任何dialogue message**,只产生一个 `task_event`.

**Step 3 (2-3 weeks) · Coordinator Aggregation Window**

When dispatching记录预期回收:

```typescript
const dispatch = {
  id: 'dispatch-001',
  expected_returns: ['EngineerA', 'EngineerB', 'QA'],
  received: [],
  timeout_at: now + 30 * 60 * 1000,  // 30 minute timeout
  on_complete: () => coordinator.summarize(this.received),
};
```

Aggregation window两个收口条件:
- **Full**: Received all expected_returns delivery events → trigger一次Coordinator summarize
- **Timeout**: Timeout未满 → trigger一次Coordinator summarize (with "以下agents未delivered" tag)

**Step 4 (1 week) · Message Bus Debounce**

Short time内 (default 3 second window) multiple @to same recipient合并成一次trigger:

```typescript
const debouncedMentions = new Map();
function onMention(target, msg) {
  const key = target.id;
  const queue = debouncedMentions.get(key) ?? [];
  queue.push(msg);
  debouncedMentions.set(key, queue);
  scheduleDebounce(key, 3000, () => {
    target.handle(queue);  //一次性处理
    debouncedMentions.delete(key);
  });
}
```

#### Alternative/Supplementary Solutions

> Fan-out storm is user emphasized痛点, solutions越多越好 — here 6 approaches,可组合.

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **A2-α · Fully event-driven mode** |彻底改造: @退化为"mention"不触发response; all triggers走task_event event flow |根上eliminate fan-out | Large refactor, changes interaction习惯 | Recommended方案"激进版" |
| **A2-β · Content similarity dedup** | Same recipient短时间内收到content similarity >0.9 multiple @ → merge into一次response | Transparent, compatible with现有 UI | Similarity threshold tricky | Stack: with debounce |
| **A2-γ · Rate limit** | Each agent to same recipient最多发 1 @per minute |极简 implementation (1 day) | Rough | Stack: with debounce |
| **A2-δ · Background worker batch processing** | Coordinator不实时响应每条 @, background worker collects N seconds messages后让Coordinator一次性处理 | Completely eliminate "逐条trigger" | Introduces delay | Replace "aggregation window"或等价 |
| **A2-ε · Agent delivery = only update task card,不发dialogue** | Engineer/QA complete时只切state machine,不在群里发 "completed" message, system自动produces一条system message | Clean彻底 | User看不见 "work process" | Stack:与"completion-type禁@"等价但更彻底 |
| **A2-ζ · Group-level "message pace" config** | User可选"realtime mode" (old behavior) / "aggregation mode" (recommended) / "report mode" (只看Coordinator summarize) | Give user control | More options增加learning cost | Wrapper: package α/β/γ/δ as presets |
| **A2-η · @Coordinator时show queue preview** | User/agent @Coordinator时 UI shows "还有 2条 @Coordinator pending",让sender主动avoid重复 | Educate user | Agents不会看 UI | Only适合user场景 |
| **A2-θ · Coordinator merged response** | Coordinator triggered后先scan自己inbox所有未处理 @,一次性回应 (不只回当前那条) | Least change改善体验 | May仍fan-out,只是收口在Coordinator侧 | Replace "aggregation window"轻量版 |

**Recommended Combination** (按refactor cost递增):
- **Light**: γ (rate limit) + θ (Coordinator merge) — 1周内就能上
- **Medium** (强烈推荐): Recommended方案 (completion-type禁@ + aggregation window + debounce) + β (similarity dedup)
- **Heavy**: α (event-driven) —一次性根治,但要refactor message bus

#### Priority · 🔴 High (P0, user emphasized)
#### Work Effort · M (Medium: 4-6 weeks)

---

### C · @ Trigger Ambiguity

#### Symptom

- User casually says "someone look at this",没@ →全场沉默
- @multiple people →抢答或互相推让
- @role name ("Engineer")而非具体agent →路由不到

#### Root Cause

- Group message缺少**强制路由** mechanism.
- Agent发言权来自 "被@"这一weak signal.
- 没有 "Role Group @" concept.

#### Current Handling (v0.1.0)

- ✅ **Default Receiving Agent**: Group owner message无@时自动@该agent (implemented).
- ✅ Sequential response: @mentioned agents按queue顺序响应,不抢答.
- 🔵暂无 "Role Group @".

#### Recommended Solution

**Step 1 · Role Group @**

引入"Role" as第二种 @ entity:

```
@Engineer → Platform expands为该group所有 role=Engineer agents中按规则选一个
@all-Engineer →全部并行
```

Selection rules (按priority):
1. That role当前idle (agentStatus=idle)
2. Loaded相关 skills最齐全
3. Historically对that task card domain负载最少
4. Random

**Step 2 · Smart Fallback ("someone look at this" scenario)**

User message没@ anyone时:
- Currently已支持 → Route to group "Default Receiving Agent"
- Enhance → Let Coordinator LLM判断该message适合哪个role,再二次route

**Step 3 ·抢答Defense**

@multiple people时已sequential (v0.1.0 implemented), enhance为:
-同一时刻只一个agent "holds mic"
- Other agents即使@mentioned也queue,不能抢说话

#### Alternative/Supplementary Solutions

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **C-α · Input box @ recommendation** | User typing时基于context推荐 "想@谁" | Smooth UX | Inaccurate推荐会annoy | Stack |
| **C-β · Two-level router** | All无@ messages default to Coordinator, Coordinator decides下发给谁 | Strong fallback | Coordinator load重 |与"Default Receiving Agent"等价的推荐做法 |

**Recommended Combination**: Recommended方案 + α (input recommendation).

#### Priority · 🟡 Medium (P1)
#### Work Effort · M (4-6 weeks,含LLM routing判断)

---

### H · Deadlock and Stalemate

#### Symptom

- Engineer等待QA feedback
- QA等待Engineer补充
- Both "等待对方"
- Group冷场, user睡了觉wakes发现整夜无进展

#### Root Cause

- Async message system没有timeout
- Task card state machine没有 "stuck" detector
- 没有 "heartbeat" concept

#### Current Handling (v0.1.0)

- 🔵 Task board有 "Pending Recovery Tasks" column,暗示有state recovery mechanism,但没有自动stalemate detection.

#### Recommended Solution

**Step 1 · Task Card Heartbeat**

Task card enters `in_progress`后,每N步必须update一次 `last_active_at`:

```yaml
task_card:
  status: in_progress
  last_active_at: 2026-05-09T12:00:00Z
  heartbeat_interval: 5min     # expected heartbeat interval
```

**Step 2 · Silent Alert**

Platform background worker每分钟scans所有in_progress状态task cards:

```typescript
function checkSilentTasks() {
  const cards = await taskCards.findInProgress();
  for (const card of cards) {
    const silentDuration = now - card.last_active_at;
    if (silentDuration > card.heartbeat_interval * 3) {
      notifyCoordinator(card, 'TASK_SILENT');
    }
  }
}
```

**Step 3 · Self-Rescue and Escalation**

Coordinator receives TASK_SILENT notification后:

1. First time: @owner agent ask progress
2. Second time (仍silent): Try alternate path — reassign to另一个同role agent
3. Third time: Escalate to human user

#### Alternative/Supplementary Solutions

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **H-α · Task dependency graph analysis** | Build task card间dependencies graph, A waits B / B waits A立即detect环 | Mathematically rigorous | Only solves "explicit wait" type deadlock | Replace "timeout detection" precise版 |
| **H-β · Coordinator periodic巡检** | Coordinator每N minutes主动 @ all in_progress agents ask "still working?" | Proactive not被动 | Extra communication cost | Replace "heartbeat上报" |
| **H-γ · User layer "催促" button** | UI一键 @ all相关agents,附 "user等待" | Direct user control |仍依赖user盯 | Stack, as人工兜底 |
| **H-δ · Timeout auto换人** | Task card silent timeout → auto switch to同role另一个agent | Self-healing | No replacement同role时无效 | Stack to推荐方案"self-rescue" |

**Recommended Combination**: Recommended方案 (heartbeat + silent alert) + α (dependency graph) + γ (user催促button).

#### Priority · 🟡 Medium (P1)
#### Work Effort · S (2-3 weeks)

---

### K · Human Intervention Timing

#### Symptom

Either platform太 "obedient" — asks user everything, frequent interruptions.
Or太 "wild" —擅自决策goes wrong, user discovers事后.

#### Root Cause

Missing **Intervention Strategy**,把 "ask human or not"完全压在Coordinator prompt里 — model每次回答不一致.

#### Current Handling (v0.1.0)

- 🟡暂无unified intervention strategy,依赖agent prompts.

#### Recommended Solution

**引入 "Risk Level + Permission Mode"二元体系**

**Step 1 · Tag All Agent Actions with Risk Level**

```
risk_level:
  low:
    - Read file
    - Search docs (Researcher)
    - Write new file (不overwrite)
    - Run read-only script
  medium:
    - Modify existing file
    - Run build/test
    - Create task card
  high:
    - Delete file
    - git push
    - Call external API (带cost)
    - Change user config
    - Install package
```

**Step 2 · User Set Permission Mode at Group Level** (参考Claude Code)

```
permission_mode:
  - plan        # All actions只plan不execute, each需要user confirm
  - normal      # low auto execute, medium/high需要user confirm
  - acceptEdits # low+medium auto execute, high需要user confirm
  - bypass      # All auto (仅适合expert)
```

**Step 3 · High-Risk Action Pre-Confirmation UI**

High risk action弹出confirmation弹窗:

```
EngineerA即将execute:
  Action: Delete file src/legacy/
  Reason: Clean obsolete code
  Impact: 3 files,约200 lines
  Undo: Can recover via git checkout

[Confirm] [Cancel] [Always Allow This Type]
```

#### Alternative/Supplementary Solutions

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **K-α · Cost threshold trigger** | Single task card spend超过threshold (e.g. $5) auto pause等待user | Prevent "暗中烧钱" | Task complexity无关 | Stack |
| **K-β · Failure count累计** |某agent on that task card连续fails N times → auto pause escalate | Prevent infinite retry | N threshold tricky | Stack |
| **K-γ · Divergence detection** | Multiple agents give conflicting conclusions on same issue → pause等待user ruling | Utilize group collaboration natural信号 | Need semantic comparison | Replace部分场景 |

**Recommended Combination**: Recommended方案 (risk level + permission mode) + α (cost fallback) + β (failure fallback).

#### Priority · 🟡 Medium (P1)
#### Work Effort · M (4-6 weeks,含UI)

---

## Theme 2 · Context and State

### B · Context Explosion

#### Symptom

Group runs 30 rounds后, each agent prompt context fills with irrelevant messages, response slows, tokens spike, key信息淹没.

#### Root Cause

Default all group messages enter all agents' context. But实际上:
- QA不需要看Engineer写的每行code
- Engineer B不需要看Engineer A的internal debug log

#### Current Handling (v0.1.0)

- ✅ **`injectGroupHistory` toggle**: Add agent to group时可选择是否inject history.
- ✅ Agent memory isolated per group (cross-group不污染).
- ✅ "Clear Context" button (v0.1.0 implemented).
- 🔵 Group内messages仍one pot stew.

#### Recommended Solution

**Step 1 · Message Tiering**

Each message gets type tag:

```typescript
type MessageType =
  | 'chat'           // Free discussion
  | 'task-update'    // Task card state change notification
  | 'file-changed'   // File change broadcast
  | 'system'         // Platform system message
  | 'directive';     // Coordinator directive
```

**Step 2 · Agent Subscribe by Tier**

Agent config add subscription filtering:

```yaml
agent: EngineerA
subscriptions:
  - chat: own_mentions_only      # Only看@自己的dialogue
  - task-update: own_tasks_only  # Only看相关自己的tasks
  - file-changed: related_only   # Only看自己related_files里变更
  - directive: from_coordinator  # Only看Coordinator directive
```

**Step 3 · Task Card as Natural Context Boundary**

Agent reads context时, default只看:
- Currently working on task card (owner or reviewer)
- That task card's `related_files` history changes
- Coordinator dispatched that task card的dispatch context

**Step 4 · Auto Rolling Summary**

Group messages超过threshold (e.g. 200) trigger compactor:
- Old messages aggregated by task card into summary
- Summary written to "Group Archive", searchable但不进active context

#### Alternative/Supplementary Solutions

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **B-α · Rolling compact** | Context超threshold时auto让LLM compress old messages into summary (参考Claude Code) | Transparent, widely verified | Summary可能丢details | Replace "message tiering"轻量版 |

**Recommended Combination**: Recommended方案 (message tiering + subscription) + α (rolling compact fallback).

#### Priority · 🟡 Medium (P1)
#### Work Effort · L (Large: 6-10 weeks)

---

### E · Info Sync Blind Spot (A Changed File B Doesn't Know)

#### Symptom

Engineer A changed `utils.ts` function signature, Engineer B仍按old signature writes caller code → merge conflict or runtime error.

#### Root Cause

Group "dialogue sync" and "work directory sync" are two independent channels. File layer real changes没有auto broadcast to dialogue layer.

#### Current Handling (v0.1.0)

- 🔵依赖Engineer A在群里**manually** says "I changed utils.ts",全靠自觉.

#### Recommended Solution

**Step 1 · File Change Event Bus**

Any agent's write file operation (Edit/Write/Bash涉及file) auto produces event:

```typescript
interface FileChangedEvent {
  type: 'file-changed';
  path: string;
  changed_by: agentId;
  diff_summary: string;       // Auto generated diff summary
  full_diff_url: string;      // Full diff clickable to view
  timestamp: Date;
  task_card_id: string;
  message_id: string;
}
```

**Step 2 · Reverse Subscription**

Task card `related_files` field做reverse index:
- Who's task card contains that file, whose agent subscribes that file's change events
- Engineer B next发言前auto sees diff summary inserted context header

**Step 3 · Pre-Deliver "FYI" Summary**

Engineer A completes task card enters `in_review`时, auto produces一条system message:

```
[file-changed] EngineerA在TC-001中modified:
  - src/utils.ts (+12 -8): updateUser signature changed
  - src/types.ts (+3 -0): Added UserOptions type
[View Full Diff]
```

不@ anyone (avoid trigger fan-out storm), but subscribed to that path agents will auto see next round.

#### Alternative/Supplementary Solutions

| Number | Approach | Pros | Cons | Relation |
|--------|----------|------|------|----------|
| **E-α · Agent pre-task auto git status** | Each agent before starting task必须先run `git status` + `git log -10`,了解最新变更 | Simple, habitual | Increases每次startup token cost | Stack: as agent "onboarding ritual" |

**Recommended Combination**: Recommended方案 + α (git status onboarding).

#### Priority · 🔴 High (P0)
#### Work Effort · M (4-6 weeks)

---

### G · Task Card State Drift

#### Symptom

- Task card shows `done`,但code根本没run test / file没改
- Conversely: Actually completed, status stuck在 `in_progress`没人切

#### Root Cause

Status field is agent **self-claimed**, no objective verification. LLM倾向于 "optimistic report".

#### Current Handling (v0.1.0)

- 🟡 Task board有 6 status categories,但status切换无hard constraint.
- 🔵 Acceptance依赖QA agent LLM判断,可被表象骗过.

#### Recommended Solution

**Core思路**: Let `expected_output` field upgrade from natural language to **machine-verifiable** assertions.

**Step 1 · Task Card Schema Add verifications Field**

```yaml
task_card:
  expected_output:               # Natural language description (for human)
    - File src/Login.tsx contains SSOButton
    - Test login.test.ts all pass
  verifications:                 # Machine verification (for platform)
    - type: file_contains
      path: src/Login.tsx
      pattern: "SSOButton"
    - type: command_passes
      command: npm test login.test.ts
    - type: screenshot_matches
      url: http://localhost:3000/login
      reference: docs/refs/login-with-sso.png
      threshold: 0.95
```

**Step 2 · Objective Acceptance Hook**

`in_progress → in_review` transition时, platform layer先runs all verifications:

```typescript
async function tryTransitionToReview(card: TaskCard) {
  const results = await runVerifications(card.verifications);
  if (results.every(r => r.passed)) {
    card.status = 'in_review';
    card.evidence = results;        // Evidence落card
    notifyReviewer(card);
  } else {
    notifyOwner(card, 'VERIFICATION_FAILED', results);
    // Reject status transition, owner must fix
  }
}
```

**Step 3 · Status Transition附Evidence**

Each status transition必须附 evidence:

```yaml
history:
  - time: 2026-05-09T14:00:00Z
    actor: EngineerA
    event: in_progress→in_review
    evidence:
      verifications_passed: 3/3
      diff_hash: abc123
      test_log_url: ...
      screenshot_url: ...
```

不附 evidence transitions rejected by message bus.

#### Priority · 🔴 High (P0)
#### Work Effort · M (4-6 weeks)

---

### I · Long Task Interrupt Resume

#### Symptom

Task runs halfway (machine sleep / network interrupt / tokens exhausted), next day resume, agent对 "where we were"完全没concept.

#### Root Cause

Agent's "working memory" mainly in dialogue context, dialogue context is **volatile** — group messages can persist,但当时 chain-of-thought, temporary variables,未saved judgments不一定能recover.

#### Current Handling (v0.1.0)

- ✅ Group messages + task board persisted.
- ✅ Task board有 "Pending Recovery Tasks" column.
- ✅ Agent有 `streamingThinking` streaming thinking chain visualization.
- 🔵 Interrupt resume mechanism未明确implemented.

#### Recommended Solution

**Step 1 · Task Card Internal Add `step_progress`**

```yaml
task_card:
  steps:
    - Add OAuth button component在 /login          # Completed
    - Connect /api/oauth/callback             # In progress
    - Add unit tests                            # Not started
  step_progress:
    current_step: 2
    sub_progress: "Implemented callback route, writing parameter validation"
    last_updated: 2026-05-09T14:30:00Z
```

**Step 2 · Decision Log**

Important fork points agent必须record "why chose A not B":

```yaml
decisions:
  - time: 2026-05-09T14:00:00Z
    question: Use OAuth library or hand-write
    chosen: Use next-auth
    reason: Project already has next-auth dependency, avoid引入new library
    alternatives_rejected:
      - {option: hand-write, reason: Increases maintenance cost}
```

Resume时直接read decision log,避免换model instance就重选path.

**Step 3 · Task Card ↔ Git Branch Binding**

Task card enters `in_progress` auto creates branch:

```
task-card/TC-001
```

Agent all write file operations land on that branch,每complete一个step auto commit:

```
[TC-001 step 1] Add OAuth button component在 /login
[TC-001 step 2] Connect callback route (in progress)
```

Interrupt resume = switch back to branch看last commit.同时solves D (file concurrency conflict)和G (state drift, commit hash即evidence).

#### Priority · 🟡 Medium (P1, but与D/G联动建议merged implementation)
#### Work Effort · M (4-6 weeks)

---

## Theme 3 · Boundaries and Conflicts

### D · File Concurrency Conflict

#### Symptom

Engineer A and Engineer B simultaneously modify `Login.tsx`, A changes styles B changes logic, later write overwrites earlier. Git上看似一次 "clean" commit, actually lost A's changes.

#### Root Cause

Group-as-project shares one `work_dir`, but platform没有对 **write file operations** concurrency control. LLM agents不会主动lock,也不会主动 git pull/rebase.

#### Current Handling (v0.1.0)

- ✅ Three-layer workDir strategy已就位 (group-level shared, agent default, quick chat independent).
- 🔵 Shared group directory内无concurrency control.

#### Recommended Solution

**Step 1 · File-level Pessimistic Lock**

Task card `related_files` field upgraded to lock table:

```yaml
task_card:
  status: in_progress
  related_files:
    - path: src/Login.tsx
      mode: write           # write lock, exclusive
    - path: src/types.ts
      mode: read            # read lock, multi-read
```

When dispatching platform detects:
- Already `write` locked → Reject dispatch (prompt Coordinator conflict) or queue
- Already `read` locked + new `write` lock → Wait read release
- Multiple `read` locks可coexist

**Step 2 · Task Card Bound to Git Branch (与I共用方案)**

Each task card one branch, physically isolate write operations:

```
main
├── task-card/TC-001 (EngineerA modifies Login.tsx)
└── task-card/TC-002 (EngineerB modifies Login.tsx)
```

Branch merge由Coordinator/QA review conflict,避免silent overwrite.

**Step 3 · Dispatch时Conflict Pre-check**

Coordinator dispatch algorithm:
- Detect two task cards `related_files` overlap
- Overlap则force sequential (先do TC-001再do TC-002)
-不overlap才parallel

#### Priority · 🔴 High (P0)
#### Work Effort · M (4-6 weeks)

---

### F · Role Boundary Crossing

#### Symptom

Engineer goes to do "critical review" / QA directly modifies code / Coordinator gets caught in某detail亲自implements.

#### Root Cause

Role boundary written in system prompt — **soft constraint**. LLM sees "I can do this"倾向于do.

#### Current Handling (v0.1.0)

- 🟡 Agent system prompt constrains role定位.
- 🔵没有tool whitelist layer.

#### Recommended Solution

**Core Principle: Capability ≠ Permission, Capability即Permission.**

**Step 1 · Tool Whitelist (参考CrewAI)**

Each agent config add `tools` whitelist:

```yaml
agent:
  name: Coordinator
  tools: [
    create_task_card,
    assign_task,
    read_task_status,
    summarize,
    mention,
  ]
  #没有write_file, physically无法modify code

agent:
  name: QA
  tools: [
    read_file,
    run_test,
    compare_screenshot,
    review_diff,
    reject_task,
    approve_task,
  ]
  #没有write_file,无法modify code

agent:
  name: Engineer
  tools: [
    read_file, write_file, edit_file,
    run_command,
    update_task_status,
  ]
  #没有create_task_card,无法擅自add task
```

#### Priority · 🟡 Medium (P1)
#### Work Effort · M (4-6 weeks)

---

### L · Group Rule失效

#### Symptom

Group rules written thoroughly,但runs few rounds starts有人不遵守; rules间互相conflict时, agent随机选一方.

#### Root Cause

Group rules injected into each agent system prompt — **self-discipline**而非**external-discipline**. LLM in长context attention衰减; rules conflict时model自己arbitrates, inconsistent.

#### Current Handling (v0.1.0)

- ✅ Group rules injected into all agents' context.
- 🔵全是soft constraints,无forced layer.

#### Recommended Solution

**Core思路**: Group rules split two layers — **self-discipline layer** (prompt) and **external-discipline layer** (message bus hooks).

**Step 1 · Distinguish Two Layers**

| Layer | Type | Example | Implementation |
|-------|------|---------|----------------|
| **Self-discipline** | Encouraging, style | "Reply concise,不要闲聊", "Communicate in Chinese" | Inject prompt |
| **External-discipline** | Forced, structural | "Completion-type reply禁@", "Message must have task card id" | Message bus hook |

**Step 2 · External-discipline Layer Schema**

```yaml
chat_room:
  rules:
    self_discipline:        # Self-discipline layer
      - Reply concise
      - Use Chinese
    external_discipline:    # External-discipline layer
      - id: must_have_task_id
        when: pre_message_send
        match:
          speaker_role: [MEMBER]
          speaker_level: normal     # system agents exempt
        check: "msg.contains_task_id || msg.is_meta"
        on_fail:
          action: reject
          hint: "Reply must have task card id (except meta discussion)"
      - id: no_at_on_done
        when: pre_message_send
        match:
          content_pattern: "(complete|delivered|done)"
        check: "msg.mentions.length === 0"
        on_fail:
          action: reject
          hint: "Completion-type reply please use task card state change"
```

#### Priority · 🟡 Medium (P1)
#### Work Effort · M (4-6 weeks)

---

## Theme 4 · Quality and Cost

### J · Model Capability Mismatch

#### Symptom

- Assign Haiku "review complex architecture" — output shallow, misses key issues
- Assign Opus "fix one typo" — money wasted,还slow
- Same agent both writes complex business logic和fixes typo, fixed model左右不是

#### Root Cause

Agent layer currently is **`agent ↔ model`一对一**binding, model selection **人为static decision**. But task difficulty is **dynamic**.

#### Current Handling (v0.1.0)

- ✅ Agent可manually select model.
- ✅ Default templates按role give推荐model.
- 🔵无task-level dynamic routing.

#### Recommended Solution

**Step 1 · Agent → Model Strategy而非一对一**

```yaml
agent:
  name: EngineerA
  model_strategy:
    primary: claude-sonnet-4-6
    fallback_simple: claude-haiku-4-5     # Simple task downgrade
    fallback_complex: claude-opus-4-7     # Complex task upgrade
    decision_rule: by_task_complexity
```

**Step 2 · Task Card complexity Field**

```yaml
task_card:
  complexity: medium       # low / medium / high
  #由Coordinator estimates,或由LLM根据steps + expected_output auto estimates
```

**Step 3 · Routing Rule**

```typescript
function chooseModel(agent, taskCard) {
  switch (taskCard.complexity) {
    case 'low':  return agent.model_strategy.fallback_simple;
    case 'high': return agent.model_strategy.fallback_complex;
    default:     return agent.model_strategy.primary;
  }
}
```

**Step 4 · Cost Dashboard**

```
Group: My Blog Refactor
This month token consumption: 1.2M  ($14.50)
By Agent:
  - EngineerA: 850K ($9.20)
  - Coordinator:    200K ($3.50)
  - QA:    150K ($1.80)
By Task Card:
  - TC-001: 400K ($5.00) ← Most expensive
  - TC-002: 200K ($2.00)
By Model:
  - opus-4-7:   30% ($10.50) ← Highest ratio
  - sonnet-4-6: 60% ($4.00)
  - haiku-4-5:  10% ($0.10)
```

Let user see "money spent where", decide whether adjust model strategy.

#### Priority · 🟡 Medium (P1)
#### Work Effort · M (4-6 weeks, routing + dashboard各2-3 weeks)

---

### M · Evaluation Blind Spot

#### Symptom

Task card completes `done`, group看似一切顺利, but user actually opens app — button歪了, tests只covered happy path, docs inconsistent with code. **QA "passed"不等于 "really passed"**.

#### Root Cause

1. Acceptance criteria是 **natural language**,由QA agent用LLM判断 "whether satisfied" — subjective,易被表象骗.
2.没有cross task card **regression perspective** — this modification A module会不会break previously B module passed tests.
3.没有 "quality history" — this Engineer agent past delivery bug rate多少, this QA past miss rate多少, all unrecorded.

#### Current Handling (v0.1.0)

- 🟡 QA LLM review.
- 🟡 Task card `expected_output` written具体越好.
- 🔵无objective measurement layer.

#### Recommended Solution

**Step 1 · Three-Tier Acceptance**

| Tier | Implementation | Priority |
|------|----------------|----------|
| **Tier 1 · Objective Acceptance** | Run scripts/tests/verify hash/screenshot compare |能用objective不用subjective |
| **Tier 2 · QA LLM Review** | Current existing method | Fallback |
| **Tier 3 · User Final Sign-off** | High-risk tasks由user最后confirm | Only high-risk |

Implementation: Section G's `verifications` field即Tier 1 carrier.

**Step 2 · Regression Suite**

Each completed task card produces一组 "that task card as subsequent cannot break contract" tests:

```yaml
task_card:
  id: TC-001
  status: done
  regression_tests:
    - npm test login.test.ts
    - npm test e2e/login-sso.spec.ts
```

New task card enters `in_review`时 **auto runs all已done task cards regression tests**, fails则return.

**Step 3 · Quality Dashboard**

Each agent's long-term performance:

```
EngineerA最近30 days:
  Delivered task cards: 45
  First pass rate: 67%
  Average redo rounds: 1.4
  Average tokens / task: 32K
  Average duration: 18min

QA最近30 days:
  Reviewed task cards: 60
  Pass rate: 70%
  Post-discovered misses: 3
  Average review duration: 4min
```

User基于real data adjusts team config.

#### Priority · 🟢 Low (P2, long-term investment)
#### Work Effort · L (>10 weeks, dashboard + regression suite + trace各占一块)

---

## Solution Priority Overview

按 "ROI"和 "user emphasized度"排序:

### 🔴 P0 · Must Do Within 1-2 Months (5 items)

| Problem | Solution Core | Estimated Work | Resolution Degree |
|---------|---------------|----------------|-------------------|
| **A2 Fan-out Storm** | Completion-type reply禁@ + Coordinator aggregation window + debounce | M (4-6 weeks) | 80% |
| A1 Loop Prevention | Group rule hardening + Platform-level completion right | S (1-2 weeks) | 90% |
| **D File Conflict** | File-level pessimistic lock + Task card bound to git branch | M (4-6 weeks) | 80% |
| **E Info Sync** | File change event bus + Reverse subscription | M (4-6 weeks) | 90% |
| **G State Drift** | Objective acceptance hook (verifications field) | M (4-6 weeks) | 90% |

→串成一个 milestone: **"Hardening Task Card Collaboration"**. Three things linked (D's git branch, I's step_progress, G's evidence)一起做most cost-effective.

### 🟡 P1 · 3-6 Months (7 items)

| Problem | Solution Core | Estimated Work |
|---------|---------------|----------------|
| C @ Trigger Ambiguity | Role group @ + Smart fallback | M |
| H Deadlock Stalemate | Heartbeat output + Silent alert | S |
| K Human Intervention | Risk level + Permission mode | M |
| B Context Explosion | Message tiering + Agent subscription | L |
| I Interrupt Resume | step_progress + Decision log (linked with D) | M |
| F Role Boundary | Tool whitelist + Output schema | M |
| L Group Rule失效 | Self-discipline vs External-discipline (hooks) | M |
| J Model Mismatch | Task card complexity routing + Cost dashboard | M |

### 🟢 P2 · Long-term (1 item)

| Problem | Solution Core |
|---------|---------------|
| M Evaluation Blind Spot | Three-tier acceptance + Regression suite + Quality dashboard |

---

## Linkage Recommendations (One Fish Multiple Eats)

Implementation时these solution groups应 **bundle** do:

### Linkage 1 · "Hardening Task Card Collaboration" (Solves D/E/G/I)

Core改造: **Task Card ↔ Git Branch Strong Binding + verifications Field + File Change Event Bus**

One改造同时solves:
- D File concurrency conflict (Each card independent branch)
- E Info sync blind spot (File change event flow)
- G State drift (Commit hash as evidence)
- I Interrupt resume (Git branch naturally recoverable)

### Linkage 2 · "Dialogue State Separation" (Solves A2/L)

Core改造: **Dialogue Channel vs Task Event Channel Separation + External-discipline Layer Hooks**

One改造同时solves:
- A2 Fan-out storm (State change不走dialogue)
- L Group rule失效 (Hooks force structural rules)

### Linkage 3 · "Capability即Permission" (Solves F/K)

Core改造: **Tool Whitelist + Risk Level**

One改造同时solves:
- F Role boundary crossing (没loaded就无法do)
- K Human intervention timing (High-risk action pre-confirmation)

### Linkage 4 · "Observable Collaboration" (Solves J/M)

Core改造: **Task Card complexity Field + Cost Dashboard + Quality Dashboard**

Extended capability, long-term accumulates user decision data foundation.

---

## Connection with Existing Features

下表说明每个solution如何 **reuse**或 **extend** v0.1.0 existing capabilities:

| Solution | Reuse Existing | Need Add |
|----------|----------------|----------|
| A1 Loop Prevention | Group rule injection mechanism ✅ | Platform-level forced completion right check |
| A2 Aggregation Window | Task board ✅ | task_event channel, aggregator |
| C Role Group @ | @ trigger logic ✅, agentLevel ✅ | Role field, dynamic routing |
| D File Lock | task.related_files | Lock table, git branch auto create |
| E File Event | Streaming tool calls ✅ | Event bus, reverse subscription table |
| G Objective Acceptance | Task board ✅ | verifications field, verifier runner |
| I Interrupt Resume | "Pending Recovery Tasks" ✅ | step_progress, decisions log |
| F Tool Whitelist | Agent skills ✅ | tools field (distinct from skill),拦截 layer |
| K Risk Level |暂无 | Action tagging, permission_mode setting |
| L Group Rule Hooks | Group rules ✅ | hook schema, runtime validation |
| J Model Routing | Agent→model reference ✅ | model_strategy field, router |
| J Cost Dashboard |暂无 | Token metering上报, aggregation view |
| M Three-Tier Acceptance | QA agent ✅ | verifications + User sign-off UI |
| M Regression Suite |暂无 | Task card regression_tests field, cross-card runner |

---

## Next Steps

For具体 implementation schedule see [06-roadmap_EN.md](06-roadmap_EN.md).
