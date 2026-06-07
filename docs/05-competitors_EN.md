# 05 · Competitor Analysis

English | [中文](05-competitors.md)

> Break down all players in "AI helps humans write code / do work" into 5 tracks,逐一拆解 **what's their most valuable design, what we can learn, what we shouldn't copy**.

## 1. Track Map

| Track | Representative Products | Orchestration | Relationship with This Platform |
|-------|------------------------|---------------|--------------------------------|
| **IDE Single Agent** | Cursor, GitHub Copilot, JetBrains AI | Editor completion + one Q one A + Single Agent | Complementary: They focus "writing code in editor", we focus "orchestrating multiple roles for complex task" |
| **CLI Single Agent** | Claude Code, Aider, Cline/Roo Code, Continue | Terminal single agent + tool calls | Complementary: Can embed them as our Engineer Agent in group |
| **Autonomous Agent** | Devin, SWE-agent, OpenHands, Manus | Agent self-planning long tasks | **Direct Competition**: They also do "complete engineering task", but go "super employee" route |
| **Multi-Agent Framework** | CrewAI, AutoGen, LangGraph, MetaGPT | Code-defined roles and flows | Indirect competition: They're libraries for developers writing code, we're GUI product |
| **Workflow Orchestration** | Dify, Coze, n8n, Flowise | Drag-drop DAG | Indirect competition: They do fixed flows, we do **conversational flows** |

---

## 2. Product-by-Product Breakdown

### 2.1 Cursor

**Most Valuable Design**:
- **Deep Editor Integration**: Context不需要user主动塞 — cursor position, current file, project structure, recent changes全部auto给model
- **Auto Mode**: By context length and task type智能route model (Sonnet/Opus/Haiku auto select)
- **Composer/Tab Completion/Inline Edit Three Tiers**: Cover从"minor fix" to "multi-file refactor"

**We Can Learn**:
- Auto context collection思路 → Task card `related_files` auto reverse index
- Model routing strategy → Task card `complexity` field drives model_strategy
- Three-tier experience maps: Quick Chat (light) → Single Agent Task (medium) → Group Collaboration (heavy)

**Shouldn't Copy**:
- Lock into editor (We want走出IDE, create "virtual office")

---

### 2.2 GitHub Copilot / Copilot Workspace

**Most Valuable Design**:
- **Workspace** concept: From issue → spec → plan → code → PR end-to-end,每步user可modify
- Deep GitHub integration: Natural PR/Issue/CI context

**We Can Learn**:
- "spec → plan → code → PR" chain structure → Task card's `steps` + `expected_output` same思路
- "每步user可modify" → Risk level + Permission mode (see Chapter 04 Section K)

**Shouldn't Copy**:
- Heavy reliance on GitHub ecosystem (We want support any local project)

---

### 2.3 Claude Code (Highest Reference Value)

**Most Valuable Design**:
- **Permission mode**: `plan` / `acceptEdits` / `bypass` three-tier permission modes
- **Hooks system**: `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop` event interception points
- **Skills package system**: frontmatter + markdown describes capability packages, loadable, triggerable, community ecosystem
- **Plan mode**:不directly execute,先output plan供user review
- **Subagent**: Can dispatch sub-agent within main agent
- **Memory**: File-based persistent memory system

**We Can Learn**:
- ⭐ **Permission mode** → Direct copy as group-level permission setting,对应Chapter 04 Section K
- ⭐ **Hooks** → Group rules' "external-discipline layer" copies hooks思路 (pre_message_send/post_tool_use etc.)
- ⭐ **Skills format compatibility** → v0.1.0已通过symlink compatible
- **Plan mode** → Coordinator's task_card decomposition same思路
- **Subagent** → Group metaphor naturally is multi-subagent visualization version

**Already Learned**:
- ✅ Skill format compatibility (symlink mode直接mounts `~/.claude/skills/`)
- ✅ Streaming thinking visualization
- ✅ Local Agent reuse ("Use local Agent config" → connect Claude Code key)

**Shouldn't Copy**:
- Lock into CLI (We want GUI product)

---

### 2.4 Aider

