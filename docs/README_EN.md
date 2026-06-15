# TeamAgentX · Main Documentation

English | [中文](README.md)

> AI Team Development Platform · Complete Design and Analysis Documentation
> Version v3.1 · Split Edition (updated 2026-06-15)
> Corresponding Product: TeamAgentX v0.1.x (based on the current monorepo source)

## What This Documentation Covers

This documentation thoroughly explains **TeamAgentX** (a group-chat collaboration platform that enables a single developer to orchestrate multiple AI assistants) from five perspectives: "what it is", "how it works", "pitfalls encountered", "competitor comparison", and "future roadmap".

Serving three types of readers:

- **Design document readers** (development team): architecture, schemas, state machines, interfaces
- **External presentation readers** (investors, potential users): positioning, metaphors, differentiation
- **Deep thinking readers** (product owners): problem diagnosis, solution paths, decision records

## Reading Paths

### 🆕 First Time Users
Recommended order: **12 → 01 → 02 → 03**
- Start with [12 User Guide](12-user-guide_EN.md) to follow setup steps
- Then read [01 Product Overview](01-overview_EN.md) to understand positioning
- Then read [02 Feature List](02-features_EN.md) for existing capabilities
- Finally read [03 Workflows](03-workflows_EN.md) to understand collaboration mechanisms

### 🔧 Evaluating Technical Solutions / Deciding Next Steps
Recommended order: **04 → 06 → 07**
- Start with [04 Problems and Solutions](04-problems-and-solutions_EN.md) **Core Chapter** — 13 problem points + recommended solutions
- Then read [06 Roadmap](06-roadmap_EN.md) for implementation schedule
- When details needed, check schemas in [07 Appendix](07-appendix_EN.md)

### 🎯 External Presentation / Investor Perspective
Recommended order: **01 → 05 → 06**
- [01 Product Overview](01-overview_EN.md) — One-line definition + metaphor + standard team configuration
- [05 Competitor Analysis](05-competitors_EN.md) — 5 tracks, cross-comparison, pitfalls to avoid
- [06 Roadmap](06-roadmap_EN.md) — Three phases, moats, risks

### 🤔 Deep Thinking on Specific Problems
Jump directly to [04 Problems and Solutions](04-problems-and-solutions_EN.md), each problem follows a 6-section format: Symptom / Root Cause / Current Handling / **Recommended Solution** / Priority / Work Effort.

## Document List

| Document | Content | Importance | Word Count |
|----------|---------|------------|------------|
| [README.md](README.md) | Index + Reading Paths | - | ~1k |
| [01-overview.md](01-overview_EN.md) | Product positioning + Core architecture | ⭐⭐⭐ | ~3k |
| [02-features.md](02-features_EN.md) | v0.1.x detailed feature classification (12 domains, including Smart Collaboration, Workbench, Bridge, and speech) | ⭐⭐⭐ | ~9k |
| [03-workflows.md](03-workflows_EN.md) | Workflows + State machines + Message flow | ⭐⭐ | ~4k |
| [04-problems-and-solutions.md](04-problems-and-solutions_EN.md) | **13 major problems + solutions** (Core Chapter) | ⭐⭐⭐⭐ | ~13k |
| [05-competitors.md](05-competitors_EN.md) | 5-track competitors + Cross-comparison + Learnings | ⭐⭐⭐ | ~7k |
| [06-roadmap.md](06-roadmap_EN.md) | Three-phase roadmap + Risk management | ⭐⭐⭐ | ~5k |
| [07-appendix.md](07-appendix_EN.md) | Glossary + Schemas + API quick reference + Known minor issues | ⭐⭐ | ~6k |
| [08-server-architecture.md](08-server-architecture_EN.md) | Server code architecture · Agent execution system · Socket events | ⭐⭐⭐ | ~4k |
| [09-api-reference.md](09-api-reference_EN.md) | Complete REST API quick reference (main gateway routes) | ⭐⭐⭐ | ~5k |
| [10-frontend-architecture.md](10-frontend-architecture_EN.md) | Frontend directory · Stores · Panel system · Electron integration | ⭐⭐ | ~3k |
| [11-agent-trigger-system.md](11-agent-trigger-system_EN.md) | Agent trigger system · **Smart Collaboration + Manual** modes · collaboration budget/breakers · @ parsing · Prompt suggestions | ⭐⭐⭐⭐ | ~4k |
| [12-user-guide.md](12-user-guide_EN.md) | Beginner user guide · Initialization · Models/Agents/Skills · Group collaboration | ⭐⭐⭐ | ~7k |
| [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md) | Smart Collaboration merge design (shipped) · coordinator intervention points · convergence | ⭐⭐⭐ | ~5k |
| [14-agent-dispatch-flowcharts_EN.md](14-agent-dispatch-flowcharts_EN.md) | **Full dispatch-system flowcharts** (Mermaid) · authoritative current behavior · parallel/serial/fallback | ⭐⭐⭐⭐ | ~5k |

