# 07 · Appendix

English | [Chinese](07-appendix.md)

## A. Glossary

| Term | Meaning |
|------|------|
| **Group (ChatRoom / Group)** | A project container with working directory, task cards, members, and group rules |
| **Agent / Assistant** | A role configuration: model + system prompt + loaded skills |
| **Agent Template vs Agent Instance** | Template is a configuration (reusable across groups); instance is a specific memory slice of a template in a group |
| **agent_level** | `system` for preset templates (e.g., coordinator/engineer/qa default configurations, skill management); `normal` for user-created |
| **Agent Category** | User-defined grouping for assistants; system categories are read-only |
| **Skill** | An ability package with prompt fragments + tool whitelist + triggers, compatible with Claude Code skill format |
| **Skill Installation Method** | Full copy / symlink (auto-sync from external updates) / external import |
| **Model / LLM Provider** | A set of API configurations: provider/model/api_key/api_url/api_protocol |
| **Task Card** | Structured task definition with owner/reviewer/steps/expected_output/out_of_scope/status |
| **Group Rules** | Group-level agent behavior constraints, divided into self-discipline layer (prompts) and he-discipline layer (hooks) |
| **Coordinator / OWNER** | The role responsible for scheduling in a group, exclusively holds the right to end discussions; OWNER can also refer to human users |
| **QA (Quality Assurance)** | Role that validates task card outputs, the only legitimate changer of `done` status |
| **Blocked Report** | Mechanism for agents to proactively declare "I can't continue," triggering coordinator takeover or human intervention |
| **Group as Project** | One group corresponds to one project working directory, with three-layer isolation for files/task cards/agent memory |
| **injectGroupHistory** | Whether to inject historical group messages into an agent's context when adding it to a group (controls context pollution) |
| **Trigger Mode (agentTriggerMode)** | `coordinator` (default): built-in scheduling agent controls dispatch; `auto`: agent @ directly triggers other agents; `manual`: agent @ is just a mention without triggering |
| **Default Recipient Agent** | When group owner sends a message without @mentioning anyone, automatically @ this agent (fallback) |
| **Aggregation Window** | After coordinator dispatches, collects all deliveries within a certain window before summarizing at once, preventing fan-out storms |
| **Objective Verification / verifications** | Verification that doesn't rely on LLM judgment, runs scripts/tests/validates file hashes to confirm task is truly complete |
| **Self-discipline Layer / He-discipline Layer** | Self-discipline: encouraging rules written in prompts; He-discipline: mandatory rules through message bus hooks |
| **Risk Level** | Actions categorized as low / medium / high, determining whether human pre-confirmation is needed |
| **Permission Mode** | Group-level switches: plan / normal / acceptEdits / bypass, controlling automation level |
| **Quick Chat** | Skip group creation for direct 1v1 chat with an agent, essentially a special group with isQuickChat=true |
| **Group-level Cron** | Schedule timed tasks in a group that send a message to the group at scheduled times to trigger a specified agent |
| **WorkDir** | Working directory, three-layer strategy: group-level shared / agent default / quick chat independent |
| **Streaming Thinking Chain (streamingThinking)** | Real-time display of model reasoning content |
| **Execution Records** | Complete execution chain behind each message (prompts, tool calls, token usage, etc.) |
| **Context Inspection (contextInfo)** | View the actual context an agent can currently see |

---

## B. Key Schemas

### B.1 LLM Provider

```yaml
provider:
  id: prov-001
  name: "My Anthropic"
  type: custom                  # anthropic / openai / deepseek / custom
  api_protocol: anthropic       # Protocol type
  api_url: https://api.anthropic.com
  api_key: sk-ant-...
  model: claude-sonnet-4-6
  is_active: true
  is_default: false
  stats:                        # Usage statistics
    total_tokens: 0
    total_cost: 0
```

### B.2 Agent / Assistant

