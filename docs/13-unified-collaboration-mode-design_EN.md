# Chatroom Dispatch Mode Merge Design: Free Collaboration + Coordinator → "Smart Collaboration"

> Status: **Shipped** (2026-06; this doc is kept as the design rationale)
> Date: proposed 2026-06-12 · landed 2026-06
> Related: [11-agent-trigger-system_EN.md](./11-agent-trigger-system_EN.md) (the current trigger system, updated to this design)

## 0. Implementation status (updated 2026-06)

This design has landed; chatroom user-facing modes have converged to **Smart Collaboration + Manual**. Key implementation locations:

- Mode normalization: `server/src/core/agent/agent-handler/trigger-mode.ts` (`auto`/`coordinator` → normalized to `coordinator`, i.e. Smart Collaboration; `manual` unchanged)
- Collaboration budget & triple breaker: `collaboration-budget.ts` (hops `AGENT_MAX_HANDOFF_HOPS`=100 / cycle `AGENT_HANDOFF_CYCLE_REPEAT_LIMIT`=3 / concurrency `AGENT_MAX_PARALLEL_DISPATCH`=3, see `config/index.ts`)
- Parallel-batch fork-join: `parallel-batch-tracker.ts` (incl. user intervention during a batch, `markBatchUserIntervention`)
- Stall fallback: `stall-watchdog.ts`; coordinator dispatch: `coordinator-dispatch.ts`, `internal-coordinator-agent.ts`
- Unified message-flow entry: `agent-handler/handler.ts` (the 5 coordinator intervention points); handoff-protocol system prompt: `agent-system-prompt.ts`
- Decision audit: `CoordinatorLog` table + front-end "Dispatch Log" panel
- Storage compatibility: `agentTriggerMode` still stores `coordinator`/`manual`; `auto` is a legacy alias equal to Smart Collaboration; template import maps accordingly

