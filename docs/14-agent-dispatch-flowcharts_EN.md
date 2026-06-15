# TeamAgentX Dispatch System — Full Scenario Flowcharts

English | [中文](14-agent-dispatch-flowcharts.md)

> Updated: 2026-06-15
> Status: description of the current implementation; the server source is authoritative
> Scope: behavior after Web, desktop, mobile, Bridge, and scheduled tasks enter the same message dispatch pipeline

## 1. Core Concepts

| Concept | Meaning |
| --- | --- |
| Smart Collaboration mode | Server value `coordinator`. The legacy value `auto` is normalized to this mode |
| Manual mode | Server value `manual`. The user triggers via an explicit `@` or a valid default agent; agent messages do not auto-relay |
| Quick chat | A room with `quickChatAgentId`; with no `@`, the message goes directly to the quick-chat agent |
| Business agent | An agent that has joined the room, is enabled, and has `agentLevel != system` |
| Coordinator | A system-level agent that outputs structured dispatch decisions; not a normal business candidate |
| Independent task | Each coordinator `assignment` is sent to exactly one target agent |
| Parallel dispatch | Multiple independent tasks enqueued at once; the coordinator summarizes after all finish |
| Serial dispatch | Only one task enqueued at a time; the next step is dispatched only after the previous finishes |
| UI dispatch plan | The overall task plan the coordinator shows in the room — display only, does not re-trigger message routing |

## 2. Global Overview

```mermaid
flowchart TD
    A["Message enters the system"] --> B{"Message source"}
    B -->|User sent| C["Socket saves and broadcasts the message"]
    B -->|External platform| D["Bridge normalizes the message"]
    B -->|Scheduled task| E["Create a system user message with isHuman=true"]
    B -->|Agent output| F["Save the agent message"]
    B -->|Coordinator plan| G["Broadcast to UI only, no recursive routing"]

    C --> H["Fire receivedMessage"]
    D --> H
    E --> H
    F --> H

    H --> I["Identify sender, room mode, reply relation, valid @"]
    I --> J{"Sender type"}
    J -->|Human or treated as human| K["User message routing"]
    J -->|Business agent| L["Agent message routing"]
    J -->|Coordinator| M["Coordinator messages skip normal agent routing"]

    K --> N{"Routing result"}
    L --> N
    N -->|Direct execution| O["Create a queue task for a single agent"]
    N -->|Request coordination| P["Coordinator produces a structured decision"]
    N -->|Nothing to do| Q["End, no agent reply"]
    N -->|Await user| R["Prompt the user for more info in the room"]

    P --> S{"Coordinator decision"}
    S -->|dispatch single| O
    S -->|dispatch parallel| T["Start or merge a parallel batch"]
    S -->|dispatch serial| U["Start a serial chain, dispatch step 1 only"]
    S -->|ask_owner| R
    S -->|no_dispatch| Q
    S -->|cannot_dispatch| Q

    T --> V["Parallel batch completes or is interrupted by the user"]
    U --> W["Serial chain completes, fails, or is interrupted by the user"]
    V --> X{"Does the coordinator need to summarize"}
    W --> X
    X -->|Needed| P
    X -->|Silent close| Q
```

## 3. Message Preprocessing & Common Interception

```mermaid
flowchart TD
    A["receivedMessage received"] --> B["Load room, sender, and members"]
    B --> C["Normalize trigger mode<br/>auto -> coordinator"]
    C --> D{"Is it a human message"}

    D -->|Yes| E["Reset collaboration hop budget and stall-rescue counters"]
    E --> F["Abort the running watchdog coordination request"]
    F --> G["Mark active parallel batch and serial chain as user-intervened"]
    G --> H["Enter user message routing"]

    D -->|No| I{"Did the agent @ a human"}
    I -->|Yes| J["Mark workbench as needs-input"]
    J --> K["Don't arm the stall watchdog"]
    K --> L{"Is it manual mode"}
    I -->|No| L

    L -->|Yes| M["@ between agents is display-only, no further routing"]
    L -->|No| N{"Does it hit the current serial task"}
    N -->|Yes| O["Message shown normally<br/>wait for queue settlement to advance the chain"]
    N -->|No| P{"Does it belong to an active parallel batch"}

    P -->|Members still pending| Q["Mark this member complete and wait"]
    P -->|Last member done| R{"Did the user intervene during the batch"}
    R -->|No| S["Trigger parallelBatchJoin for coordination"]
    R -->|Yes| T["Silently close the batch"]
    P -->|Not in a batch| U["Enter normal agent message routing"]
```

