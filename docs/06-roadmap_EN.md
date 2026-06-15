# 06 · Differentiation Positioning and Roadmap

English | [中文](06-roadmap.md)

> **2026-06 progress**: the loop/fan-out hardening of Phase 1 ("harden collaboration") has shipped — Smart Collaboration (merged auto/coordinator) brings the triple collaboration-budget breaker, parallel-batch fork-join, and 5-point coordinator fallback; plus new dispatch rules (workflow visualization), workbench today-tasks, and the dispatch log. Unified task-card schema, objective acceptance hooks, and file-concurrency control remain future goals. See [02-features_EN.md](02-features_EN.md), [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md), [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md).

## 1. What We're Actually Selling

**NOT** "another Cursor".
**NOT** "another Devin".
**NOT** "GUI version of CrewAI".

**IS**: **Let one solo developer have "an AI team they can orchestrate" — fully equipped roles,各自职责, working by task cards,有boundaries有acceptance virtual office**.

## 2. Three Major Product Moats

1. **Group Chat Metaphor**: Reuse human "group collaboration muscle memory", zero learning cost to start
2. **Task Cards + Group-as-Project**: Transform "chaotic chat" into "productive collaboration", file/task/memory three-layer isolation prevents mutual contamination
3. **Observable Multi-Agent Collaboration**: Streaming thinking chains, execution records, debug info, context inspection — **visible collaboration**比 "black-box Agent" builds more trust

## 3. Roadmap Overview

```
Phase 1 · Core Loop Hardening (1-2 months)           ← P0 5 items
Phase 2 · Intelligence & Experience (3-4 months)    ← P1 7 items
Phase 3 · Measurement & Ecosystem (5-6 months)      ← P2 / Long-term
```

---

## 4. Phase 1 · Core Loop Hardening (1-2 months, P0 total 5 items)

> Goal: Make "task card collaboration" from "looks like" into "solid hard".
> Milestone name: **"Hardening Task Card Collaboration"**

### 4.1 Task List

| # | Task | Corresponding Problem | Work Effort | Linkage |
|---|------|----------------------|-------------|---------|
| **T1** | **Task card schema finalization + State machine hard constraint** | G, foundation for all problems | S | - |
| **T2** | **A2 Fan-out storm defense** (completion-type禁@ + aggregation window + debounce) | A2, A1 | M | - |
| **T3** | **Task card ↔ git branch strong binding** | D, I, G (Linkage 1) | M | T1 |
| **T4** | **File change event bus + reverse subscription** | E | M | T1, T3 |
| **T5** | **Objective acceptance hook** (verifications field + verifier runner) | G, M (partial) | M | T1 |

### 4.2 Week Schedule Recommendation (8 weeks)

```
Week 1-2 · T1 Task card schema finalization
  - 5 major fields finalized (owner / steps / expected_output / out_of_scope / verifications)
  - State machine transition rules code hard constraint (illegal transitions rejected)
  - Task board UI adapts new schema

Week 2-4 · T2 Fan-out storm defense
  - Group rules add default external-discipline条款 (completion-type reply禁@)
  - Message bus hook intercept violations
  - Task event channel (task_event) independent from dialogue channel
  - Coordinator aggregation window (by expected_returns full or timeout)
  - Message debounce merge

Week 3-5 · T3 Task card ↔ git branch
  - Task card enters in_progress auto creates branch task-card/<id>
  - Agent all write file operations land on that branch
  -每complete一个step auto commit
  - in_review时auto produce diff summary
  - After completion由Coordinator/QA merge to main

Week 5-6 · T4 File change event bus
  - Edit/Write/Bash operations produce file-changed events
  - Task card related_files field reverse index
  - Agents subscribed to related paths receive diff summary

Week 6-8 · T5 Objective acceptance hook
  - verifications field definition (file_contains/command_passes/screenshot_matches)
  - in_progress → in_review transition时auto runs verification
  - evidence落card (diff_hash / test_log_url / screenshot_url)
  - Status transitions without evidence rejected
```

### 4.3 Phase 1 Delivery Criteria

- [ ] Task card schema document finalized, all fields有specifications
- [ ] State machine illegal transitions 100% rejected
- [ ] Completion-type reply fan-out storm in test scenarios不再appears
- [ ] Two engineers simultaneously modifying same file不再lose changes (git branch isolation)
- [ ] A modified file, B before next发言can see diff summary
- [ ] Task card done status必须有evidence

---

## 5. Phase 2 · Intelligence & Experience (3-4 months, P1 total 7 items)

> Goal: From "hard" to "smart" — let team自己会dispatch,会avoid pitfalls,会save money.

### 5.1 Task List