**Divergences from this proposal** (the implementation evolved further; the code and [14-agent-dispatch-flowcharts_EN.md](14-agent-dispatch-flowcharts_EN.md) are authoritative):
- Coordinator multi-agent dispatch added a **serial chain** (`serial-chain-tracker` + `task-lifecycle`, `dispatchMode: parallel | serial`) alongside the parallel batch; §2.2's "batch layer" below only describes the parallel batch.
- **The concurrency cap (originally §2.2's `AGENT_MAX_PARALLEL_DISPATCH=3`) was removed**: user multi-`@` is no longer truncated by a cap but handed to the coordinator to split into single/parallel/serial; the collaboration budget thus converges to **two breakers (hops + cycle)** and only constrains the "agent single-`@` direct relay" fast path — coordinator-initiated parallel/serial tasks are not counted.

The "design" sections below are essentially consistent with the current state; where wording (e.g. "not implemented" markers, the concurrency cap, parallel-batch-only) differs, this section and doc 14 are authoritative.

---

## 1. Background & Motivation

Chatrooms used to have three agent trigger modes (`ChatRoom.agentTriggerMode`):

- `auto` (free collaboration): agents relay via `@` in replies; on a stall, the stall watchdog delays and wakes the coordinator as a fallback rescue;
- `coordinator`: every agent message (and every no-`@` user message) is adjudicated and dispatched by the built-in Group Coordinator;
- `manual`: only user `@` triggers; `@` inside agent messages is display-only.

`auto` and `coordinator` had become highly convergent in implementation — auto's fallback *is* the coordinator (`stall-watchdog.ts` calls `runCoordinatorDispatch` after a timeout), and coordinator is essentially "moving the fallback forward to every hop". The only real difference left is one knob: **who adjudicates the handoff, and when**.

| Behavior | Free collaboration (auto) | Coordinator | Manual |
|---|---|---|---|
| Explicit user `@` | Direct trigger (truncate to first `@`) | Direct trigger (truncate to first `@`) | Direct trigger |
| User message with no `@` | Default agent / reply target / direct reply | Always coordinator (room creation clears defaultAgentId) | Default agent |
| Agent message with `@` | Directly trigger the `@`-ed agent (relay) | Forward after coordinator adjudication | Display only, no trigger |
| Agent message no `@` | Watchdog idle-timeout fallback | Every message passes the coordinator (usually no_dispatch) | Not processed |
| Parallel dispatch | Not supported | Supported, with parallel-batch tracking | Not supported |
| ask_owner forwarding `@user` questions | Only on watchdog fallback | Yes | No |
| System prompt | Inject "wrap-up handoff protocol" + per-turn handoff reminder | None | None |

Each mode has costs:

- Coordinator mode: a 10-hop chain pays 10+ coordination LLM calls, adding latency per hop, with most calls only outputting "no dispatch needed";
- Auto mode: lacks parallel dispatch, ask_owner, and invalid-`@` correction; silent truncation of multi-`@` (`getTriggerMentionNames`'s `slice(0, 1)`) may trigger the wrong agent.

This design merges the two into a single **"Smart Collaboration"** mode, converging the final set to two: **Smart Collaboration + Manual**.

## 2. Core Design

In one sentence: **auto's fast path + coordinator's full capability. The coordinator narrows from "a dispatch bus every hop must pass through" to "routing fallback + join adjudication + exception arbitration"; on the normal path it is silent.**

### 2.1 Basic rules

1. **Explicit user `@`** → direct trigger. User multi-`@` is a strong intent and isn't re-adjudicated by the coordinator; `@`-ing multiple agents triggers them in parallel and opens a parallel batch. Parallelism is bounded by the concurrency cap; **over the cap, a visible message must clearly state which agents were triggered and which were truncated (no silent truncation)** — the user `@`s truncated ones separately after the current task.
2. **Agent message with exactly one valid `@`** (target exists, active, is a member, not currently in a parallel batch) → fast-path direct trigger, zero coordination cost.
3. **Agent message with `@` count ≠ 1 or invalid target** → coordinator (see §3 point ②).
4. **Agent message with no `@`** → per the handoff protocol, treated as "task done or handed back to user"; not processed immediately, only arm the stall watchdog.
5. **User message with no `@`** → routing priority: manual reply > direct reply > default agent > coordinator. Unlike the old coordinator mode: **the default agent is kept** (room creation no longer force-clears defaultAgentId): default agent first, coordinator as fallback.
6. **System prompt**: Smart Collaboration uniformly injects the "wrap-up handoff protocol" (`collaborationTriggerCheckSection` in `buildAgentBaseSystemPrompt`) and the per-turn handoff reminder (`buildHandoffTurnReminder`). **Manual mode doesn't inject the handoff protocol** — its semantics are "agent `@` doesn't trigger", so injecting "you must hand off via `@`" would conflict; instead inject a manual-mode note: "`@` in agent messages is display-only; don't rely on `@` to trigger others; leave handoff to the user."

### 2.2 Convergence design (anti-divergence / anti-loop)

The execution-graph shape is locked by three layers, guaranteeing a deterministic upper bound on the total work of any round (≈ concurrency cap × hop budget):

**Structural layer: agent out-degree ≤ 1; forks happen only at adjudication points.**

- A business agent message triggers at most one `@` directly (hard limit, following the existing `slice(0, 1)` idea, but multi-`@` is no longer silently truncated — it escalates to the coordinator);
- Parallel dispatch is a privilege of the coordinator and the user; an agent's fork intent (multi-`@`) must be legitimized by the coordinator as a batch.

**Batch layer: fork-join semantics; forks must join.**

- When the coordinator or user dispatches N agents in parallel, a batch opens (reusing `parallel-batch-tracker`);
- **While the batch runs, any `@` in member messages triggers nothing and is only recorded**, suspended to the join;
- When the last member finishes (join), the coordinator takes all outputs + suspended handoff intents and adjudicates the next step once;
- So after every fork the width re-converges at the adjudication point, and the tree won't grow inside the batch.

> Tradeoff note: suspending `@` inside a batch is a deliberate choice of **convergence over collaboration efficiency**, not a perf optimum. If B already `@`s D, it still waits for C before dispatching D — one extra latency in exchange for the hard guarantee that "every fork must re-converge at the join". This latency only occurs in the low-frequency parallel-batch case.

**Budget layer: triple breaker; the counting window is always "between two human messages".**

| Breaker | Default | On trip |
|---|---|---|
| Hop budget: auto-triggered tasks carry a depth count, +1 inherited on dispatch | 100 hops (`AGENT_MAX_HANDOFF_HOPS`). Pathological loops are mainly caught by cycle detection; hops are an absolute safety net only — setting it too low would falsely kill game/long-pipeline hub-and-spoke chains | Don't trigger the next hop; ask_owner with the sticking point |
| Cycle detection: the same pair (A↔B) ping-ponging **consecutively**, no third party / user | 3 round-trips = 6 hops (`AGENT_HANDOFF_CYCLE_REPEAT_LIMIT`) | Truncate, ask_owner |
| Concurrency cap: agents triggered at once in one dispatch | 3 (`AGENT_MAX_PARALLEL_DISPATCH`) | Hard-truncate coordinator dispatch; truncate user multi-`@` with a visible notice |

> After a breaker trips, the decision space is limited to ask_owner: having hit a safety breaker, the coordinator is not allowed to dispatch-continue. The implementation is deterministic (no LLM): as the Group Coordinator, `@` the owner stating the last hop / loop pattern and the sticking point, and let the owner decide whether to continue.

A human message resets all counters (following the `resetStallWatchdog` pattern); a user intervening at any time immediately trips the in-flight auto-dispatch (following the `abortWatchdogDispatch` path). The watchdog's own consecutive-rescue cap (`stallWatchdogMaxConsecutive`) is unchanged.

## 3. Coordinator intervention timing (only 5 points)

| # | Point | Trigger | Coordinator responsibility |
|---|---|---|---|
| ① | User-message routing miss | User has no `@`, and reply / direct reply / default agent all miss | Decide who to dispatch (dispatch / ask_owner / no_dispatch) |
| ② | Agent `@` anomaly | `@` target invalid (typo, not in room, disabled), or one message has ≥2 triggerable `@`s | Infer real intent: corrected dispatch / open parallel batch / ask_owner |
| ③ | Parallel-batch join | All batch members finished | Take all outputs + suspended handoff intents and adjudicate once |
| ④ | Stall watchdog rescue | Room idle timeout, no running/queued task, last message is a business agent's and didn't `@` the user | Really done → no_dispatch (silent); chain broken → `@` agent to continue |
| ⑤ | Circuit-breaker escalation | Hop budget exceeded or cycle detected | ask_owner only (deterministic, no LLM, no continuation) |

Explicit **non-intervention** fast paths: explicit user `@` (single/multi), agent single valid `@` relay, agent no-`@` ending (watchdog fallback only, to avoid regressing to "paying one LLM 'no dispatch' output at every task wrap-up"), agent `@`-user question (await user reply via direct reply, watchdog skips).

Intervention frequency drops from O(per hop) in the old coordinator mode to O(exceptions + join points).

## 4. Full scenario matrix

### 4.1 User messages

| # | Scenario | Handling |
|---|---|---|
| 1 | User `@`s one agent | Direct trigger |
| 2 | User `@`s multiple agents | Parallel trigger, open a batch |
| 3 | No `@`, manual reply to an agent message | Trigger the replied-to message's agent |
| 4 | No `@`, previous message was the agent `@`-ing this user | Direct reply: trigger that agent |
| 5 | No `@`, a default agent is set | Trigger the default agent |
| 6 | No `@`, none of the above | Coordinator (point ①) |
| 7 | User speaks at any time | Abort in-flight watchdog auto-dispatch, reset hop/rescue counters |

### 4.2 Agent messages (not in a batch)

| # | Scenario | Handling |
|---|---|---|
| 8 | Exactly one valid `@` | Fast-path direct trigger, hops +1 |
| 9 | Exactly one `@` but invalid target | Coordinator (point ②, fix or ask_owner) |
| 10 | ≥2 triggerable `@`s | Coordinator (point ②): true parallel → batch; single real handoff → dispatch one; unclear → ask_owner |
| 11 | Ends with no `@` | Not processed now; only arm the watchdog timer |
| 12 | `@` the user (question / await confirmation) | No agent triggered; await user reply (scenario 4); watchdog skips |
| 13 | `@` self | Ignored (selfMention skipped) |
| 14 | `@` inside code/quote block | Not a triggerable mention (following `parseKnownMentions` exclusions) |

### 4.3 During a parallel batch

| # | Scenario | Handling |
|---|---|---|
| 15 | Member done with a single valid `@` (incl. `@` another batch member) | Not triggered, mark complete, handoff intent suspended to join |
| 16 | Multiple members each `@` different agents | All suspended; join adjudicates: independent → new batch; dependent → serialize/merge; unclear → ask_owner |
| 17 | Member message `@`s multiple agents | Also suspended to join, adjudicated together |
| 18 | Member `@`s the user | Message immediately visible, not a handoff; batch keeps waiting for the rest |
| 18a | **User speaks during the batch (any form)** | **User intervention takes over** (explicit principle): the batch only finishes its completion count; at join nothing is auto-dispatched (silenced, incl. suspended intents), to avoid double-dispatch / context contention between join adjudication and the user's new path (direct reply / explicit `@` / fallback). User messages route normally (scenarios 1-6); progress is user-driven; if it stalls, the watchdog backstops |
| 19 | Last member finishes (join) | Coordinator join adjudication (point ③) |
| 20 | Independent chain outside the batch (e.g. user `@`s unrelated agent E) | Unaffected, runs the fast path independently (batches track by member agentId, not the whole room) |

### 4.4 Fallback & breakers

| # | Scenario | Handling |
|---|---|---|
| 21 | Room idle timeout & idle, last message is a business agent's and didn't `@` the user | Watchdog wakes the coordinator (point ④), bounded by the consecutive-rescue cap |
| 22 | Hop budget exceeded or cycle detected | Directly ask_owner (point ⑤): deterministically notify the owner as the Group Coordinator, no LLM, no continuation |
| 23 | Coordinator dispatch count exceeds concurrency cap | Hard-truncate or batch |
| 24 | The coordinator's own multi-`@` dispatch message | Doesn't re-enter the coordinator (anti-recursion); target agents enqueue directly (following the existing `GROUP_COORDINATOR_ID` source check) |

## 5. Implementation notes

### 5.1 Key changes

- **Move parallel-batch counting out of the coordinator branch**: currently `markBatchAgentComplete` is called inside the coordinator-trigger block in `handler.ts` (a comment there explicitly warned that losing batch counts permanently deadlocks the task). After the merge, agents may take the fast path to relay directly, so batch interception must move to the common path **before** the fast path.
- **Suspended intent needs no new storage**: a batch member's message is still persisted and broadcast (visible to the user); "suspended" just means not calling `enqueueAgentTask`; at join the coordinator reads recent messages via the existing `buildCoordinatorLayeredContext`, so handoff intent is naturally in context.
- **Multi-`@` no longer silently truncated**: `getTriggerMentionNames`'s `slice(0, 1)` semantics change to "escalate to the coordinator when triggerable `@` ≠ 1" (coordinator-sourced excepted).
- **Unify workbench status transitions**: currently `task-failure-notification.ts` and `agent-dispatch.service.ts` branch on `manual || coordinator`; coordinator mode advances `waiting_review` via coordinator no_dispatch, auto mode via the processor's finally. After the merge, unify to a "transition when the room is idle" decision (`syncWorkbenchOnRoomIdle` can be the unified entry).
- **Unify system prompts**: `collaborationTriggerCheckSection` and `buildHandoffTurnReminder` no longer condition on `agentTriggerMode === 'auto'`; Smart Collaboration injects them uniformly.
- **Keep the default agent**: remove the coordinator-mode `shouldClearDefaultAgent` logic in `chatroom.service.ts`.
- **User intervention takes over a batch**: `parallel-batch-tracker` records user speech during a batch (`markBatchUserIntervention`); when join returns `last_user_intervened`, silence the wrap-up and don't trigger the coordinator (scenario 18a).
- **Visible truncation notice**: when user multi-`@` exceeds the cap, post a visible notice as the Group Coordinator (UI-only sync broadcast; truncated agent names without `@`, to prevent the notice from re-triggering dispatch).

### 5.2 Data migration & compatibility

- `agentTriggerMode` value migration: keep `coordinator` as the Smart Collaboration storage value and map existing `auto` over via a one-time Prisma data migration (with an alias fallback at the read layer) to minimize migration surface; `manual` unchanged. **Note: `coordinator` is only a storage-compatibility strategy, not product semantics** — UI/API copy and user docs uniformly use "Smart Collaboration" and no longer expose "Coordinator mode", to avoid mixing old/new concepts.
- Compatibility spillover:
  - `template-snapshot.ts` template export type is `'auto' | 'manual' | 'coordinator'`; old template imports need a compatibility mapping;
  - mobile (Flutter) group settings;
  - web create-group modal (`create-group-modal.tsx`), room settings panel (`room-settings-panel.tsx`) options and i18n copy (`triggerModeAuto/Coordinator/Manual` family).
- Follow the project migration rules: schema changes (e.g. new hop-count fields, if persistence is needed) require a paired Prisma migration; ad-hoc ALTER is forbidden.

### 5.3 Risks

| Risk | Note | Mitigation |
|---|---|---|
| Dropping per-hop adjudication | The old coordinator mode reviewed every agent message (preventing wrong-`@`, duplicate triggers); after the merge the single-`@` fast path only checks target validity, not semantics | Before implementing, measure `CoordinatorLog`: the rate at which the coordinator rewrites agent handoff targets. If forwardVerbatim dominates, per-hop adjudication is pure overhead and the merge gain is certain; if correction rate is high, re-evaluate |
| Suspended intent adds latency | B wants to hand off to D but must wait for C and the join | Parallel batches are low-frequency, and a "gather all results" step should exist anyway; accept this cost for convergence |
| Behavior change for existing coordinator rooms | Single `@` changes from "coordinator forwards" to "direct relay" — faster, one less review layer | Same as risk 1, decide via CoordinatorLog data; state the behavior change in release notes |
| Timing of user intervention during a batch | After the user answers a member's `@` question, join adjudication may double-dispatch with the direct reply | Closed by the "user intervention takes over" principle (scenario 18a): after the user speaks, join is silenced, so no double-dispatch path exists |

## 6. Decision points to confirm

1. **CoordinatorLog data validation** (implementation prerequisite): measure the ratio of target-rewriting vs forwardVerbatim in coordinator dispatch decisions, to confirm the real value of per-hop adjudication.
2. ~~Breaker default thresholds~~ (decided): hops 100 / cycle 3 round-trips / concurrency 3, all config env vars. Hops were once set tighter per review feedback, but the "Who Is the Spy game room" example (a hub-and-spoke long chain ≈24 hops per game) showed that was too tight; this round raises it to 100: consecutive ping-pong loops are precisely caught by cycle detection, so the hop budget only serves as an absolute safety net.
   > Cycle detection is "consecutive ping-pong", not cumulative repeats in a window: hub-and-spoke collaboration (a game host `@`-ing each player; players `@`-ing back the host) makes the same edge recur across phases — legitimate progress that cumulative counting would falsely kill (example: a "Who Is the Spy" room, 24+ hops per game, same edge repeated once per phase). Only uninterrupted A↔B ping-pong is a pathological loop.
3. ~~Per-room configurable hop limit~~ (decided): no — keep the global default 100 + env-var tuning, avoiding extra schema and settings; for very long chains, tune `AGENT_MAX_HANDOFF_HOPS`.
4. ~~Decision space of point ⑤~~ (decided): directly ask_owner deterministic notification, no LLM, no dispatch continuation — after a safety breaker trips, the coordinator shouldn't get a continuation decision space.
5. ~~Whether user multi-`@` passes the coordinator~~ (decided): no — user multi-`@` is a strong intent needing no re-adjudication; but over the concurrency cap, notify with a visible message, no silent truncation.