### `@` recognition rules

- Only names of enabled agents in the current room are recognized.
- `@` inside code blocks and inline code is ignored.
- `@agent-name` within continuous Chinese text is recognized.
- Email-like ASCII text is not mistaken for an agent mention.
- A repeated mention of the same agent is kept once.
- Longest name matches first, so a short name doesn't truncate it.

## 4. Full User Message Routing

```mermaid
flowchart TD
    A["User message"] --> B["Parse valid agent @"]
    B --> C{"Is it a quick-chat room"}

    C -->|Yes & no @| D{"Is quickChatAgentId configured"}
    D -->|Yes| E["Dispatch the quick-chat agent directly<br/>use session dir, skip normal room history"]
    D -->|No| F["Continue normal room routing"]
    C -->|No| F
    C -->|Yes & has @| G["Route by explicit @, don't auto-trigger the quick agent"]

    F --> H{"Any valid @"}
    G --> H

    H -->|One @| I["Validate the agent is enabled and in the room"]
    I -->|Valid| J["Dispatch that agent directly"]
    I -->|Invalid| K["End, no dispatch"]

    H -->|Multiple @| L{"Smart-collaboration normal room"}
    L -->|Yes| M["Hand to the coordinator<br/>reason humanMultiMention"]
    L -->|No| N["Take the single allowed target<br/>front-end usually already limits multi-select"]

    H -->|No @| O{"Was the previous message an agent @-ing this user"}
    O -->|Yes| P["Direct reply to that agent"]
    O -->|No| Q{"Does this message reply-quote an agent"}
    Q -->|Yes| R["Direct reply to the quoted agent"]
    Q -->|No| S{"Is a valid default agent configured"}
    S -->|Yes| T["Dispatch the default agent directly"]
    S -->|No| U{"Is it Smart Collaboration mode"}

    U -->|Yes & business agents exist| V["Coordinator must pick one agent by relevance<br/>reason humanUnroutedMessage"]
    U -->|Yes but no business agents| W["Coordinator uses the regular decision space"]
    U -->|No| X["No response<br/>front-end usually blocks and prompts to pick an agent"]

    V --> Y["Force decision=dispatch"]
    Y --> Z["Force exactly one assignment"]
    Z --> AA["Forward the user message verbatim to the most relevant agent"]

    M --> AB["Coordinator decides single, parallel, or serial"]
    W --> AB
```

### Smart-collaboration rule when there's no default agent

When the user has no `@`, no usable reply target, no default agent, and the room is in Smart Collaboration mode:

1. Choose from all enabled business agents in the room.
2. Judge by the relevance of agent name, description, and dispatch rules to the user message.
3. Must pick one agent to execute — `no_dispatch`, `ask_owner`, and `cannot_dispatch` are not allowed.
4. Produce exactly one independent task.
5. Forward the user's original message in full to the chosen agent, so the coordinator's rewrite doesn't drop requirements.
6. Only when no business agents exist in the room does it fall back to the coordinator's regular decision space.

## 5. Full Agent Message Routing