```yaml
agent:
  id: agt-001
  name: Engineer A
  description: Main implementation assistant
  agent_level: normal           # system | normal
  category_id: cat-dev          # Category id (optional)
  avatar: ...
  avatar_color: "#3B82F6"

  # Model configuration
  model_ref: prov-001
  model_strategy:               # Planned enhancement (T12)
    primary: prov-001
    fallback_simple: prov-haiku
    fallback_complex: prov-opus
    decision_rule: by_task_complexity

  # Prompt
  system_prompt: |
    You are Engineer A, responsible for implementing requirements according to task cards.
    Strictly follow out_of_scope, report blockers when encountering boundary issues.

  # Skills (implemented)
  skills:
    - slug: react
      version: "1.2.0"
      install_mode: symlink     # copy | symlink | external
    - slug: nodejs-backend
      version: "0.5.0"

  # Tool whitelist (planned enhancement T6)
  tools:
    - read_file
    - write_file
    - edit_file
    - run_command
    - update_task_status
  # Tools not listed cannot be called by this agent

  # Working directory
  default_work_dir: ~/projects   # Agent default directory (optional)

  # Thinking mode (Claude series extended thinking)
  thinking_mode: high            # off | low | medium | high (default high)

  # Status
  is_active: true
```

### B.3 Group (ChatRoom)

```yaml
chat_room:
  id: room-001
  name: My Blog Refactor
  description: Upgrade homepage SSR + add dark mode
  work_dir: /Users/.../projects/my-blog
  is_pinned: false
  is_quick_chat: false

  # Group rules
  rules:
    self_discipline:           # Self-discipline layer (injected into prompts)
      - Keep replies concise, no small talk
      - Communicate in Chinese
    he_discipline:             # He-discipline layer (message bus hooks, planned enhancement T8)
      - id: must_have_task_id
        priority: 100
        when: pre_message_send
        match:
          speaker_role: [MEMBER]
          speaker_level: normal
        check: "msg.contains_task_id || msg.is_meta"
        on_fail:
          action: reject
          hint: "Replies must include task card id (except meta discussions)"
      - id: no_at_on_done
        priority: 200
        when: pre_message_send
        match:
          content_pattern: "(complete|delivered|done|finished)"
        check: "msg.mentions.length === 0"
        on_fail:
          action: reject
          hint: "Completion-type replies should go through task card status change, don't @ coordinator"

  # Trigger mode
  trigger_mode: coordinator      # coordinator (default) | auto | manual
  default_recipient: agt-002     # Default recipient agent when user doesn't @ (invalid in coordinator mode)

  # Permission mode (planned enhancement T7)
  permission_mode: normal        # plan | normal | acceptEdits | bypass

  # Members
  members:
    - chat_room_agent_id: cra-001
      agent_id: agt-002          # Coordinator
      role: MEMBER
      inject_group_history: true
    - chat_room_agent_id: cra-002
      agent_id: agt-001          # Engineer A
      role: MEMBER
      inject_group_history: true
    - user_id: usr-001            # Group owner (human)
      role: OWNER

  # Associations
  task_cards: []
  cron_tasks: []
```

### B.4 Task Card

```yaml
task_card:
  id: TC-001
  chat_room_id: room-001
  title: "Implement Login Page SSO Button"
  description: Detailed description (optional)

  # Responsibility assignment
  owner: agt-001               # Engineer A
  reviewer: agt-003            # QA
  status: in_progress          # todo | in_progress | blocked | in_review | done

  # Complexity (planned enhancement T12)
  complexity: medium           # low | medium | high

  # What to do
  steps:
    - Add OAuth button component to /login
    - Connect /api/oauth/callback
    - Add unit tests
  step_progress:               # Planned enhancement T11
    current_step: 2
    sub_progress: "Callback route implemented, writing parameter validation"
    last_updated: 2026-05-09T14:30:00Z

  # How to verify completion (natural language, for humans)
  expected_output:
    - File: src/pages/Login.tsx contains SSOButton
    - Test: login.test.ts all pass
    - Screenshot: Login page with Google / GitHub buttons

  # Objective verification (planned enhancement T5)
  verifications:
    - type: file_contains
      path: src/pages/Login.tsx
      pattern: "SSOButton"
    - type: command_passes
      command: npm test login.test.ts
    - type: screenshot_matches
      url: http://localhost:3000/login
      reference: docs/refs/login-with-sso.png
      threshold: 0.95

  # Boundaries (key to prevent scope creep)
  out_of_scope:
    - Don't modify registration flow
    - Don't adjust backend OAuth provider configuration

  # File locks (planned enhancement T3)
  related_files:
    - path: src/pages/Login.tsx
      mode: write              # write exclusive / read shared
    - path: src/api/oauth.ts
      mode: read

  # Decision log (planned enhancement T11)
  decisions:
    - time: 2026-05-09T14:00:00Z
      question: Use OAuth library or handwrite
      chosen: Use next-auth
      reason: Project already has next-auth dependency
      alternatives_rejected:
        - {option: Handwrite, reason: Increases maintenance cost}

  # Blockers
  blockers: []                 # Fill when status is blocked

  # Heartbeat (planned enhancement T10)
  last_active_at: 2026-05-09T14:30:00Z
  heartbeat_interval: 5min

  # git binding (planned enhancement T3)
  git_branch: task-card/TC-001

  # Regression tests (planned enhancement T14)
  regression_tests:
    - npm test login.test.ts
    - npm test e2e/login-sso.spec.ts

  # Historical traceability
  history:
    - time: 2026-05-09T13:00:00Z
      actor: agt-002           # Coordinator
      event: created
    - time: 2026-05-09T13:05:00Z
      actor: agt-001           # Engineer A
      event: in_progress       # Accepted task
    - time: 2026-05-09T15:00:00Z
      actor: agt-001
      event: in_review         # Delivered
      evidence:
        verifications_passed: 3/3
        diff_hash: abc123
        test_log_url: ./.task-cards/TC-001/test.log
        screenshot_url: ./.task-cards/TC-001/screenshot.png
```

