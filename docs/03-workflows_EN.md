# 03 · Workflows

English | [中文](03-workflows.md)

> This chapter breaks down the full process from "user submits requirement to receiving delivery", examining what each step does at platform layer and corresponding v0.1.0 implemented capabilities.

## 1. Complete Lifecycle

```
① Create Group       User: Create "My Blog Refactor" group, assign work directory
② Configure Team     User: Add Coordinator+EngineerA+EngineerB+QA to group, apply default dev template
③ Set Group Rules    User: Select/modify group rules (@ conventions, round limit, wrap-up authority)
④ Submit Requirement User: @Coordinator "Change homepage to SSR + add dark mode"
⑤ Split Task Cards   Coordinator: Understand → produce N task cards (with owner, acceptance criteria, boundaries)
⑥ Dispatch           Coordinator: @EngineerA take TC-001, @EngineerB take TC-002 (can parallelize)
⑦ Execute            Engineer: Claim card → modify files → run tests → update task card status
⑧ Acceptance         Engineer delivers → Coordinator @QA → QA reviews against "expected output + out-of-scope"
⑨ Close Loop         Pass → task card done; Fail → return to engineer with notes
⑩ Wrap-up Delivery   All task cards done → Coordinator [Discussion Complete] + summary change list
```

Platform capabilities per step:

| Step | Platform Capability | v0.1.0 Status |
|------|---------------------|---------------|
| ① Create Group | Work directory isolation, group creation | ✅ |
| ② Configure Team | Agent template reuse, agentLevel system/normal distinction, batch add members | ✅ |
| ③ Set Group Rules | Group rules injected into all agents' context | ✅ (self-discipline layer only) |
| ④ Submit Requirement | @ trigger, default receiving agent | ✅ |
| ⑤ Split Task Cards | Task board | ✅ (schema pending unification) |
| ⑥ Dispatch | @ routing, sequential response | ✅ |
| ⑦ Execute | Streaming output, tool calls, filesystem access | ✅ |
| ⑧ Acceptance | QA agent + LLM review | 🟡 (no objective acceptance hook) |
| ⑨ Close Loop | Task status switching | 🟡 (no hard constraint) |
| ⑩ Wrap-up | Loop prevention (Smart Collaboration budget/breaker), hand back to owner | ✅ loop prevention hardened; discussion-complete marker still conceptual |

## 2. In-Group Message Flow Protocol

```
User/Agent speaks
   ↓
[Message Bus] parses @ list + group rules validation
   ↓
   ├─ Self-discipline rules: Injected into all agents' context (prompt layer)
   └─ External-discipline rules (planned): Message bus hook intercept violations
   ↓
Agents @mentioned → enter "pending response" queue
Agents not @mentioned → silently consume context, don't speak (if subscribed to relevant task cards)
   ↓
Queue processed sequentially (no抢先回答)
   ↓
Agent response = System prompt + Group rules (self-discipline) + Group context window + Own memory slice + Loaded skills
   ↓
   ├─ Streaming output display: streamingContent / streamingThinking / toolCalls
   └─ Persistence: messages table + executionRecords
   ↓
Exactly one valid @ (Smart Collaboration) → fast path, queue for next round
@ anomaly / multi-@ (Smart Collaboration) → coordinator adjudicates (fix / parallel batch / serial chain / ask owner)
No @ (Smart Collaboration) → not processed now, stall watchdog fallback
Any @ (manual mode) → don't queue, only show as mention
   ↓
hops +1; on collaboration-budget trip (100 hops / 3 consecutive round-trips, single-@ relay only) → stop auto-dispatch and @ owner
A human message → resets counters and takes over
```

### 2.1 Three Bottom-Level Invariants

1. **Only Coordinator can announce completion** (exclusive completion right → prevent loops)
2. **Agents don't抢先回答** (only speak when @mentioned → prevent @ trigger ambiguity)
3. **Parse @ before speaking each round** (resolve ambiguity before consuming tokens → prevent context explosion)

### 2.2 Trigger Modes (merged into two in 2026-06)