```mermaid
flowchart TD
    A["Business agent outputs a message"] --> B{"Does it @ a human"}
    B -->|Yes| C["Mark workbench as awaiting user input<br/>this message doesn't arm the watchdog"]
    C --> D{"Is the room in manual mode"}
    B -->|No| D
    D -->|Yes| E["End<br/>agent @ is display-only text"]
    D -->|No| F["Parse valid agent @ excluding self"]

    F --> G{"Mention count"}
    G -->|0| H["Don't immediately dispatch other agents"]
    H --> I["Arm the stall watchdog when conditions are met"]

    G -->|1| J{"Is it a quick-chat room"}
    J -->|Yes| K["Dispatch the first mentioned agent directly"]
    J -->|No| L["Validate the target is enabled and in the room"]
    L -->|Invalid| M["Hand to the coordinator<br/>reason assistantMentionNotMember"]
    L -->|Valid| N["Register single-agent handoff budget"]
    N --> O{"Over the hop limit or forming a loop"}
    O -->|No| P["Dispatch the target agent directly"]
    O -->|Yes| Q["Coordinator deterministically notifies the owner<br/>this and subsequent handoffs stop"]

    G -->|Multiple| R{"Is it a quick-chat room"}
    R -->|Yes| S["Dispatch the first mentioned agent directly"]
    R -->|No| T["Hand to the coordinator<br/>reason assistantMultiMention"]

    M --> U["Coordinator re-evaluates executable targets"]
    T --> U
```

### Agent direct-handoff budget

- The budget only limits the fast handoff path of "one agent explicitly `@`-ing another".
- Every new human message resets the budget.
- The limits cover the max handoff hops and the loop formed by the same pair handing off back and forth.
- Once exceeded, no LLM judgment is invoked; the coordinator sends a deterministic stop notice instead.
- Parallel or serial tasks initiated by the coordinator do not use this fast-handoff budget.

## 6. Coordinator Structured Decision

```mermaid
flowchart TD
    A["Trigger the coordinator"] --> B["Load room rules, message context, candidate agents"]
    B --> C["Candidate filter<br/>enabled, in room, non-system"]
    C --> D["Append dispatch rules and the trigger reason"]
    D --> E{"Is the reason humanUnroutedMessage<br/>and business agents exist"}

    E -->|Yes| F["Restrict the tool schema<br/>allow dispatch only"]
    F --> G["assignments required, at most one"]
    G --> H["Require picking by relevance and forwarding verbatim"]

    E -->|No| I["Use the regular coordination tool schema"]
    I --> J["Allow dispatch, ask_owner, no_dispatch, cannot_dispatch"]
    J --> K["dispatch may choose parallel or serial"]

    H --> L["Call the LLM tool decision"]
    K --> L
    L --> M{"Did the call/parse succeed"}
    M -->|No| N["Log a skip and end"]
    M -->|Yes| O{"Decision type"}

    O -->|no_dispatch| P["Sync workbench to waiting-review when the room is idle<br/>no room message"]
    O -->|cannot_dispatch| Q["Record the reason, no room message"]
    O -->|ask_owner| R["Coordinator asks in the room<br/>sync workbench when the room is idle"]
    O -->|dispatch| S["Parse assignments"]

    S --> T["Resolve target agents by name or id"]
    T --> U["Filter out disabled, not-in-room, and duplicate targets"]
    U --> V{"Any valid task"}
    V -->|No| N
    V -->|Yes| W{"Did humanUnroutedMessage unexpectedly produce multiple"}
    W -->|Yes| X["Truncate to the first"]
    W -->|No| Y["Keep all independent tasks"]
    X --> Z["Generate the UI dispatch plan"]
    Y --> Z

    Z --> AA{"Task count and dispatchMode"}
    AA -->|Single task| AB["Create one queue task directly"]
    AA -->|Multiple parallel| AC["Create each queue task simultaneously"]
    AA -->|Multiple serial| AD["Create the serial chain, dispatch step 1 only"]
```

### Dispatch plan vs actual task messages

The coordinator first shows the full plan in the room, e.g.:

```md
**Parallel tasks**

- @Frontend: implement the page and interactions
- @Backend: implement the API and data model
```

But execution splits it into two mutually independent queue tasks:

```text
@Frontend implement the page and interactions
```

