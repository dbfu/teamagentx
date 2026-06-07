# 01 · Product Overview: Positioning and Core Architecture

English | [中文](01-overview.md)

## 1. One-Line Definition

**TeamAgentX** turns a "development team" into an **AI group chat** that can be added to groups, understands @ mentions, and works on task cards — enabling a single developer to orchestrate a multi-role collaborative virtual team alone.

## 2. Target Users

**Solo developers / Hackers**.

Typical profile:
- Maintains multiple projects alone
- Already using single-agent tools like Claude Code, Cursor, Aider
- Already feeling the boundary of "single agent can't complete complex things" — tasks requiring coding, reviewing, testing, researching
- Cost of single-threaded context switching: either token explosion, lost threads, or role mismatch (asking coder to do "critical review" always falls short)

## 3. Core Metaphor: Group Chat ≠ Workflow ≠ Single Agent

| Form | Metaphor | Flexibility | Learning Cost | Representative Products |
|------|----------|-------------|---------------|------------------------|
| Workflow Type | Pipeline | Low (fixed DAG) | Medium | n8n / Dify / Coze |
| Single Agent | Super Employee | High | Low | Cursor / Aider / Cline |
| Multi-Agent Framework | Code-defined flow | High | High (write code) | CrewAI / AutoGen / MetaGPT |
| **Group Chat Type (This Platform)** | **WeChat group directing colleagues** | **High** | **Extremely Low (everyone knows groups)** | **TeamAgentX** |

**Key Insight**: Make "ask engineer to write", "@ QA to review", "@ coordinator to split tasks" first-class interactions, reusing every developer's existing "group collaboration muscle memory".

## 4. Fundamental Difference from Existing Forms

| Form | Orchestration | Collaboration Granularity | Context Management | Suitable Scenarios |
|------|--------------|--------------------------|-------------------|-------------------|
| IDE Plugin | Single agent in editor | File/Function | Single-threaded | Writing code |
| Workflow | Pre-orchestrated DAG | Node | Explicit node-to-node passing | Repetitive processes |
| Single Agent Autonomous | Agent self-planning | Task | Agent self-managed | Medium complexity independent tasks |
| Multi-Agent Framework | Code-defined roles | Role | Framework passing | Engineer-customizable scenarios |
| **Group Chat Type (This Platform)** | **Group rules + @ trigger** | **Task Card** | **Group-as-Project, Three-layer Isolation** | **Complex multi-step tasks for solo developers** |

Differentiation trio: **Task Cards** (what to do) + **Group Metaphor** (how to orchestrate) + **Context Isolation** (where to work).

## 5. Why Not Just Use ChatGPT Group Chat?

General AI chat products (ChatGPT, Doubao, Kimi group chat etc.) can also "add multiple bots to discuss in a group", but fundamentally they're **chat venues** not **work venues**. The gap isn't "can multi-agent converse", but these seven things:

| Capability | General AI Group Chat | TeamAgentX |
|------------|----------------------|------------|
| Persistent Work Directory | ❌ Each conversation ephemeral | ✅ Group-as-project, files land |
| Task Card Mechanism | ❌ Pure natural language | ✅ Structured, trackable, verifiable |
| Role Boundary Enforcement | ❌ Role via prompt, crossing unchecked | ✅ Group rules + task card boundaries |
| Skill Loading | ❌ Only persona setting | ✅ Agent can independently load skills |
| Per-Agent Model Selection | ❌ Whole group one model | ✅ Each agent independent model choice |
| Blocking / Human Intervention | ❌ No reporting channel | ✅ Blocking reporting mechanism |
| Context Isolation | ❌ All in one pot | ✅ File/Task card/Agent memory three-layer |

One line: **General AI group chat is "meeting room whiteboard", TeamAgentX is "real office with workstations, file cabinets, process cards"**.

## 6. Standard Development Team Configuration (Example)

Translating "solo developer" into specific group configuration:

| Agent | Role | Recommended Model | Loaded Skills | Trigger Method |
|-------|------|-------------------|---------------|----------------|
| 🎯 **Coordinator** | Requirement decomposition, task card distribution, blocking handling, wrap-up | Opus 4.7 | `brainstorming`, `writing-plans` | @Coordinator / Group owner default |
| 🛠 **Engineer A** (Main implementer) | Write code, run tests | Sonnet 4.6 | `react` / `nodejs-backend` etc. | @EngineerA or Coordinator assignment |
| 🛠 **Engineer B** (Auxiliary / Parallel) | Handle parallelizable subtasks | Sonnet 4.6 | Same stack or different | Same as above |
| 🔍 **QA** | Review output against "acceptance criteria + out-of-scope" | Opus 4.7 (review needs more reasoning than writing) | `code-review`, `verify` | Coordinator triggers after Engineer delivery |
| 📚 **Researcher** (Optional) | Search docs, research competitors | Haiku 4.5 (cheap & fast) | `WebSearch`, `WebFetch` | Coordinator @ as needed |
| 📝 **Documenter** (Optional) | Write README, changelog | Haiku 4.5 | `writing-clearly` | @ before delivery |

**Minimum viable team = Coordinator + Engineer + QA (3 members)**; expand with Researcher, Documenter, second Engineer for parallel work as needed.

Each agent's "model/skills/prompt" trio configured independently, group rules responsible for binding them into a "team" — **this is the platform's core product form**.