### B.5 Group Rule Hook (He-discipline Layer)

```yaml
hook:
  id: no_at_on_done
  description: Completion-type replies cannot @ anyone (prevent fan-out storms)
  priority: 200
  when: pre_message_send
  match:
    speaker_role: [MEMBER]
    content_pattern: "(complete|delivered|done)"
  check: "msg.mentions.length === 0"
  on_fail:
    action: reject              # reject | warn | log
    hint: "Completion-type replies should go through task card status change, don't @ coordinator."
```

Event points (when) enumeration:
- `pre_message_send` — Before message is sent
- `post_message_send` — After message is sent
- `pre_tool_use` — Before tool call
- `post_tool_use` — After tool call
- `pre_state_transition` — Before task card state transition
- `round_count_changed` — When round count changes

### B.6 Risk Level + Permission Mode

```yaml
# Tool risk levels (platform built-in + skill self-declaration)
tool_risk_levels:
  read_file: low
  list_directory: low
  web_search: low
  write_file_new: low           # Write new file
  write_file_overwrite: medium  # Overwrite existing
  edit_file: medium
  run_command_readonly: low     # e.g., ls / grep
  run_command_shell: medium
  run_command_destructive: high # e.g., rm
  git_commit: medium
  git_push: high
  call_paid_api: high
  delete_file: high

# Group-level permission mode
permission_mode:
  plan:
    auto_execute: []
    requires_confirm: [low, medium, high]
  normal:
    auto_execute: [low]
    requires_confirm: [medium, high]
  acceptEdits:
    auto_execute: [low, medium]
    requires_confirm: [high]
  bypass:
    auto_execute: [low, medium, high]
    requires_confirm: []
```

### B.7 Group-level Cron Task

```yaml
cron_task:
  id: cron-001
  chat_room_id: room-001
  name: Daily Competitor Scan
  description: Check competitor updates daily at 9am

  # Scheduling
  schedule_type: preset          # preset | interval | cron | once
  cron_expression: "0 9 * * *"   # Standard cron
  # or preset: Every day 9:00
  # or interval_minutes: 60
  # or once_at: 2026-05-15T15:00:00Z

  # Execution content
  execution_content: "Crawl competitor updates this week and summarize"
  auto_mention_agent: agt-005    # Auto @ researcher

  # Behavior
  enabled: true
  max_retries: 3
  next_run_at: 2026-05-10T09:00:00Z
  last_run_at: 2026-05-09T09:00:00Z

  # History
  executions:
    - id: exe-001
      ran_at: 2026-05-09T09:00:00Z
      duration_ms: 12000
      status: success
      triggered_message_id: msg-...
```

### B.8 File Change Event (Planned Enhancement T4)