```text
@Backend implement the API and data model
```

This keeps the in-room plan readable while ensuring each agent receives only its own task. Serial mode splits tasks the same way, just dispatched one by one in order.

## 7. Parallel Dispatch Lifecycle

```mermaid
flowchart TD
    A["Coordinator produces multiple parallel assignments"] --> B["Show the parallel task plan in the room"]
    B --> C["Immediately create an independent queue task for each agent"]
    C --> D["Create or merge the room's parallel batch"]

    D --> E1["Agent A runs"]
    D --> E2["Agent B runs"]
    D --> E3["Agent N runs"]

    E1 --> F["Agent message enters receivedMessage"]
    E2 --> F
    E3 --> F

    F --> G["Remove the current agent from the batch pending set"]
    G --> H{"Any members still pending"}
    H -->|Yes| I["Suppress this message's routing<br/>wait for the others"]
    H -->|No| J{"Did the user send a new message during the batch"}

    J -->|No| K["Trigger parallelBatchJoin"]
    K --> L["Coordinator reads each agent's result"]
    L --> M{"Continue dispatching"}
    M -->|Yes| N["Produce a new round of single/parallel/serial tasks"]
    M -->|No| O["Batch ends normally"]

    J -->|Yes| P["Silently close the batch"]
    P --> Q["No more auto-summary<br/>follow the new routing opened by the user's message"]
```

### Parallel batch rules

- When the room already has a parallel batch, a new parallel task merges into the current batch without overwriting pending members.
- An agent `@` in a batch member's output does not immediately trigger a new task; it must wait for the batch to join.
- After the last member finishes, the coordinator is auto-requested to summarize only if the user has not intervened.
- A new user message during the batch keeps the produced messages but closes the original batch's auto-summary.

## 8. Serial Dispatch Lifecycle

```mermaid
flowchart TD
    A["Coordinator produces multiple serial assignments"] --> B["Show the numbered serial plan in the room"]
    B --> C["Save the ordered steps and current index"]
    C --> D["Create a queue task for step 1 only"]
    D --> E["Bind the current taskQueueId"]

    E --> F["The current agent runs and outputs a message"]
    F --> G["Message shown normally<br/>doesn't advance via @"]
    G --> H["Wait for queue task settlement"]
    H --> I{"Settlement status"}

    I -->|failed or cancelled| J["Clear the serial chain and stop"]
    I -->|completed| K{"Has the user intervened"}
    K -->|Yes| L["Stop remaining steps and close silently"]
    K -->|No| M{"Any remaining steps"}

    M -->|Yes| N["Find the next valid agent"]
    N --> O{"Is the agent enabled and still in the room"}
    O -->|No| P["Skip this step and keep looking"]
    P --> N
    O -->|Yes| Q["Create the next step's queue task carrying prior results"]
    Q --> E

    M -->|No| R["Serial chain fully complete"]
    R --> S["Trigger serialChainJoin"]
    S --> T["Coordinator summarizes or produces new tasks"]

    N -->|No remaining valid agent| U["Terminate the serial chain"]
    Q -->|Enqueue failed| U
    S -->|Coordinator unavailable| U
```

### Serial advance rules

- Agent messages only show results; they don't advance the chain.
- A queue task's `completed`, `failed`, or `cancelled` settlement event is the only advance trigger.
- The next step gets the previous agent's final output as history context.
- A later agent that is disabled or has left the room is skipped.
- After the user interjects, the current step settles normally, but the remaining steps no longer auto-execute.

## 9. Stall Watchdog