| Mode | Behavior | Suitable Scenario |
|------|----------|-------------------|
| **Smart Collaboration (default)** | Single-@ takes the fast path to relay directly; the Group Coordinator is invoked only at 5 points (user routing miss / @ anomaly / batch join / stall / breaker); user multi-@ goes to the coordinator to split into single/parallel/serial | Vast majority of multi-role collaboration rooms |
| **Manual Mode** | @ in agent message doesn't trigger other agents, only as mention | User manual orchestration, agents don't cross-stage |

The storage layer stores `agentTriggerMode` as `coordinator` (Smart Collaboration) / `manual`, with `auto` as a legacy alias. Detailed rules and @ parsing in [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md); merge design in [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md).

### 2.3 Default Receiving Agent

When group owner (user) sends message without @ anyone, automatically @ group's configured "default receiving agent".
Usually default set to **Coordinator** — user casually says "someone look at this", Coordinator catches then specifically dispatches.

## 3. Task Card State Machine

```
        ┌──────────┐  Coordinator creates
        │   todo   │ ◄──────────────
        └────┬─────┘
             │ Engineer claims
             ▼
        ┌──────────┐  blocked ┌──────────┐
        │in_progress├─────►│ blocked  │
        └────┬──────┘      └────┬─────┘
             │ Engineer delivers       │ Coordinator/User unblock
             ▼                  │
        ┌──────────┐ ◄──────────┘
        │ in_review│
        └────┬─────┘
       Pass │   │ Fail (return with notes)
            ▼   └─────► in_progress
        ┌──────────┐
        │   done   │
        └──────────┘
```

### 3.1 Valid State Transition Trigger Parties

| State Transition | Only Valid Trigger Party | Recommended Attached Evidence |
|------------------|--------------------------|------------------------------|
| `todo` → `in_progress` | owner agent (claim) | Claim timestamp |
| `in_progress` → `in_review` | owner agent (deliver) | diff hash + test log (planned) |
| `in_review` → `done` | reviewer agent (acceptance pass) | verifications all pass + screenshot (planned) |
| `in_review` → `in_progress` | reviewer agent (return) | Return notes |
| `*` → `blocked` | any agent | Must fill `blockers` field |
| `blocked` → `in_progress` | Coordinator or user | Unblock explanation |

Invalid transitions rejected by message bus and broadcast to Coordinator (ensuring state consistency).

### 3.2 Task Board (v0.1.0 Implemented)

Tasks displayed in 6 status columns:

```
┌────────┬────────┬────────┬────────┬────────────┬────────┐
│ Pending │Waiting │Executing│Completed│Failed/Cancel│Recovery│
├────────┼────────┼────────┼────────┼────────────┼────────┤
│ TC-003 │ TC-004 │ TC-001 │ TC-000 │   TC-XX    │ TC-005 │
│ TC-006 │        │ TC-002 │        │            │        │
└────────┴────────┴────────┴────────┴────────────┴────────┘
```

- "Task queue executes in time order, currently executing first pending task"
- Click task card to jump to corresponding message (task ↔ message bidirectional association)
- Columns can show/hide

## 4. Blocking Escalation and Human Intervention

### 4.1 Three Situations Where Agent Proactively Reports Blocking

| Situation | Example | Post-report Flow |
|-----------|---------|------------------|
| **Capability Boundary Crossing** | Engineer assigned "decide whether to do this feature" | Coordinator takes over, escalate to user if needed |
| **Information Missing** | Task card says integrate SSO, but doesn't specify which provider | Coordinator @Researcher or @user |
| **Resource/Tool Failure** | API failure, dependency won't install | Coordinator judges retry / alternate path / escalate |

### 4.2 Three Clear Human Intervention Trigger Points

Platform **actively calls human**, doesn't rely on user actively monitoring:

1. **Coordinator judges blocking needs human decision** → Push notification to user
2. **Round limit reached and consensus not achieved** → Force Coordinator wrap-up with "pending user ruling" tag
3. **QA rejection three times** → Escalate human intervention, avoid Engineer ↔ QA dead loop

**Core Principle**: User is "board of directors" not "customer service" — platform尽量自闭环, **only interrupts when truly needs sign-off**.

### 4.3 Planned Extensions (see Chapter 04 Section K)

Introduce **risk level + permission mode** — upgrade "whether needs user sign-off" from language judgment to platform rule:

```
high risk action (delete file / git push / call paid API) → Platform layer pre-confirmation popup
medium risk action → Depends on group permission mode
low risk action (read file / search docs) → Auto allow
```