> Major 2026-06 update: `auto`/`coordinator` merged into **Smart Collaboration**; added **dispatch rules (workflows)**, **workbench today-tasks**, **dispatch log**, group commands/env vars, quick-chat import of local Claude/Codex sessions, etc. See 02 / 08 / 11 / 13.

## Quick Overview Diagram

```
┌─────────────────────────────────────────────────────────────┐
│           TeamAgentX Main Documentation Structure            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   12 User Guide       ← Beginner initialization / config / group collaboration │
│        │                                                    │
│   01 Product Overview ← Positioning / Metaphor / Team config / Architecture │
│        │                                                    │
│        ├── 02 Feature List     ← v0.1.x 12-domain source review            │
│        ├── 03 Workflows        ← Lifecycle / State machines / Message flow │
│        │                                                    │
│        ▼                                                    │
│   04 Problems & Solutions ⭐Core Chapter⭐                    │
│        │                                                    │
│        ├── Theme 1: Flow Control (A1 A2 C H K)              │
│        ├── Theme 2: Context & State (B E G I)               │
│        ├── Theme 3: Boundaries & Conflicts (D F L)          │
│        └── Theme 4: Quality & Cost (J M)                    │
│                                                             │
│   05 Competitor Analysis   ← 5 tracks / Cross-comparison / Learnings / Pitfalls │
│        │                                                    │
│        ▼                                                    │
│   06 Roadmap     ← Phase 1 hardening / Phase 2 intelligence / Phase 3 metrics │
│                                                             │
│   07 Appendix    ← Glossary / schemas / API / Minor issues   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Key Conclusions Quick Reference

### 1. Product Positioning
**Enabling a single developer to have "an AI team they can orchestrate"** — this is the fundamental difference from Cursor (one super employee), Devin (black-box autonomous agent), and CrewAI (code-defined workflows).

### 2. Three Major Moats
1. **Group Chat Metaphor** — Zero learning cost (everyone knows how to use groups)
2. **Task Cards + Group-as-Project** — Transforming chaotic chat into productive collaboration with file/task/memory three-layer isolation
3. **Observable Multi-Agent Collaboration** — Streaming thinking + execution records + context inspection

### 3. v0.1.x Delivered (Far Beyond Initial User Description)
12 major feature domains, ~90+ API endpoints, several unique highlights:
- ⭐ **Smart Collaboration mode** (merged auto/coordinator): fast-path relay + 5-point coordinator fallback + two collaboration-budget breakers + parallel/serial dispatch (2026-06)
- ⭐ **Dispatch rules (workflow YAML) + flowchart visualization** (2026-06)
- ⭐ **Workbench "today tasks"**: create and dispatch to a room, coordinator organizes execution (2026-06)
- ⭐ **Dispatch log (CoordinatorLog)**: coordinator decisions are observable (2026-06)
- ⭐ **Group-level Cron Scheduled Tasks** (unique)
- ⭐ **Paste Text One-Click Parse Model Config** (UX highlight)
- ⭐ **Streaming Prompt Optimization**
- ⭐ **Unified "Group Assistant"**: all-in-one for agents/skills/Cron/room info/external platform/dispatch rules
- ⭐ **Skill Symlink Mode** (Claude Code compatible)
- ⭐ **Three-layer workDir Strategy** + **group env vars (envVars)** + **group custom commands `/commands`**
- ⭐ **Per-Agent Per-Group Independent Context / History Injection Toggle**
- ⭐ **Local Agent Reuse** (connect Claude Code key) + **quick-chat import of local Claude/Codex sessions**
- ⭐ **Mobile QR Code Connection**
- ⭐ **Bridge External Platforms** (Telegram / Feishu / DingTalk / WeCom connected to same group chat)
- ⭐ **Thinking Mode (thinkingMode)**: off/low/medium/high controlling Claude reasoning budget
- ⭐ **User preferred language** drives Agent prompt language

See [02-features_EN.md](02-features_EN.md) for details.

### 4. 13 Major Problem Points
Organized into 4 themes, sorted by priority:

| Priority | Count | Problems |
|----------|-------|----------|
| 🔴 P0 | 5 | A1 Loop prevention, **A2 Fan-out Storm**, D File conflicts, E Info sync, G State drift |
| 🟡 P1 | 7 | B Context explosion, C @ ambiguity, F Role boundary crossing, H Deadlock, I Interrupt recovery, J Model mismatch, K Human intervention, L Group rules |
| 🟢 P2 | 1 | M Evaluation blind spot |

Complete solutions in [04-problems-and-solutions_EN.md](04-problems-and-solutions_EN.md).

### 5. Next Key Milestone: Hardening Task Cards and File Collaboration

5 P0 tasks linked together (**Linkage 1**), solving 4 problems simultaneously:

```
T1 Task Card Schema Finalization → Foundation for all changes
T2 Fan-out Storm Defense        → A1/A2 now have Smart Collaboration fallback; continue with task-event aggregation
T3 Task Card ↔ Git Branch       ┐
T4 File Change Event Bus        ├ Linkage 1: Solves D / E / G / I four problems
T5 Objective Acceptance Hooks   ┘
```

See [06-roadmap_EN.md](06-roadmap_EN.md) for details.

### 6. Pitfalls Not to Follow
- Fully autonomous "super employee" (Devin route) — Bet on observable multi-agent collaboration
- Drag-and-drop DAG (Dify/Coze route) — Bet on conversational dynamic orchestration
- Code-defined workflows (CrewAI/LangGraph route) — Bet on GUI configuration
- Locking into editor (Cursor/Copilot route) — Go beyond IDE to create "virtual office"

See Section 5 in [05-competitors_EN.md](05-competitors_EN.md) for details.

## Version History

| Version | Date | File | Status |
|---------|------|------|--------|
| v1 | 2026-05-09 | `ai-team-platform-design.md` | Brainstorm draft, **kept as archive** |
| v2 | 2026-05-09 | `ai-team-platform-master.md` | Monolithic master doc, **replaced by v3 split edition** |
| **v3** | **2026-05-09** | **This set of `README + 01-07.md`** | Split-edition main documentation |
| **v3.1** | **2026-06-15** | **All `docs/` documents** | **Current main documentation; adds 08-13, Smart Collaboration, Workbench, dispatch log, and API updates** |

Future maintenance is based on the v3.1 split edition. v1/v2 are kept only as historical archives.

## Maintenance Conventions

- **Chapter Boundaries**: Each sub-document focuses on one dimension, no overlap, no cross-referencing redundancy
- **Cross References**: Use relative path links (e.g., `[04 Problems and Solutions](04-problems-and-solutions_EN.md)`)
- **Status Markers**: ✅ Implemented / 🟡 Implemented but needs refinement / 🔵 Concept exists but not fully landed / 🔴 Not implemented
- **Priority**: 🔴 High (P0) / 🟡 Medium (P1) / 🟢 Low (P2)
- **Update Triggers**: Backfill new v0.1.x features into 02-features.md / 09-api-reference.md; update 06-roadmap.md when Phase 1/2/3 milestones complete

---

> Feedback & Collaboration: Write improvement suggestions in corresponding sections of each document, or add to [07 Appendix](07-appendix_EN.md) Section D "Known Minor Issues List".