```mermaid
flowchart TD
    A["Business agent output in a smart-collaboration normal room"] --> B{"Did the message @ a human"}
    B -->|Yes| C["Don't schedule the watchdog"]
    B -->|No| D["Start a debounce timer per room"]

    D --> E["On timer expiry, recheck room state"]
    E --> F{"Still a smart-collaboration normal room"}
    F -->|No| G["End"]
    F -->|Yes| H{"Any pending or executing task"}
    H -->|Yes| G
    H -->|No| I{"Latest message still a business agent and not @-ing a human"}
    I -->|No| G
    I -->|Yes| J{"Consecutive rescues under the cap"}
    J -->|No| G
    J -->|Yes| K{"Is the coordinator available"}
    K -->|No| G
    K -->|Yes| L["Trigger a stallWatchdog coordination decision"]
    L --> M["Record the agent dispatched by this rescue"]

    N["User sends a new message"] --> O["Cancel the timer and coordination request"]
    O --> P["Abort executing tasks dispatched by the watchdog"]
    P --> Q["Cancel pending tasks dispatched by the watchdog"]
    Q --> R["Reset the rescue count"]
```

The watchdog only handles "the agent finished, the room is idle, but the collaboration may not really be done". It won't keep dispatching while queue tasks remain, the agent is awaiting user input, or the rescue count is exceeded.

## 10. User Intervention & Stopping Tasks

```mermaid
flowchart TD
    A{"User action"} -->|Send a new message| B["Mark parallel batch and serial chain as intervened"]
    A -->|Stop a pending task| C["Mark the task cancelled"]
    A -->|Stop an executing task| D["Abort the executor"]

    B --> E["Abort the watchdog coordination request and its tasks"]
    B --> F["Reset the collaboration handoff budget and rescue count"]
    B --> G["Original parallel batch no longer auto-summarizes after completion"]
    B --> H["Original serial chain dispatches no remaining steps after the current one"]
    B --> I["New message re-decides via normal user routing"]

    C --> J{"Does the task belong to a serial chain"}
    J -->|Yes| K["Clear the corresponding serial chain"]
    J -->|No| L["Keep other unrelated task states"]

    D --> M["Cancel the stall watchdog"]
    M --> N["Clear the room's serial chain"]
    N --> O["Wait for the executor and queue state to close out"]
```

## 11. Scheduled Tasks & Bridge Messages

```mermaid
flowchart TD
    A{"External entry"} -->|Scheduled task| B["Create a system user message<br/>isHuman=true"]
    A -->|Bridge| C["Adapter normalizes text, mentions, source info"]

    B --> D{"Are agentIds or all agents specified"}
    D -->|Yes| E["Generate one single-@ message per valid target"]
    D -->|Target invalid| F["Fall back to all non-system agents in the room"]
    D -->|No target specified| G["Generate a no-@ message"]

    E --> H["Broadcast one by one and fire receivedMessage"]
    F --> H
    G --> H
    C --> H

    H --> I["Route uniformly as a human message"]
    I --> J{"Any explicit @"}
    J -->|Yes| K["Direct target or multi-@ coordination"]
    J -->|No| L["Process by quick agent, reply relation, default agent, smart coordination order"]
```

Scheduled-task messages append the task name at the end. Bridge messages keep platform source info and pass it down when creating the agent queue task.

## 12. Full Scenario Decision Table