## 5. Group-level Cron Workflow (Unique Feature)

### 5.1 Typical Use Cases

| Scenario | Cron Config | Execution Content |
|----------|-------------|-------------------|
| Daily competitor scan | `Every day 9:00` | "@Researcher crawl competitor updates this week" |
| Weekly code summary | `Every Friday 18:00` | "@Coordinator summarize this week's changes and write changelog" |
| Monitor service status | `Every hour` | "@Monitor check service and alert" |
| One-time reminder | `2026-05-15 15:00 one-time` | "@Documenter write v1 release notes" |

### 5.2 Cron Trigger Flow

```
[Cron Worker] Time arrives
   ↓
Read cron-task config (chatRoomId, executionContent, autoMentionAgent)
   ↓
Send system message to group:
  "@Researcher [Cron Trigger] crawl competitor updates this week"
   ↓
@mentioned agent enters pending response queue normally, executes per normal flow
   ↓
Execution result written back to executions table (duration, success/fail, error info)
```

### 5.3 Cron Execution Management

- History execution records: `GET /cron-tasks/:id/executions`
- Immediate test: `POST /cron-tasks/:id/test` (run once without waiting for scheduled time)
- Enable/Disable: `PATCH /cron-tasks/:id/enable`
- Max retry count: Auto retry on failure

## 6. Quick Chat Workflow (Lightweight Branch)

### 6.1 When to Use Quick Chat

| Scenario | Group Chat | Quick Chat |
|----------|------------|------------|
| Complex multi-step task | ✅ | ❌ |
| 1v1 quick Q&A | Heavy | ✅ |
| Multi-role collaboration | ✅ | ❌ |
| One-off prompt | Heavy | ✅ |

### 6.2 Quick Chat Features (v0.1.0 Implemented)

- Skip group creation, direct 1v1 chat with specific agent
- "This is a quick chat room, messages directly sent to agent, no @ mention needed"
- Can specify independent workDir, or leave empty for default (each new session independent directory)
- Create endpoint: `POST /agents/quick-chat`
- List endpoint: `GET /agents/:id/quick-chat-rooms?userId=...`
- Internally still a chatRoom, marked `isQuickChat: true`

## 7. Cross-Workflow Cross-Cutting Concerns

### 7.1 Context Management (Linked with Chapter 04 Section B)

Each message flows through agent, agent actually sees context = System prompt + Group rules + **Visible group messages** + **Own memory slice** + Skill prompts.

v0.1.0 control points:
- When adding agent to group, `injectGroupHistory: true|false` decides whether to inject history
- "Clear context" button resets specific agent's conversation memory in specific group
- "View context" can inspect what current agent can see

Planned: Message tiered subscription, auto-rolling summary (see Chapter 04 Section B).

### 7.2 File Collaboration (Linked with Chapter 04 Section D/E)

v0.1.0 status:
- Group-level shared workDir
- Agent operates files via Edit/Write/Bash tools
- No concurrency control yet, no change broadcast yet

Planned:
- File-level pessimistic lock (task card `related_files` upgraded to lock table)
- File change event bus (auto diff summary broadcast to subscribers)
- Task card ↔ git branch strong binding (each card independent branch, physical isolation)

### 7.3 Acceptance Pipeline (Linked with Chapter 04 Section G/M)

v0.1.0 status:
- QA agent LLM review
- Task card `expected_output` natural language

Planned:
- Task card `verifications` field (machine-verifiable assertions)
- Three-tier acceptance: Objective > QA LLM > User sign-off
- Regression suite: Each completed task card produces contract tests

## 8. Workflow State Visualization

```
[Group] ──→ [Task Card Board]
           │
           ├──→ [Pending]    ← Coordinator just split
           ├──→ [Waiting]    ← Dispatched to agent not claimed
           ├──→ [Executing]  ← owner claimed doing
           │      │
           │      └──→ [Streaming Output Visualization]
           │              streamingContent
           │              streamingThinking
           │              toolCalls
           │
           ├──→ [Completed]  ← Passed acceptance
           ├──→ [Failed/Cancelled]
           └──→ [Recovery]   ← Interrupt resume mechanism (planned enhancement)
```

Each task card can be clicked through to corresponding message, seeing complete execution chain (`/messages/:id/execution`).
