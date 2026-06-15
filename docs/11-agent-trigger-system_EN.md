# Agent Trigger System Specification

[English](11-agent-trigger-system_EN.md) | [中文](11-agent-trigger-system.md)

This document describes the current agent trigger rules, chatroom modes, and prompt-design guidance in TeamAgentX, for reference when creating agents and group rules.

> Important change (2026-06): the former "free collaboration (auto)" and "coordinator" modes have been merged into a single **"Smart Collaboration"** mode. Only two modes are exposed: **Smart Collaboration + Manual**. To minimize migration surface, the storage layer keeps `coordinator` as the value for Smart Collaboration, with `auto` retained as a legacy alias (behaves identically). Product copy uses "Smart Collaboration" everywhere. See the merge design in [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md).

---

## 1. Core Concepts

### 1.1 What triggering means

When a message enters a chatroom, the system first parses any triggerable `@agent-name` in the content, then decides who enters the task queue based on the chatroom mode and the collaboration budget.

- An explicit user `@` is a strong intent and triggers directly (in Smart Collaboration, multiple `@`s can trigger in parallel)
- In a quick-chat room, a user message with no `@` to other agents directly triggers `quickChatAgentId`
- Smart Collaboration follows "fast path first + coordinator fallback": normal handoffs happen by an agent writing `@next-agent` in its reply; the built-in `Group Coordinator` is only invoked at exception / join / fallback points
- In Manual mode, `@` inside an agent message is display-only and triggers nothing

### 1.2 Message types

| Type | Meaning |
|------|---------|
| Human message | Sent by a user in the chat box, `isHuman = true` |
| Agent message | Written into the room by the system after an agent generates it, `isHuman = false` |

---

## 2. Chatroom trigger modes (agentTriggerMode)

There are now only two user-facing modes, controlling **how user and agent messages flow**.

### 2.1 Smart Collaboration (default)

```
agentTriggerMode = 'coordinator'   # stored value; 'auto' is a legacy alias with identical behavior
```

Default mode for new regular chatrooms. The design goal is **"auto's fast path + coordinator's full capability"**:

- **Fast path (zero coordination cost)**: when an agent writes exactly one valid `@agent` in its reply, that agent is triggered directly for the handoff, bypassing the coordinator
- **Coordinator fallback**: the built-in `Group Coordinator` is only invoked at 5 intervention points — user-message routing miss / agent `@` anomaly / parallel-batch join / stall fallback / circuit-breaker escalation (see §6)
- **Parallel dispatch**: when a user `@`s multiple agents at once, or the coordinator decides work can run in parallel, a parallel batch (fork-join) is opened
- **Convergence guarantee**: the shape of the execution graph is locked by three layers — "agent out-degree ≤ 1", "every fork must join", and "triple circuit breaker (hops / cycle / concurrency)" — preventing fan-out storms and infinite loops (see §5)

Suitable for the vast majority of multi-role collaboration rooms: low latency for fixed handoffs, plus the ability to auto-decide who's next.

### 2.2 Manual mode

```
agentTriggerMode = 'manual'
```

Triggerable `@xxx` inside agent messages triggers **nothing** — it's display-only text. Only user messages can trigger agents. Suitable for single-agent conversations, fully user-driven dispatch, or scenarios where agents should not relay to each other. Manual mode does not inject the handoff protocol into prompts.

---

## 3. Full trigger rule tables

Rules are evaluated from highest to lowest priority.

### 3.1 User messages

| # | Content | Room type / mode | Result |
|---|---------|------------------|--------|
| 1 | No `@` | Quick-chat room | Trigger the quick-chat agent (skip history injection) |
| 2 | One triggerable `@xxx` | Quick-chat room | Trigger the `@`-ed agent (quick-chat agent not triggered) |
| 3 | One triggerable `@xxx` | Regular room, any mode | Trigger the `@`-ed agent |
| 4 | Multiple triggerable `@`s | Smart Collaboration | **Parallel-trigger** all `@`-ed agents, open a parallel batch; if over the concurrency cap, truncate and post a visible message stating which were triggered / truncated |
| 5 | Multiple triggerable `@`s | Manual / quick-chat | Trigger only the first valid `@` |
| 6 | No `@`, manual reply to an agent message | Regular room | Trigger the agent of the replied-to message |
| 7 | No `@`, previous message was an agent `@`-ing this user | Smart Collaboration | Direct reply: trigger that agent |
| 8 | No `@`, a default agent is set | Regular room | Trigger the default agent (Smart Collaboration **keeps** the default agent) |
| 9 | No `@`, none of the above match | Smart Collaboration | Hand to the coordinator (intervention point ①) |
| 10 | No `@`, no default agent | Manual | No response |
| 11 | User speaks at any time | Smart Collaboration | Abort any in-flight watchdog dispatch; reset hop / rescue counters |