| # | Task | Corresponding Problem | Work Effort | Linkage Group |
|---|------|----------------------|-------------|---------------|
| **T6** | **Role boundary from prompt upgrade to tool whitelist** | F | M | Linkage 3 |
| **T7** | **Risk level + Permission mode** (plan/normal/acceptEdits/bypass) | K | M | Linkage 3 |
| **T8** | **Group rule layering** (self-discipline + external-discipline hooks) | L | M | Linkage 2 |
| **T9** | **Role group @ + Smart fallback routing** | C | M | - |
| **T10** | **Task card heartbeat output + Silent alert** | H | S | - |
| **T11** | **Task card step_progress + Decision log** | I | M | T3已foundation |
| **T12** | **Agent → Model strategy routing** (complexity field) | J | M | T1已foundation |

### 5.2 Linkage Group Implementation

**Linkage Group 2 · "Dialogue State Separation + External-discipline Layer"** (Solves A2 remaining + L)

T8与Phase 1 T2 linkage: T2's "completion-type禁@" is one of default external-discipline rules. T8 makes整个external-discipline layer schematized, configurable, prioritized.

**Linkage Group 3 · "Capability即Permission"** (Solves F + K)

T6 + T7一起做:
- T6给所有agent配 `tools` whitelist
- T7给所有tool打 `risk_level`
- User at group level select permission_mode
- High-risk actions pre-confirmation popup

### 5.3 Phase 2 Delivery Criteria

- [ ] Engineer agent没loaded `code-review` tool就无法review
- [ ] Delete file, git push等high-risk actions有user pre-confirmation
- [ ] Group rules可split self-discipline/external-discipline independent config
- [ ] User casually says "someone look at this" auto routes to suitable agent
- [ ] Task silent N minutes后Coordinator receives alert and self-rescues
- [ ] Interrupt resume后agent can continue from step_progress,不repeat or miss steps
- [ ] Agent by task card complexity auto uses suitable model

---

## 6. Phase 3 · Measurement & Ecosystem (5-6 months, P2 / Long-term)

> Goal: From "personal virtual office" to "personal AI factory" —有data,有accumulation,有ecosystem.

### 6.1 Task List

| # | Task | Corresponding Problem | Work Effort |
|---|------|----------------------|-------------|
| **T13** | Three-tier acceptance (objective → LLM → user sign-off) | M | M |
| **T14** | Regression suite (task card level contract tests) | M | L |
| **T15** | Cost dashboard (by group/agent/task/model aggregation) | J | M |
| **T16** | Quality dashboard (agent delivery pass rate / redo rate / miss rate) | M | L |
| **T17** | Context message tiering + Agent subscription by tier | B | L |
| **T18** | OTLP / Langfuse等trace platform integration | M extension | M |
| **T19** | Skill marketplace operation (rating / recommendation / paid) | Ecosystem | L |
| **T20** | Team template marketplace ("full-stack dev team", "content production team"等out-of-box config) | Ecosystem | M |
| **T21** | Cross-group collaboration (project collection, cross-project dispatch) | Extension | L |

### 6.2 Phase 3 Delivery Criteria

- [ ] User can see "past 30 days each agent's delivery quality curve"
- [ ] User can see "this group this month burned多少tokens, money spent on whom"
- [ ] Task card A after completion produces regression tests, Task card B changes auto runs A's tests
- [ ] User in Skill marketplace can search others' contributed skills and one-click install
- [ ] User starting new project can directly apply "full-stack dev team" template, group+members+rules one-click ready

---

## 7. Priority Decision Matrix

```
                  Impact →
            Small              Large
      ┌──────────────┬──────────────┐
   High │              │  T2 Fan-out defense │
   │    │              │  T3 git branch      │ ← Phase 1 P0
   Urgency │            │  T4 File bus        │
   │    │              │  T5 Objective check │
   │    ├──────────────┼──────────────┤
   ↓    │  T1 schema   │  T6 Tool whitelist  │
        │  T10 heartbeat│  T7 Risk level     │ ← Phase 2 P1
   Low  │  T9 Role group│  T8 Group rule hook │
        │  T11 progress │  T12 Model routing  │
        ├──────────────┼──────────────┤
        │  T18 trace   │  T13 Three-tier acceptance │
        │  T19 skill mr│  T14 Regression suite      │ ← Phase 3 P2
        │  T20 template │  T15 Cost dashboard       │
        │  T21 cross-gr │  T16 Quality dashboard    │
        │              │  T17 Message subscription  │
        └──────────────┴──────────────┘
```

---

## 8. Resources and Risks

### 8.1 Resource Estimate (By solo developer)

| Phase | Duration | Key Dependencies |
|-------|----------|------------------|
| Phase 1 | 8 weeks | Solo full-stack即可 |
| Phase 2 | 16 weeks | May need frontend + backend collaboration |
| Phase 3 | Continuous | Involves ecosystem operation, not纯R&D |

### 8.2 Risks and Mitigation