```yaml
file_changed_event:
  id: evt-001
  chat_room_id: room-001
  task_card_id: TC-001
  message_id: msg-001
  changed_by: agt-001
  timestamp: 2026-05-09T14:30:00Z

  changes:
    - path: src/pages/Login.tsx
      operation: edit            # create | edit | delete | rename
      diff_summary: "Added SSOButton component, adjusted layout"
      lines_added: 12
      lines_removed: 8
      diff_url: ./.task-cards/TC-001/diffs/login.diff
```

### B.9 Agent Settings within Group (chat_room_agent)

```yaml
chat_room_agent:
  id: cra-001
  chat_room_id: room-001
  agent_id: agt-001
  role: MEMBER                   # OWNER (users only) | MEMBER

  # Context control
  inject_group_history: true     # Whether to inject group history

  # Group-level overrides (optional)
  override_system_prompt: ""     # Temporarily change prompt in group
  override_model: null           # Temporarily change model in group

  # Status
  status: idle                   # idle | typing | executing | error
  queue_count: 0                 # Number of queued messages to process
```

---

## C. API Endpoint Quick Reference

> This section has been verified against actual code (`server/src/gateway/`). For complete parameter descriptions, see [09-api-reference.md](09-api-reference.md).  
> Note: Message sending, mark as read, unread counts, etc. use **Socket.io**, not REST endpoints.

### C.1 LLM Provider
```
GET    /llm-providers
POST   /llm-providers
GET    /llm-providers/:id
PUT    /llm-providers/:id
DELETE /llm-providers/:id
PATCH  /llm-providers/:id/default
PATCH  /llm-providers/:id/status
POST   /llm-providers/:id/test
POST   /llm-providers/parse-config       # Paste text for one-click parsing
```

### C.2 Agent
```
GET    /agents
GET    /agents/active
GET    /agents/grouped
GET    /acp-tools
GET    /agents/:id
POST   /agents
PUT    /agents/:id
DELETE /agents/:id
PATCH  /agents/:id/status                # Activate/deactivate (non-GET)
POST   /agents/:id/clear-context
PUT    /agents/sort-order
POST   /agents/optimize-prompt
POST   /agents/optimize-prompt-stream    # Streaming

# Quick chat
POST   /agents/quick-chat
GET    /agents/:agentId/quick-chat-rooms
GET    /agents/:agentId/quick-chat-count

# Group/execution related in agent.gateway.ts
GET    /chatrooms/:chatRoomId/agents/:agentName/debug
GET    /chatrooms/:chatRoomId/agents/:agentId/executions
GET    /chatrooms/:chatRoomId/quick-chat-session      # GET not POST
```

### C.3 Skill
```
GET    /skills/search                              # ClawdHub search
GET    /skills/shared                             # Shared skill list
POST   /skills/create                             # Create to shared directory
POST   /skills/symlink                            # Symlink install to agent
DELETE /skills/symlink                            # Delete symlink
GET    /skills/:slug                              # Skill details
GET    /skills/external                           # External skill directory

# Agent-level skills (path contains agentId)
POST   /agents/:agentId/skills/discover           # Discover skills in GitHub repo
POST   /agents/:agentId/skills/install-selected   # Install selected skills
POST   /agents/:agentId/skills/install            # Install single skill
GET    /agents/:agentId/skills                    # Agent's installed skill list
DELETE /agents/:agentId/skills/:slug              # Uninstall skill
```

### C.4 ChatRoom
```
GET    /chatrooms
POST   /chatrooms
GET    /chatrooms/:id
PUT    /chatrooms/:id
DELETE /chatrooms/:id
PATCH  /chatrooms/:id/pin
PATCH  /chatrooms/:id/unpin

# Group members (no separate member list endpoint, members included in GET /chatrooms/:id response)
POST   /chatrooms/:id/agents                         # Add member
DELETE /chatrooms/:id/agents/:agentId                # Remove member
PATCH  /chatrooms/:id/agents/:agentId/settings       # Update member settings
POST   /chatrooms/:id/agents/:agentId/clear-context  # Clear context
GET    /chatrooms/:id/agents/:agentId/context        # View context
GET    /chatrooms/:id/agents/:agentId/tasks          # Agent task queue
GET    /chatrooms/:id/tasks/board                    # Task board (all agents)

# Group-level Cron
GET    /chatrooms/:chatRoomId/cron-tasks
POST   /chatrooms/:chatRoomId/cron-tasks
```