> Routing priority when the user has no `@`: **manual reply > direct reply > default agent > coordinator fallback**.

### 3.2 Agent messages (not in a parallel batch)

| # | Content | Mode | Result |
|---|---------|------|--------|
| 12 | Exactly one valid `@` | Smart Collaboration | Fast-path direct trigger, hops +1 |
| 13 | Exactly one `@` but target invalid (typo / not in room / disabled) | Smart Collaboration | Coordinator (point ②: fix or ask_owner) |
| 14 | ≥2 triggerable `@`s | Smart Collaboration | Coordinator (point ②): true parallel → open batch; single real handoff → dispatch one; unclear → ask_owner |
| 15 | Ends with no `@` | Smart Collaboration | Not processed immediately; only arm the stall watchdog |
| 16 | `@` the user (question / awaiting confirmation) | Smart Collaboration | No agent triggered; await user reply (rule 7); watchdog skips |
| 17 | `@` self | Any | Ignored (selfMention skipped) |
| 18 | `@` inside code / quote block | Any | Not a triggerable mention (`parseKnownMentions` excludes it) |
| 19 | Any content | Manual | No response, `@` is display-only |

### 3.3 During a parallel batch

| # | Scenario | Handling |
|---|----------|----------|
| 20 | Member finishes with a single valid `@` (incl. `@`-ing another batch member) | Not triggered; mark complete; handoff intent **suspended** to the join point |
| 21 | Member message `@`s multiple agents | Also suspended; adjudicated together at join |
| 22 | Member `@`s the user | Message is immediately visible, not a handoff; batch keeps waiting for the rest |
| 23 | User speaks during the batch (any form) | **User intervention takes over**: the batch only finishes its completion count; at join nothing is auto-dispatched; subsequent progress is driven by user-message routing |
| 24 | Last member finishes (join) | Coordinator join adjudication (point ③): independent → new batch; dependent → serialize/merge; unclear → ask_owner |
| 25 | Independent chain outside the batch (user `@`s an unrelated agent) | Unaffected, runs the fast path independently (batches track by member agentId, not the whole room) |

---

## 4. `@` parsing rules

When an agent writes `@target-agent-name` in its reply to hand off, the system parses valid mentions first, then decides whether to trigger based on the room mode.

```
# Moderator prompt example
After announcing the topic, write "@Debater-Pro-1 please open with your argument"
```