| Scenario | Dispatch result |
| --- | --- |
| Quick chat, no `@` | Execute `quickChatAgentId` directly |
| Quick chat, has `@` | Execute the first explicitly mentioned agent |
| User single `@` valid agent | Execute that agent directly |
| User multi-`@`, smart-collaboration normal room | Hand to the coordinator to split into single/parallel/serial |
| User no `@`, previous agent explicitly `@`-ed the user | Direct reply to the previous agent |
| User reply-quotes an agent message | Direct reply to the quoted agent |
| User no `@`, a valid default agent exists | Execute the default agent directly |
| User no `@`, no default agent, smart collaboration, business agents exist | Coordinator must pick one agent by relevance |
| User no `@`, no default agent, smart collaboration, no business agents | Coordinator uses the regular decision; may not dispatch or may ask the user |
| User no `@`, no default agent, manual mode | No execution; front-end usually prompts ahead |
| Agent no `@` | Don't hand off immediately; the stall watchdog rescues if needed |
| Agent single `@` valid room member | Hand off directly while the budget allows |
| Agent single `@` invalid or non-member | Hand to the coordinator to fix the target |
| Agent multi-`@` | Hand to the coordinator to decide parallel or serial |
| Agent `@`s only a human | Await user input; don't arm the watchdog or produce an agent handoff |
| Agent `@`s both a human and an agent | Mark awaiting user input while still processing the agent handoff |
| Manual mode, agent `@`s agent | Display only, no execution |
| Parallel last member done and no user intervention | Coordinator summarizes |
| User intervenes during a parallel batch | Batch closes silently, no auto-summary |
| Serial current step done and no user intervention | Dispatch the next step; coordinator summarizes at the tail |
| Serial step fails or is cancelled | Terminate the whole serial chain |
| User intervenes during a serial chain | Stop the remaining steps after the current one |
| Coordinator request fails or the structured result can't be parsed | Log and end, no task created |
| Coordinator target disabled, left, or duplicate | Filtered; end when no valid target remains |
| `@agent` inside code | No trigger |
| Scheduled task specifies multiple agents | Create an independent single-`@` message per agent |
| Bridge user message | Enters the same dispatch flow as a normal user message |

## 13. Dispatch Invariants That Must Hold

1. Each coordinator `assignment` describes a single agent's independent task only.
2. Parallel and serial are execution relationships between tasks; don't stuff multiple agents' requirements into one task message.
3. The full in-room dispatch plan is display only and must not re-fire `receivedMessage`, otherwise dispatch duplicates.
4. In Smart Collaboration, when the user has no routing target but business agents exist, one agent must be picked by relevance.
5. Parallel tasks must wait for all members to join before further coordination, unless the user has intervened.
6. Serial tasks must be advanced by queue settlement events, not by `@` in agent output text.
7. A new user message has priority to interrupt the old collaboration chain; old batches/serial chains must not override the user's new intent.
8. Default agent, quick-chat agent, and explicit reply targets are deterministic routing and take priority over coordinator reasoning.
9. Only enabled agents in the current room can be final execution targets.
10. The coordinator itself must not appear in the business-agent relevance candidate list.

## 14. Main Source Locations

| Responsibility | File |
| --- | --- |
| Message master routing | `server/src/core/agent/agent-handler/handler.ts` |
| `@` parsing & message utils | `server/src/core/agent/agent-handler/message-utils.ts` |
| Coordinator structured decision | `server/src/core/agent/coordinator-dispatch.ts` |
| Parallel batch tracking | `server/src/core/agent/agent-handler/parallel-batch-tracker.ts` |
| Serial chain tracking | `server/src/core/agent/agent-handler/serial-chain-tracker.ts` |
| Serial task settlement advance | `server/src/core/agent/agent-handler/task-lifecycle.ts` |
| Stall watchdog | `server/src/core/agent/agent-handler/stall-watchdog.ts` |
| Agent handoff budget | `server/src/core/agent/agent-handler/collaboration-budget.ts` |
| Scheduled task message entry | `server/src/core/cron/cron-scheduler.service.ts` |
| Bridge message entry | `server/src/modules/bridge/bridge.service.ts` |
| Socket message entry & stopping tasks | `server/src/socket/index.ts` |

## 15. Suggested Reading Order

When debugging why a message didn't trigger an agent, check in this order:

1. Whether the message actually fired `receivedMessage`.
2. Whether the room is quick-chat, smart-collaboration, or manual mode.
3. Whether the `@` was recognized and the target is enabled and in the room.
4. Whether deterministic routing (quick agent, reply relation, default agent) was hit.
5. Whether the coordinator was reached, and its trigger reason.
6. Whether the coordinator produced valid `assignments` and whether targets remain valid after filtering.
7. Whether the task is a single task, parallel batch, or serial chain.
8. Whether the user sent a new message or stopped tasks during execution.
9. Whether a termination condition exists: handoff budget, watchdog count, task failure, or coordinator unavailability.
```