### C.5 Message
```
GET    /messages                    # ?chatRoomId= filter
GET    /messages/:id
GET    /messages/:id/execution      # Associated execution record
DELETE /messages/chatroom/:chatRoomId  # Clear group chat messages
DELETE /chatrooms/:chatRoomId/agents/:agentId/executions  # Clear execution records

# Note: Message sending uses Socket.io (socket event: message), no REST POST endpoint
# Note: Unread count updates use Socket.io (event: unread:update), no REST endpoint
```

### C.6 Cron Task
```
GET    /cron-tasks/:taskId
PUT    /cron-tasks/:taskId
DELETE /cron-tasks/:taskId
PATCH  /cron-tasks/:taskId/enable
GET    /cron-tasks/:taskId/executions
POST   /cron-tasks/:taskId/test

# Note: No separate /tasks or /tasks/board endpoint; task board path is /chatrooms/:id/tasks/board
```

### C.7 Token Usage
```
GET    /token-usage/summary
GET    /token-usage/timeline
GET    /token-usage/providers/:providerId

GET    /categories
POST   /categories
PUT    /categories/:id
DELETE /categories/:id

POST   /upload/image
```

### C.8 Bridge (External Platform Bots)
```
GET    /bridge/platforms                          # List supported platforms
GET    /bridge/bots                               # List all bot bindings
POST   /bridge/bots                               # Create bot binding
GET    /bridge/bots/:botId
PUT    /bridge/bots/:botId
DELETE /bridge/bots/:botId
POST   /bridge/bind-code                          # Generate binding code
POST   /bridge/webhook/:platform/:botId           # Webhook entry (platform callbacks)
```

### C.9 Speech
```
GET    /speech/voice-catalog                      # Query available voice list
POST   /speech/tts                                # Text to speech
POST   /speech/stt                                # Speech to text
GET    /speech/providers                          # Configured speech providers
```

---

## D. Known Minor Issues List

> Not part of the 13 major issues in Chapter 04, but noticeable minor pain points, fix as needed.

### D.1 UI / Experience
- [ ] When agent sends multiple messages quickly, previous message still streaming while next starts concatenating, UI order becomes messy
- [ ] Group member sidebar becomes crowded after more than 8 members
- [ ] Switching path between `quick-chat` and formal groups is not smooth
- [ ] Cron task failure notifications are not prominent
- [ ] Unread counts occasionally inaccurate during parallel execution across multiple groups
- [ ] After skill installation, it doesn't immediately appear in agent configuration panel, requires refresh

### D.2 Streaming Output
- [ ] Agent prompt optimization (optimize-prompt) can break stream when running long
- [ ] Streaming thinking doesn't scroll to bottom smoothly for long content

### D.3 Working Directory
- [ ] Web version cannot open local directories (known limitation, just needs clear labeling)
- [ ] Opening preview is slow when working directory is large

### D.4 Settings / Configuration
- [ ] Error messages unclear when LLM Provider configuration is wrong
- [ ] QR code for mobile connection is difficult to scan on some monitors (parsing issue)

### D.5 Data / Sync
- [ ] After service disconnect and reconnect, some messages may display duplicates
- [ ] Unread count sync has delay when switching between multiple devices

---

## E. Reference Materials

### E.1 Internal Documentation (Chronological)
- `ai-team-platform-design.md` — v1 Brainstorm draft (2026-05-09)
- `ai-team-platform-master.md` — v2 Monolithic master document (2026-05-09)
- This set of `01-07.md` — v3 Split version master document (2026-05-09)

### E.2 Competitor Documentation References
- Claude Code Official Docs (hooks / skills / permission mode)
- Cursor docs (auto mode)
- Aider docs (git workflow / weak-model)
- Devin / SWE-agent / OpenHands papers
- CrewAI / AutoGen / LangGraph / MetaGPT official documentation
- Dify / Coze product pages

### E.3 Related Research Directions
- Multi-agent reinforcement learning
- LLM-based agent planning
- Tool use & function calling
- Long-context retrieval / agentic RAG
- Software engineering agent benchmarks (SWE-bench, HumanEval-X)