---

## 7. Core Architecture

### 7.1 Five Core Elements

| Layer | Element | Problem Solved |
|-------|---------|----------------|
| 🔧 Process | **Task Card Mechanism** | What to do |
| 👤 Responsibility | **Role Boundary** | Who's responsible |
| ✅ Quality | **Acceptance Criteria** | How to define done |
| 📦 Space | **Group-as-Project** | Where to work |
| 🛡 Safety | **Blocking Escalation** | What when problems arise |

### 7.2 Four-Layer Model (Product's Four First-Class Citizens)

```
Group (ChatRoom)              ← Context container, task card carrier
  └─ Agent (Agent)            ← Role + configuration
        ├─ Model (LLM Provider)    ← Reasoning engine
        └─ Skill (Skill)           ← Capability package
```

| Layer | What It Is | Reuse Granularity | Key Configuration |
|-------|------------|-------------------|-------------------|
| **Model** | API key + provider + model id | Platform-wide shared | `provider/model_id/api_key/api_url/api_protocol/is_default` |
| **Skill** | Prompt snippet + tool whitelist + triggers (Claude Code skill format compatible) | Cross-agent reuse | `slug/version/description/prompt/tools/triggers` |
| **Agent** | Model + system prompt + skill set + role positioning | Cross-group reuse | `name/role/model_ref/system_prompt/skills[]/agent_level` |
| **Group** | Agent set + group rules + task cards + work directory | One group = one project | `members[]/rules/work_dir/task_cards[]/cron_tasks[]` |

**Key Design: All four layers use references not nesting.** Change one model key, all agents referencing it immediately affected; delete one skill, all agents loading it receive invalidation signal.

### 7.3 Group-as-Project: Three-Layer Context Isolation

| Isolation Layer | Boundary | Implementation | What It Prevents |
|-----------------|----------|----------------|------------------|
| **File Layer** | Each group exclusively owns one `work_dir` | Independent directory assigned at group creation, all agent file operations locked to this directory | Agent modifying wrong project's files |
| **Task Card Layer** | Task cards belong only to current group | Task card ID carries group prefix, cross-group invisible | Project A progress polluting Project B |
| **Agent Memory Layer** | Agent has independent memory slice per group | Agent instance = `agent_template + group_id`, conversation history/memory per-group storage | Cross-project contamination, info leakage |

**All three layers essential**: Missing file layer → wrong file modifications; Missing task card layer → state contamination; Missing memory layer → context pollution.

**Agent Template vs Agent Instance**: Template is "Engineer A's persona and capabilities", can be instantiated in multiple groups; Instance holds specific working memory and task history. This is the "group-as-project" principle's implementation at Agent layer.

v0.1.0 implemented related capabilities:
- Group-level `workDir` ("all agents in group share this runtime directory")
- Agent-level default `workDir` ("agent default directory")
- Quick chat level independent `workDir` ("when empty, each conversation creates independent session directory")
- Optional `injectGroupHistory: true|false` when adding agent to group (controls group context injection)
- Clear agent's context in specific group (`POST /chatrooms/:id/agents/:id/clear-context`)

### 7.4 Communication Model

```
[User / Agent] speaks
   ↓
[Message Bus] parses @ list + group rules validation (heuristic layer hooks)
   ↓
Agents @mentioned → enter "pending response" queue
Agents not @mentioned → silently consume context, don't speak
   ↓
Queue processed sequentially (no抢先回答)
   ↓
Agent response = System prompt + Group rules (self-discipline layer) + Group context window + Own memory slice + Loaded skills
   ↓
Response contains new @ → queue for next round
Response contains [Discussion Complete] and speaker is Coordinator → group closed
   ↓
Round +1, reach limit → force Coordinator wrap-up
```

**Three Bottom-Level Invariants**:

1. **Only Coordinator can announce completion** (exclusive completion right → prevent loops)
2. **Agents don't抢先回答** (only speak when @mentioned → prevent @ trigger ambiguity)
3. **Parse @ before speaking each round** (resolve ambiguity before consuming tokens → prevent context explosion)

Detailed workflows in [03-workflows_EN.md](03-workflows_EN.md).

---

## 8. Three Major Product Moats

1. **Group Chat Metaphor**: Reusing human "group collaboration muscle memory", zero learning cost to start
2. **Task Cards + Group-as-Project**: Transforming "chaotic chat" into "productive collaboration", file/task/memory three-layer isolation prevents mutual contamination
3. **Observable Multi-Agent Collaboration**: Streaming thinking chains, execution records, debug info, context inspection — **visible collaboration** builds more trust than "black-box agents"

## 9. Document Navigation

- [02 · Feature List](02-features_EN.md) —— v0.1.0 delivered capabilities review
- [03 · Workflows](03-workflows_EN.md) —— Group lifecycle, state machines, message flow
- [04 · Major Problems and Solutions](04-problems-and-solutions_EN.md) —— **Core Chapter**: 13 problems deep analysis
- [05 · Competitor Analysis](05-competitors_EN.md) —— 5 track comparison, learnable optimizations
- [06 · Roadmap](06-roadmap_EN.md) —— Three-phase implementation schedule
- [07 · Appendix](07-appendix_EN.md) —— Glossary, schemas, known minor issues