**Most Valuable Design**:
- **Every step git commit**: Each agent modification auto commit, rely on git for checkpoints and rollback
- **Repo map**: Auto maintain project structure summary,每轮inject into model context
- **`weak-model` parameter**: Complex changes use large model, simple edits use small model
- **`/architect` mode**: Let architect model plan, editor model implement

**We Can Learn**:
- ⭐ **Every step git commit** → Task card ↔ git branch strong binding (see Chapter 04 D/I linkage solution)
- ⭐ **architect/editor dual model** → Agent model_strategy's primary/fallback_simple/fallback_complex
- **Repo map auto inject** → File change event bus (see Chapter 04 Section E)

**Shouldn't Copy**:
- Single Agent route (We bet on multi-Agent)

---

### 2.5 Cline / Roo Code / Continue

**Most Valuable Design**:
- VS Code extension, deep editor integration
- Transparent tool calls (each file edit/bash command displayed)
- Plan/Act dual mode

**Learn**: Transparent tool calls → v0.1.0已implemented `toolCalls` streaming display

---

### 2.6 Devin (Direct Competitor ⭐⭐)

**Most Valuable Design**:
- **Complete session snapshot**: Can pause/resume, cross-day继续run
- **Session recording**: Screen-level session replay,事后可watch how Devin did it
- **Approval Points**: Stop at key decisions等待user sign-off
- **Stuck self-rescue**: Try alternate paths or主动ask user
- **Complete virtual environment**: Devin has own container, browser, IDE

**We Can Learn**:
- ⭐ **Session snapshot** → Task card step_progress + decision log (see Chapter 04 Section I)
- ⭐ **Session recording** → Streaming thinking + executionRecords已经接近,可add screen recording as objective evidence
- ⭐ **Approval points** → Risk level + Permission mode (see Chapter 04 Section K)
- ⭐ **Stuck self-rescue** → Task card heartbeat output + silent alert + auto alternate path (see Chapter 04 Section H)

**Shouldn't Copy**:
- Single Agent "super employee" route (We bet on multi-Agent group collaboration observability)
- Complete black-box execution (User看不见intermediate process, unfriendly to engineers)

---

### 2.7 SWE-agent / OpenHands

**Most Valuable Design**:
- Open source, self-hostable
- ACI (Agent-Computer Interface) abstraction, let agent operate terminal/browser类似human方式

**Learn**: ACI思路 → Our toolset (Read/Edit/Bash etc.) same思路; Can consider adding Browser tool support.

---

### 2.8 CrewAI

**Most Valuable Design**:
- ⭐ **Role-based agents**: Each agent has role/goal/backstory, explicit分工
- ⭐ **Tools hard whitelist**: Each role loads different tools,没loaded就不能用 — **capability即permission**
- **Task串/parallel**: Tasks explicitly declare dependencies
- **Task.context**: Task可declare depends on which preceding task outputs,不让all history flood
- **Pydantic output schema**: Task output bound to structure, schema wrong就regenerate
- **Manager agent**: Can have LLM serve as manager dynamically assign tasks

**We Can Learn**:
- ⭐⭐⭐ **Tools hard whitelist**: Chapter 04 Section F role boundary核心solution copies this
- ⭐⭐ **Task.context explicit dependency**: Chapter 04 Section B context subscription可learn
- ⭐⭐ **Pydantic schema**: Chapter 04 Section G objective acceptance verifications field same思路

**Shouldn't Copy**:
- Write code to define flows (We do GUI)

---

### 2.9 AutoGen

**Most Valuable Design**:
- **GroupChat + GroupChatManager**: Multi-Agent dialogue core abstraction
- ⭐ **Speaker selection function**: Explicit select next speaker function,可inject business rules
- Various **dialogue modes**: round-robin, selector, broadcast, nested-chat
- **Conversable Agent** abstraction: All agents can converse

**We Can Learn**:
- ⭐⭐⭐ **Speaker selection function**: Chapter 04 A1 loop prevention, A2 fan-out storm, C @trigger ambiguity可借这个思路 — **upgrade speaking right dispatch from "@trigger" to "explicit dispatch function"**
- Multiple dialogue modes → Group rules different presets (pipeline mode / free discussion mode / role group mode)

**Shouldn't Copy**:
- Python library form (We do GUI)

---

### 2.10 MetaGPT