| Risk | Probability | Impact | Mitigation Strategy |
|------|-------------|--------|---------------------|
| Group chat metaphor不够good, user still wants "one-click delivery" | Medium | High | Provide "auto mode" — user gives requirement, platform auto creates group configures team splits tasks self-runs, group chat as observable layer not interaction layer |
| Multi-Agent cost太high | High | Medium | T12 model routing strategy + default team精简 (3-person minimum) + T15 cost dashboard让user see |
| Competition with single Agent tools | Medium | Medium | Make Claude Code/Cursor等as embeddable Engineer Agent,不正面competition而是吸纳 (v0.1.0 "Local Agent"已started) |
| User won't write group rules / task cards | High | Medium | Prompt optimization (已exists) + default templates + AI assists splitting tasks (Coordinator core capability) |
| Task card mechanism too heavy, over-design for small tasks | Medium | Medium | Distinguish "quick mode" (quick-chat已exists) and "project mode" (task cards只在project mode enabled) |
| Git branch strategy不applicable to non-code projects | Medium | Low | Only enable for有 `.git` work directories, pure text/doc projects use file snapshot替代 |
| External-discipline rule config complex scares users | Medium | Medium | Default apply reasonable presets, advanced users可customize |
| Objective acceptance depends on user writing good verifications | High | Medium | Coordinator auto derives verifications from expected_output, user可modify不必write from zero |

### 8.3 Phase 1 is the Real "Life-or-Death Line"

Phase 1's 5 P0 items are **必须做** —不做的话:
- A2 Fan-out storm will持续burn user's wallet, retention崩溃
- D File conflicts will make multi-Agent collaboration "reverse accelerator"
- E/G Make "task card done" become lie, user fooled once不再trust
- T1 schema is foundation for all subsequent改造

Phase 2/3可以根据user feedback灵活adjust order, but **Phase 1必须按plan complete**.

---

## 9. Connection with Existing Features Diagram

```
v0.1.0 Current  ──→  Phase 1 Hardening  ──→  Phase 2 Intelligence  ──→  Phase 3 Measurement & Ecosystem

Model Management ✅   ──────────────────→ Model Strategy Routing (T12) ────→ Cost Dashboard (T15)

Agent Management ✅   ──────────────────→ Tool Whitelist (T6) ──→ Quality Dashboard (T16)

Skill Marketplace ✅   ────────────────────────────────────────→ Skill Marketization (T19)

Group Chat Basics ✅  ──→ Fan-out Defense (T2) ──→ Group Rule Hooks (T8) ──→ Template Marketplace (T20)
                                      Role Group @ (T9)

Task Board ✅  ──→ Schema (T1) ──→ step_progress (T11) ──→ Regression Suite (T14)
              Git Branch (T3)      Heartbeat (T10)
              Objective Acceptance (T5)

Work Directory ✅  ──→ File Event (T4) ──→ Risk Level (T7)
                                     Permission Mode (T7)

Group-level Cron ✅                                              (Unique feature,无需change)

Upcoming                            Message Tiering Subscription (T17) ←─ Long-term evolution
                                                       ←─ Trace Integration (T18)
                                                       ←─ Cross-group Collaboration (T21)
```

---

## 10. Decision Records (DR)

> Record key tradeoffs during roadmap制定,将来review时know why这么decided.

### DR-001 · Why Phase 1 chose这 5 items而不是others?

Candidate P0: A1 / A2 / D / E / G / T1 / Others.

**Final selection T1 + T2 + T3 + T4 + T5**:
- T1 is foundation, all subsequent need it
- T2 solves user emphasized fan-out storm
- T3 + T4 + T5 is **Linkage 1**, one fish multiple eats同时solves D/E/G/I four problems
- A1 urgency低 (v0.1.0已has manual mode + group rules缓解),归to T2顺手do
- F/K pushed to Phase 2 (Role boundary severity低于fan-out storm和file conflict)

### DR-002 · Why T6和T7一起do?

T6 (Tool whitelist)和T7 (Risk level) share same "action tagging + platform interception layer" infrastructure. Separate做会do两次类似things.

### DR-003 · Why一开始就do M (Evaluation blind spot)?

M is **long-term investment** — regression suite, quality dashboard, trace platform都需要data accumulation. Phase 1/2 done accumulated execution data后do M才effective, otherwise dashboard里全是empty data.

### DR-004 · Why B (Context explosion) put Phase 3?

B's current experience不是most painful — v0.1.0有 `injectGroupHistory`和"Clear Context" two tools user可manually control. Complete solution needs message tiering + agent subscription, large work effort且depends on previous phases' task card schema stable.

### DR-005 · Why不做IDE plugin?

走出IDE is product positioning core — we want "virtual office" covering editor之外 (research, docs, task management). If做plugin就locked into editor,同质化with Cursor.

---

For detailed glossary和schema definitions see [07-appendix_EN.md](07-appendix_EN.md).