**Parsing rules**:
- `@` at line start, or preceded by a space, triggers
- `@` directly after punctuation or text does not trigger
- The agent name must be followed by a space, line end, or punctuation (`!?.,:;！？。，；：`)
- The same agent `@`-ed multiple times in one message triggers only once
- `@` inside code blocks / inline code / quote blocks is not a triggerable mention
- Longest name matches first (so "Debater-1" doesn't mis-match inside "Pro-Debater-1")

**Mode differences**:
- **Smart Collaboration**: a business agent's **exactly one valid `@`** takes the fast path; if the `@` count ≠ 1 or the target is invalid, it escalates to the coordinator (no more silent truncation)
- **Manual**: a business agent's valid `@` triggers nothing
- **Coordinator-sourced**: a `@` emitted by the built-in `Group Coordinator` itself (source `GROUP_COORDINATOR_ID`) is enqueued directly and not routed back into the coordinator (anti-recursion)

---

## 5. Collaboration budget & convergence (anti fan-out / anti loop)

In Smart Collaboration, the execution-graph shape is locked by three layers, guaranteeing a deterministic upper bound on the total work in any one collaboration round. The counting window is always "between two human messages"; a human message resets all counters.

**Structural layer**: business-agent out-degree ≤ 1 — a single agent message triggers at most one `@` directly; a fork (multiple `@`s) must be legitimized by the coordinator as a parallel batch.

**Batch layer**: fork-join semantics — dispatching N agents in parallel opens a batch; while the batch is running, any `@` in member messages is suspended (not triggered); when the last member finishes, the join adjudicates once, guaranteeing every fork converges.

**Budget layer**: triple circuit breaker (all are config env vars):

| Breaker | Default | Env var | On trip |
|---------|---------|---------|---------|
| Hop budget (auto-triggered tasks carry a depth count, +1 on dispatch) | 20 hops | `AGENT_MAX_HANDOFF_HOPS` | Don't trigger the next hop; ask_owner with the sticking point |
| Cycle detection (the same pair A↔B ping-ponging **consecutively**, no third party / user) | 3 round-trips (6 hops) | `AGENT_HANDOFF_CYCLE_REPEAT_LIMIT` | Truncate, ask_owner |
| Concurrency cap (agents triggered at once in one dispatch) | 3 | `AGENT_MAX_PARALLEL_DISPATCH` | Hard-truncate coordinator dispatch; truncate user multi-`@` with a visible notice |

> After a circuit-breaker escalation, only `ask_owner` is allowed (`@` the room owner as the coordinator, stating the sticking point) — a deterministic notification, no LLM, no coordinator continuation. Cycle detection is "consecutive ping-pong", not cumulative repeats within a window — hub-and-spoke collaboration (e.g. a game host `@`-ing players one by one) legitimately repeats the same edge across phases and should not be falsely killed.

There is also a "stall detection" fallback (stall watchdog): when an agent finishes a message, the room has no running/queued task, and there's no new activity for `AGENT_STALL_WATCHDOG_DELAY_MS` (default 180s), the coordinator is woken to judge whether the task really finished (point ④), bounded by the consecutive-rescue cap `AGENT_STALL_WATCHDOG_MAX_CONSECUTIVE` (default 5).

---

## 6. Coordinator intervention points (only 5)

In Smart Collaboration, the built-in `Group Coordinator` is narrowed from "a dispatch bus every hop must pass through" to "routing fallback + join adjudication + exception arbitration". On the normal path it is silent.

| # | Point | Trigger | Coordinator responsibility |
|---|-------|---------|----------------------------|
| ① | User-message routing miss | User has no `@`, and reply / direct-reply / default-agent all miss | Decide who to dispatch (dispatch / ask_owner / no_dispatch) |
| ② | Agent `@` anomaly | `@` target invalid, or one message has ≥2 triggerable `@`s | Infer real intent: corrected dispatch / open parallel batch / ask_owner |
| ③ | Parallel-batch join | All batch members finished | Take all outputs + suspended handoff intents and adjudicate once |
| ④ | Stall watchdog rescue | Room idle timeout, no running/queued task, last message is a business agent's and didn't `@` the user | Really done → no_dispatch (silent); chain broken → `@` agent to continue |
| ⑤ | Circuit-breaker escalation | Hop budget exceeded or cycle detected | ask_owner only (deterministic, no LLM, no continuation) |

Every coordinator decision is written to `CoordinatorLog` (decision type, target agents, forward-verbatim flag, reason, source, etc.), viewable in the front-end "Dispatch Log". Intervention frequency drops from O(per hop) in the old coordinator mode to O(exceptions + join points).

---

## 7. Default agent

Each regular room can set one default agent (`defaultAgentId`). When a user message contains no triggerable `@` and matches neither a manual reply nor a direct reply, the default agent is triggered automatically.

- The default agent must be a member of the room
- Quick-chat rooms don't use this; they use `quickChatAgentId`
- **Smart Collaboration keeps the default agent** (unlike the old coordinator mode, it no longer clears `defaultAgentId`): the default agent takes priority, and the coordinator only steps in when it misses

---

## 8. History context injection

When an agent is triggered, the system usually injects room history into context (unless `injectGroupHistory = false`):

| Setting | Default | Meaning |
|---------|---------|---------|
| `AGENT_HISTORY_THRESHOLD` | 20 | Above this count, trigger summary compaction |
| `AGENT_MEMORY_RECENT_MESSAGES` | 10 | Keep the latest N messages injected verbatim |
| `AGENT_MEMORY_COMPACT_MESSAGES` | 40 | Upper bound of messages that trigger summarization |

Notes:
- When a quick-chat room triggers `quickChatAgentId`, the current implementation skips history injection
- Business agents in regular rooms still inject history per the `injectGroupHistory` setting

**Important effect**: an agent can see who sent the triggering message and its content. This sometimes makes the LLM naturally start its reply with `@sender`; that's model behavior, not a system-added prefix.

---

## 9. Scheduled (Cron) triggering

A chatroom can have Cron tasks. At the scheduled time, the system posts a system message that "looks like a user message" into the room, then processes it by the normal user-message rules.

If the task selects multiple `agentIds` or `["*"]`, the scheduler sends multiple messages in a loop: each message auto-adds exactly one `@agent-name`, triggering targets one by one.

If the Cron task specifies no `agentIds`, subsequent behavior matches a normal user message:
- Quick-chat room: trigger the quick-chat agent
- Smart Collaboration room: route as a user message (default agent / coordinator fallback)
- Manual room: trigger the default agent (if set)

Supported schedule types:
- `cron`: standard cron expression (`0 9 * * *` = 9am daily)
- `interval`: fixed minute interval
- `once`: fire once at a given time

---

## 10. Dispatch rules (dispatchRules, workflows)

In Smart Collaboration, a room can configure **dispatch rules** (`ChatRoom.dispatchRules`, YAML) to constrain how the coordinator orchestrates multi-agent collaboration — i.e. express "what process this room runs" as a structured workflow.

- Generated by the group assistant's `generate_dispatch_rules` tool: optimized against instructions when given, or auto-generated from the room's agent roster otherwise
- Validated structurally (zod) on save; invalid formats are rejected
- The rules are injected as YAML into the coordinator's system prompt to adjudicate "who's next"; business agents get a "task flow / handoff (next)" hint injected into their query per step
- With no rules, nothing is injected and it falls back to free coordinator adjudication
- Front-end "Dispatch Rules" dialog: read-only flowchart + YAML source editing + save validation + multi-workflow tabs

---

## 11. Prompt-design guidance

### 11.1 Relay/process mode (debate / contest / multi-role)

**Room config**: use Smart Collaboration (default). Fixed relay chains advance by agents writing `@next-agent` in their replies; when you need the system to auto-decide who's next, configure dispatch rules or rely on the coordinator fallback.

**Core principle**:
> In Smart Collaboration, each intermediate-node agent's reply should contain exactly one `@next-agent`, otherwise that node's relay stalls until the stall watchdog steps in or the user intervenes.

**Two reliable strategies (pick one)**:

**Strategy A: explicit rules (most reliable)**

Append to each intermediate-node agent's prompt:
```
When you finish, write @Host-Agent on its own line at the very end to hand control back.
Don't @ the host at the start; address them in plain text. @ appears only once, at the end.
```

**Strategy B: rely on LLM natural behavior (not recommended alone)**

With the triggering party's name in history context, the LLM often naturally starts with `@trigger`. But this is unreliable and shouldn't be the only trigger mechanism.

**Recommendation**: use Strategy A (explicit rules) for stable relays.

### 11.2 Host agent (moderator / referee / director) design

```markdown
## Flow control rules
- Schedule only one agent for the current phase; don't pre-schedule the next round
- When scheduling, write "@AgentName please [action]" with nothing extra
- Wait until the named agent speaks (the system re-triggers you), then schedule the next
```

### 11.3 Executor agent (debater / contestant / actor) design

```markdown
## Flow notification rules
- After you finish, write @Host-Agent on its own line at the very end
- Don't @ the host at the start; address them in plain text
- @ appears only once in the whole message (at the end)
```

### 11.4 Group-rules guidance

Group rules define **role behavior constraints**, not the trigger mechanism. Don't write "wait to be named before speaking" in group rules to control triggering — triggering is decided by the system, not self-policed by agents. Multi-agent orchestration order belongs in **dispatch rules** (§10) or each agent's prompt, not in group rules.

| Good for group rules | Not for group rules |
|----------------------|---------------------|
| Output format requirements | Trigger conditions (system's job) |
| Role positioning | Waiting mechanics (system's job) |
| Contest/event business rules | Ordering (dispatch rules / prompts) |
| Language/style requirements | Who-to-`@` rules (dispatch rules / prompts) |

---

## 12. FAQ

### Q: The flow stalled and an agent stopped responding?

First check the room mode:

- **Smart Collaboration**: check whether some node's reply contains exactly one triggerable `@next-agent`. Omitting it stalls the fast path until the stall watchdog (default 180s) steps in or the user intervenes; if a hop/cycle breaker tripped, the coordinator notifies the owner via `ask_owner`
- **Manual**: agents never auto-relay; the user must `@` each agent manually

### Q: An agent got triggered twice?

The same triggerable `@agent-name` appearing multiple times in one message triggers only once. But writing `@` at both start and end causes a **display duplicate** — make the prompt say "the triggerable `@` appears only once; address by plain text at the start".

### Q: In Smart Collaboration, why didn't an agent's `@another-agent` trigger directly?

Check whether it's "exactly one valid `@`": a misspelled target, not in the room, disabled, or ≥2 `@`s in one message all escalate from the fast path to the coordinator, which decides corrected dispatch / parallel / ask-owner instead of relaying directly.

### Q: What happens when a user `@`s multiple agents at once?

In Smart Collaboration all `@`-ed agents are **triggered in parallel** and a batch opens; over the concurrency cap (default 3), the rest are truncated with a visible message listing who was triggered / truncated (`@` the truncated ones separately after the current task). Manual mode and quick-chat rooms trigger only the first valid `@`.

### Q: How are agent-to-agent `@` loops prevented?

Smart Collaboration has a built-in triple breaker (20 hops / 3 consecutive round-trips / concurrency 3) plus the stall fallback; on a trip it stops auto-dispatch and `@`s the owner. Any user message immediately resets the counters and takes over.