**Most Valuable Design**:
- ⭐ **SOP enforcement**: Turn behavior constraints into code-layer standard operating procedures, not prompts — outputs不遵守根本不会进入next step
- **Role inheritance**: Roles可inherit
- **Message bus + role subscription**: Each role只responds to message types it cares about (not indiscriminate @trigger)
- **PRD → Design → Code → Test** complete software engineering SOP

**We Can Learn**:
- ⭐⭐⭐ **Code-layer SOP**: Chapter 04 Section L group rule失效 core solution is this — make "external-discipline layer" code not prompt
- ⭐⭐ **Message bus + subscription**: Chapter 04 Section B context explosion core solution — agents subscribe by tier
- "Test passed" as SOP hard node → Chapter 04 Section G/M objective acceptance

**Shouldn't Copy**:
- Complete software engineering SOP too rigid (We want "group collaboration" flexibility)

---

### 2.11 LangGraph

**Most Valuable Design**:
- ⭐ **State machine explicit modeling**: Make multi-agent collaboration into directed graph, nodes are agents, edges are state transitions
- **Checkpointer**: State snapshots可persist,可resume
- **Time travel**: Can go back to past state fork重新run
- **Human-in-the-loop**: Node-level explicit insert user intervention points

**We Can Learn**:
- ⭐⭐ **Checkpointer** → Task card step_progress + git branch already similar direction
- **Human-in-the-loop** → Chapter 04 Section K risk level + permission mode
- **Time travel** → Task card level "redo"

**Shouldn't Copy**:
- DAG explicit modeling (We want "conversational dynamic dispatch", not pre-orchestrated)

---

### 2.12 Dify / Coze

