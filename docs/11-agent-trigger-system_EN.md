# Agent Trigger System Specification

[English](11-agent-trigger-system_EN.md) | [中文](11-agent-trigger-system.md)

This document describes the current trigger rules, chatroom modes, and prompt design recommendations for agents in TeamAgentX, for reference when creating agents and group rules.

---

## 1. Core Concepts

### 1.1 The Essence of Triggering

After each message enters a chatroom, the system first scans the message content for triggerable `@agent-name`, then combines with the chatroom mode to decide who enters the task queue for execution.

- Valid `@agent-name` will directly trigger the corresponding agent
- Quick chat rooms, when user messages don't @ other agents, will directly trigger `quickChatAgentId`
- Regular rooms in coordinator mode, when messages are not directly `@`, will first be handed to the built-in `Group Coordinator Agent`
- Regular rooms in non-coordinator mode, when user doesn't @, may fall through to the default agent

### 1.2 Message Types

| Type | Description |
|------|------|
| Human Message | Message sent by user in the chat box |
| Agent Message | Message written to the chatroom by the system after agent generation, `isHuman = false` |

---

## 2. Chatroom Trigger Modes (agentTriggerMode)

Chatrooms have three trigger modes, which determine **how user messages and agent messages flow**.

### 2.1 coordinator Mode (Default)

```
agentTriggerMode = 'coordinator'
```

This is the default mode for newly created regular chatrooms.

- When user messages don't `@` an agent, instead of directly triggering the default agent, it first triggers the built-in `Group Coordinator Agent`
- Messages from regular agents are also first handed to the `Group Coordinator Agent` to judge whether to continue dispatching
- Only valid `@agent` in user messages, or valid `@agent` issued by the `Group Coordinator Agent`, will directly trigger the target agent
- `@agent` written by regular agents themselves defaults to display text only, not constituting direct dispatch

Suitable for multi-agent collaboration groups where "the system automatically determines who to find next."

### 2.2 auto Mode (Free Collaboration)

```
agentTriggerMode = 'auto'
```

`@xxx` or ` @xxx` in agent messages can directly trigger other agents. This mode is suitable for scenarios like multi-agent debates, fixed relay, explicit workflow orchestration, etc.

### 2.3 manual Mode

```
agentTriggerMode = 'manual'
```

Triggerable `@xxx` in agent messages **do not trigger** any agent, serving only as display text. Only user messages can trigger agents. Suitable for single-agent conversations or scenarios where agents don't need to collaborate with each other.

---

## 3. Complete Trigger Rules Table

The following rules are executed from highest to lowest priority:

| Message Source | Message Content | Room Type / Mode | Trigger Result |
|---------|---------|-------------|---------|
| User | No @ | Quick chat room | Triggers quick chat agent (skips history injection) |
| User | Has one triggerable `@xxx` | Quick chat room | Triggers the @mentioned agent (quick chat agent doesn't trigger) |
| User | No @ | Regular room, `coordinator` mode | Triggers built-in `Group Coordinator Agent` |
| User | No @ | Regular room, `auto/manual` mode, has default agent | Triggers default agent |
| User | No @ | Regular room, `auto/manual` mode, no default agent | No response |
| User | Has one triggerable `@xxx` | Regular room any mode | Triggers the @mentioned agent |
| Agent (non-Group Coordinator) | Any content | `coordinator` mode | First triggers `Group Coordinator Agent` to judge whether to continue dispatching |
| Agent (Group Coordinator) | Has one triggerable `@xxx` | `coordinator` mode | Triggers the @mentioned agent |
| Agent | Has one triggerable `@xxx` | `auto` mode | Triggers the @mentioned agent (except self) |
| Agent | No @ | `auto` mode | **No response**, flow ends here |
| Agent | Any content | `manual` mode | **No response**, message is display only |

---

## 4. Agent Triggering Agent

### 4.1 Direct @ in Message Content (Recommended)

The agent writes `@target-agent-name` in the reply content, or writes a space followed by `@target-agent-name` in the body text. The system will first parse valid mentions, then decide whether to trigger based on the group mode.

```
# Host Prompt Example
After announcing the debate topic, write "@Pro First Speaker please present opening statement"
```

**@ Parsing Rules**:
- `@` triggers when at the beginning of a line, or when the character before `@` is a space
- Direct `@` after punctuation or text doesn't trigger
- Agent name followed by space, end of line, or punctuation (`!?.,:;！？。，；：`)
- If the same agent is @mentioned multiple times in the same message, only triggers once
- Single message can trigger at most one agent; when multiple different agent @mentions appear, the frontend intercepts user messages, backend only processes the first valid @
- Long names match first (avoid "First Speaker" incorrectly matching "Pro First Speaker")

**Mode Differences**:
- `auto`: Valid `@` written by regular agents will directly trigger the target agent
- `manual`: Valid `@` written by regular agents won't trigger any agent
- `coordinator`: Only valid `@` written by the built-in `Group Coordinator Agent` will directly trigger the target agent; `@` written by regular agents only serves as input for the `Group Coordinator Agent` to judge

---

## 5. Default Agent

Each regular group can have one default agent (`defaultAgentId`). In `auto` or `manual` mode, when a user sends a message **without any @**, the default agent automatically triggers.

- Default agent must be a member of the group
- Quick chat rooms don't use this logic, instead using `quickChatAgentId`
- Default agent is not used in `coordinator` mode; switching to this mode clears `defaultAgentId`

---

## 6. History Context Injection

When an agent is triggered, the system typically injects group history into the context (unless `injectGroupHistory = false`):

| Config Item | Default Value | Description |
|-------|--------|------|
| `AGENT_HISTORY_THRESHOLD` | 20 | Triggers summary compression when exceeding this count |
| `AGENT_MEMORY_RECENT_MESSAGES` | 10 | Keeps last N messages as raw text injection |
| `AGENT_MEMORY_COMPACT_MESSAGES` | 40 | Maximum message count for triggering summary |

Additional notes:
- When quick chat rooms trigger `quickChatAgentId`, the current implementation skips history injection
- Business agents in regular rooms default to injecting history according to `injectGroupHistory` config

**Important Impact**: The agent can see who sent the message that triggered it and what the content is. This sometimes causes the LLM to naturally start its response with `@sender`; this is model behavior, not a system-added prefix.

---

## 7. Scheduled Task Trigger

Chatrooms can configure Cron scheduled tasks. When the time comes, the system generates a "system message that looks like a user message" and sends it to the chatroom, then processes it according to normal user message rules.

If the task selects multiple `agentIds` or `["*"]`, the scheduler will loop to send multiple messages: each message only automatically adds one `@agent-name`, triggering target agents one by one. This way scheduled tasks can batch notify multiple agents while maintaining the "single message triggers at most one agent" rule.

If a scheduled task doesn't explicitly specify `agentIds`, subsequent behavior is consistent with normal user messages:
- Quick chat room: triggers quick chat agent
- Regular room with `coordinator` mode: triggers `Group Coordinator Agent`
- Regular room with `auto/manual` mode: triggers default agent (if set)

Two types are supported:
- `cron`: Standard cron expression (`0 9 * * *` for every day at 9am)
- `once`: Specifies a single time point to trigger once

---

## 8. Prompt Design Recommendations

### 8.1 Relay Mode (Debate/Competition/Multi-role)

**Chatroom Configuration Requirements**: Prefer using `agentTriggerMode = auto`. If you want the system to automatically determine who to find next, use `coordinator` and clearly write out business agent responsibilities.

**Core Design Principle**:
> Each agent's reply must contain `@next-agent`, otherwise the flow ends at that node.

**Two Strategies for Reliable Triggering (choose one)**:

**Strategy A: Explicit Rules (Most Reliable)**

At the end of each intermediate node agent's prompt, add:
```
After speaking, write @Main-Controller-Agent-Name on a separate line at the very end of the message to notify it to continue arranging the flow.
Do not @ the main controller agent at the beginning; use plain text for addressing, @ appears only once at the end.
```

**Strategy B: Rely on LLM Natural Behavior (Not Recommended as Standalone)**

The triggerer's name is in the history context, and the LLM will often naturally start with `@triggerer`. However, this behavior is unstable (the LLM might start directly with the body text), and shouldn't be the only trigger mechanism.

**Recommended**: Use Strategy A (explicit rules) to ensure 100% reliability.

### 8.2 Main Controller Agent (Host/Referee/Director) Design

```markdown
## Flow Control Rules
- Only arrange one agent for the current stage at a time, don't pre-arrange the next round
- When arranging, directly write "@Agent-Name please [action]", don't add extra content
- Wait for the named agent to speak (system will trigger you again), then arrange the next one
```

### 8.3 Execution Agent (Debater/Player/Actor) Design

```markdown
## Flow Notification Rules
- After each speech, write @Main-Controller-Agent-Name on a separate line at the end
- Don't @ the main controller agent at the beginning; use plain text for addressing
- @ appears only once in the entire message (at the end)
```

### 8.4 Group Rule Recommendations

Group rules define **role behavior constraints**, which don't affect AI trigger mechanisms. Don't write "wait to be named before speaking" in group rules to control triggering—triggering is determined by the system, not self-controlled by the agent.

| Suitable for Group Rules | Not Suitable for Group Rules |
|------------|--------------|
| Speech content format requirements | Trigger conditions (system responsible) |
| Role positioning explanation | Waiting mechanism (system responsible) |
| Competition/activity business rules | Who goes first or after (prompt responsible) |
| Language style requirements | @ whom rules (prompt responsible) |

---

## 9. FAQ

### Q: Flow interrupted, agent no longer responding?

First confirm the current group mode:

- `auto`: Check if an intermediate node agent's reply contains a triggerable `@next-agent`. If not, the flow will be interrupted
- `manual`: Agents won't automatically relay by design
- `coordinator`: Check if the `Group Coordinator Agent` is dispatching messages to a business agent; `@` written by regular agents doesn't guarantee direct effect

### Q: Agent triggered twice?

When the same triggerable `@agent-name` appears multiple times in the same message, the system only triggers once. However, if @ appears once at the beginning and once at the end causing **display duplication** (visually two @s), you need to explicitly state in the prompt "triggerable @ appears only once, use plain text for addressing at the beginning."

### Q: Can agents automatically relay in manual mode?

No. Manual mode completely blocks inter-agent triggering; you can only trigger each agent manually via triggerable `@agent-name` by the user.

### Q: Why doesn't an agent directly trigger when it writes `@another-agent` in coordinator mode?

This is by design. In coordinator mode, regular agent messages are first handed to the built-in `Group Coordinator Agent` to judge; only valid `@agent` issued by the `Group Coordinator Agent` will be directly dispatched.

### Q: What happens when multiple agents are @mentioned simultaneously?

They are no longer triggered concurrently. User messages are intercepted by the frontend; for agent or external platform messages containing multiple different agent @mentions, the backend only processes the first valid @.