**Most Valuable Design**:
- Node-level human intervention points
- Trial run debugger (see each node's input/output)
- Template marketplace

**Learn**:
- Template marketplace → Chapter 06 roadmap phase three's "Team Template Marketplace"
- Trial run debugger →已通过cron's "Immediate Test" + executionRecords implemented

**Shouldn't Copy**: Drag-drop DAG mode

---

### 2.13 LangSmith / Langfuse / Helicone

**Most Valuable Design**:
- LLM application observability platform: trace, eval, cost tracking
- Each output scored by rules, accumulate quality curve

**Learn**: Chapter 04 Section J/M cost dashboard + quality dashboard same思路. Can consider direct OTLP protocol export.

---

## 3. Cross-Comparison Table

### 3.1 Capability Dimensions

| Dimension | Cursor | Claude Code | Devin | CrewAI | AutoGen | MetaGPT | Dify | **TeamAgentX** |
|-----------|--------|-------------|-------|--------|---------|---------|------|---------------|
| Multi-Agent Collaboration | ❌ | Partial (subagent) | ❌ (single super Agent) | ✅ | ✅ | ✅ | ❌ | ✅✅ |
| GUI Config | ✅ | Partial (CLI为主) | ✅ | ❌ (write code) | ❌ (write code) | ❌ (write code) | ✅ | ✅ |
| Task Card / Structured Task | ❌ | Partial (plan) | ❌ | ✅ | ❌ | ✅ (SOP) | Node-level | ✅ |
| Context Project Isolation | Project-level | Project-level | Session-level | Process-level | Process-level | Process-level | Workflow-level | **Group-level Three-layer** |
| Skill / Capability Package System | ❌ | ✅ (most complete) | ❌ | tools | tools | actions | node | ✅ (Claude Code compatible) |
| Tool Whitelist (hard constraint) | ❌ | ✅ | ❌ | ✅ | Partial | ✅ | ✅ | 🔵 (planned) |
| Human Intervention Strategy | Free ask | permission mode | approval points | Task-level | Node-level | Node-level | Node-level | Three trigger points + planned permission mode |
| Objective Acceptance / SOP | ❌ | ❌ | Test + screenshot | guardrails | ❌ | ✅ | Node validation | 🔵 (planned) |
| Interrupt Resume | ❌ | Plan persist | ✅ (snapshot) | ❌ | checkpointer | ❌ | ❌ | 🔵 (planned) |
| Model Routing | ✅ auto | Partial | ❌ | Config | Config | Config | Node config | 🔵 (planned) |
| Group-level Cron | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Partial | ✅⭐ |
| Suitable Scenario | Write code | Medium complexity task | Long task automation | Engineer customization | Engineer customization | Engineer customization | Repetitive flows | **Solo developer complex multi-step** |

### 3.2 User Experience Dimensions

| Dimension | Cursor | Claude Code | Devin | CrewAI | Dify | **TeamAgentX** |
|-----------|--------|-------------|-------|--------|------|---------------|
| Onboarding Cost | Low | Medium (CLI) | Low | High (write code) | Medium (drag) | **Extremely Low (everyone knows groups)** |
| Transparency | Medium | High (streaming + tool) | Medium (session recording) | Low | Medium | **High (streaming thinking + executionRecords)** |
| Debugging Capability | Average | Good | Good | Weak | Good | **Good (context inspection + execution details)** |
| Collaboration Visibility | N/A | Weak (subagent black-box) | N/A | Weak | DAG visible | ✅ **Group dialogue naturally visible** |

---

## 4. Moves to Copy (Summary)

By "ROI × Feasibility"排序:

| Inspiration Source | Move | Our Problem | Priority |
|--------------------|------|-------------|----------|
| Claude Code | Permission mode + Hooks | K Human intervention + L Group rules | 🔴 High |
| CrewAI | Tools hard whitelist | F Role boundary | 🔴 High |
| AutoGen | Speaker selection function | A1 Loop prevention + A2 Fan-out + C @Ambiguity | 🔴 High |
| MetaGPT | Code-layer SOP + Message subscription | L Group rule失效 + B Context explosion | 🔴 High |
| Aider | Every step git commit | D File conflict + I Interrupt resume | 🔴 High |
| CrewAI | Pydantic output schema | G State drift + M Evaluation blind spot | 🔴 High |
| Devin | Session snapshot | I Interrupt resume | 🟡 Medium |
| Devin | Stuck self-rescue | H Deadlock stalemate | 🟡 Medium |
| Cursor | Auto model routing | J Model mismatch | 🟡 Medium |
| Devin | Session recording | M Evaluation blind spot | 🟢 Low |
| Dify | Template marketplace | Roadmap phase three | 🟢 Low |
| LangSmith | OTLP trace export | M Evaluation blind spot extension | 🟢 Low |

## 5. What Not to Copy (Pitfalls)

| Design | Why Not Copy |
|--------|--------------|
| Fully autonomous "super employee" (Devin route) | We bet "group chat + multi-role", not single Agent万能; User experience "seeing multi-role collaboration" is core value |
| Drag-drop DAG (Dify/Coze route) | We bet "conversational dynamic dispatch", DAG too rigid |
| Code-defined flows (CrewAI/LangGraph route) | Target user is "动手developer但不想写orchestration code person", GUI config is core |
| Fully open-source framework (AutoGen/MetaGPT route) | Framework is developer tool, we're end-user product; Can **learn architecture思路**但不需**make into framework** |
| Lock into editor (Cursor/Copilot route) | Editor is part of workflow not whole; We want "virtual office", covering editor + docs + research + task management |
| GitHub strong binding (Copilot Workspace) | User projects可能不在GitHub, local projects也要support |

## 6. One-Line Differentiation

**Others solve "let AI do one thing for me", we solve "let AI team do one complex thing for me".**

Transfer development collaboration's "分工 / responsibilities / boundaries / wrap-up / acceptance"这些 **human teams already verified engineering practices** to AI teams.

## 7. Where We Already Surpass Competitors

不只是 "imitate + integrate" — v0.1.0 already has several unique highlights:

| Unique Feature | Value |
|----------------|-------|
| **Group-level Cron** | No one does "hang scheduled tasks in group" |
| **Paste text one-click parse model config** | UX outstanding |
| **Streaming prompt optimization** | New angle helping user write good system prompts |
| **Create skill via chat** ("@Skill Manager" system agent) | Skill creation zero门槛 |
| **Local Agent reuse** (connect Claude Code key) | Complementary with Claude Code not competing |
| **Three-layer workDir strategy** | Group-level shared + Agent default + Quick Chat independent |
| **Per-agent per-group independent context / history injection toggle** | More fine-grained than CrewAI etc. |
| **Mobile QR code connection** | Cross-device collaboration |

---

Detailed roadmap see [06-roadmap_EN.md](06-roadmap_EN.md).