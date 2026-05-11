# 07 · 附录

## A. 术语表

| 术语 | 含义 |
|------|------|
| **群（ChatRoom / Group）** | 一个项目容器，含工作目录、任务卡、成员、群规则 |
| **助手（Agent / Assistant）** | 一个角色配置：模型 + 系统提示 + 装载 skill |
| **助手模板 vs 助手实例** | 模板是配置（跨群复用），实例是模板在某群内的具体记忆切片 |
| **agent_level** | `system` 为预置模板（如总控/工程师/质检默认配置、技能管理），`normal` 为用户自建 |
| **agent 分类（Category）** | 用户自定义的助手分组方式；系统分类只读 |
| **技能（Skill）** | 提示片段 + 工具白名单 + 触发器的能力包，兼容 Claude Code skill 格式 |
| **Skill 安装方式** | 完全复制 / symlink（外部更新自动同步）/ 导入外部 |
| **模型 / LLM Provider** | 一组 API 配置：provider/model/api_key/api_url/api_protocol |
| **任务卡（Task Card）** | 结构化任务定义，含 owner/reviewer/steps/expected_output/out_of_scope/status |
| **群规则** | 群级别的助手行为约束，分自律层（提示词）和 he 律层（钩子） |
| **总控 / OWNER** | 群里负责调度的角色，独占讨论结束权；OWNER 也可指人类用户 |
| **质检** | 验收任务卡输出的角色，是 `done` 状态的唯一合法切换者 |
| **阻塞上报（blocked）** | 助手主动声明"我做不下去了"的机制，触发总控接管或人类介入 |
| **群即项目** | 一个群对应一个项目工作目录，文件/任务卡/助手记忆三层隔离 |
| **injectGroupHistory** | 加助手到群时是否把历史群消息注入其上下文（控制上下文污染） |
| **触发模式** | 自动模式：助手 @ 触发其他助手；手动模式：仅作提及不触发 |
| **默认接收助手** | 群主发送未 @ 任何人的消息时，自动 @ 该助手（兜底）|
| **聚合窗口** | 总控派单后，在一定窗口内收齐所有交付再一次性汇总，防扇出风暴 |
| **客观验收 / verifications** | 不依赖 LLM 判断，跑脚本/测试/校验文件 hash 确认任务真完成 |
| **自律层 / he 律层** | 自律层：写提示词的鼓励性规则；he 律层：消息总线钩子的强制规则 |
| **风险等级** | 动作分 low / medium / high，决定是否需要人类前置确认 |
| **权限模式** | 群级别开关：plan / normal / acceptEdits / bypass，控制自动化程度 |
| **快速对话（Quick Chat）** | 跳过建群直接 1v1 与某助手聊，本质是 isQuickChat=true 的特殊群 |
| **群级 Cron** | 在群里挂定时任务，到点向群发一条消息触发指定助手 |
| **WorkDir** | 工作目录，三层策略：群级共享 / 助手默认 / 快速对话独立 |
| **流式思考链（streamingThinking）** | 模型 reasoning 内容实时展示 |
| **执行记录（executionRecords）** | 每条消息背后的完整执行链路（提示词、工具调用、token 用量等）|
| **上下文检视（contextInfo）** | 查看助手当前实际能看到的上下文 |

---

## B. 关键 Schema

### B.1 LLM Provider

```yaml
provider:
  id: prov-001
  name: "我的 Anthropic"
  type: custom                  # anthropic / openai / deepseek / custom
  api_protocol: anthropic       # 协议类型
  api_url: https://api.anthropic.com
  api_key: sk-ant-...
  model: claude-sonnet-4-6
  is_active: true
  is_default: false
  stats:                        # 使用统计
    total_tokens: 0
    total_cost: 0
```

### B.2 助手（Agent）

```yaml
agent:
  id: agt-001
  name: 工程师A
  description: 主力实现助手
  agent_level: normal           # system | normal
  category_id: cat-dev          # 分类 id（可选）
  avatar: ...
  avatar_color: "#3B82F6"

  # 模型配置
  model_ref: prov-001
  model_strategy:               # 计划增强（T12）
    primary: prov-001
    fallback_simple: prov-haiku
    fallback_complex: prov-opus
    decision_rule: by_task_complexity

  # 提示词
  system_prompt: |
    你是工程师A，负责按任务卡实现需求。
    严格遵守 out_of_scope，遇到边界问题上报阻塞。

  # 技能（已实现）
  skills:
    - slug: react
      version: "1.2.0"
      install_mode: symlink     # copy | symlink | external
    - slug: nodejs-backend
      version: "0.5.0"

  # 工具白名单（计划增强 T6）
  tools:
    - read_file
    - write_file
    - edit_file
    - run_command
    - update_task_status
  # 没列出的工具该助手无法调用

  # 工作目录
  default_work_dir: ~/projects   # 助手默认目录（可选）

  # 状态
  is_active: true
```

### B.3 群（ChatRoom）

```yaml
chat_room:
  id: room-001
  name: 我的博客重构
  description: 升级首页 SSR + 加深色模式
  work_dir: /Users/.../projects/my-blog
  is_pinned: false
  is_quick_chat: false

  # 群规则
  rules:
    self_discipline:           # 自律层（注入提示词）
      - 回复简洁，不闲聊
      - 用中文交流
    he_discipline:             # he 律层（消息总线 hook，计划增强 T8）
      - id: must_have_task_id
        priority: 100
        when: pre_message_send
        match:
          speaker_role: [MEMBER]
          speaker_level: normal
        check: "msg.contains_task_id || msg.is_meta"
        on_fail:
          action: reject
          hint: "回复必须带任务卡 id（除元讨论外）"
      - id: no_at_on_done
        priority: 200
        when: pre_message_send
        match:
          content_pattern: "(完成|已交付|搞定|完毕)"
        check: "msg.mentions.length === 0"
        on_fail:
          action: reject
          hint: "完成型回复请走任务卡状态变更，不要 @ 总控"

  # 触发模式
  trigger_mode: auto             # auto | manual
  default_recipient: agt-002     # 用户无 @ 时的默认接收助手

  # 权限模式（计划增强 T7）
  permission_mode: normal        # plan | normal | acceptEdits | bypass

  # 成员
  members:
    - chat_room_agent_id: cra-001
      agent_id: agt-002          # 总控
      role: MEMBER
      inject_group_history: true
    - chat_room_agent_id: cra-002
      agent_id: agt-001          # 工程师A
      role: MEMBER
      inject_group_history: true
    - user_id: usr-001            # 群主（人类）
      role: OWNER

  # 关联
  task_cards: []
  cron_tasks: []
```

### B.4 任务卡（Task Card）

```yaml
task_card:
  id: TC-001
  chat_room_id: room-001
  title: "实现登录页 SSO 按钮"
  description: 详细描述（可选）

  # 责任分配
  owner: agt-001               # 工程师A
  reviewer: agt-003            # 质检
  status: in_progress          # todo | in_progress | blocked | in_review | done

  # 复杂度（计划增强 T12）
  complexity: medium           # low | medium | high

  # 做什么
  steps:
    - 在 /login 加 OAuth 按钮组件
    - 接通 /api/oauth/callback
    - 加单元测试
  step_progress:               # 计划增强 T11
    current_step: 2
    sub_progress: "已实现 callback 路由，正在写参数校验"
    last_updated: 2026-05-09T14:30:00Z

  # 怎么算完成（自然语言，给人看）
  expected_output:
    - 文件：src/pages/Login.tsx 包含 SSOButton
    - 测试：login.test.ts 全部通过
    - 截图：登录页含 Google / GitHub 按钮

  # 客观验收（计划增强 T5）
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

  # 边界（防越界关键）
  out_of_scope:
    - 不改注册流程
    - 不调整后端 OAuth provider 配置

  # 文件锁（计划增强 T3）
  related_files:
    - path: src/pages/Login.tsx
      mode: write              # write 独占 / read 共享
    - path: src/api/oauth.ts
      mode: read

  # 决策日志（计划增强 T11）
  decisions:
    - time: 2026-05-09T14:00:00Z
      question: 用 OAuth 库还是手写
      chosen: 用 next-auth
      reason: 项目已有 next-auth 依赖
      alternatives_rejected:
        - {option: 手写, reason: 增加维护成本}

  # 阻塞
  blockers: []                 # 状态为 blocked 时填

  # 心跳（计划增强 T10）
  last_active_at: 2026-05-09T14:30:00Z
  heartbeat_interval: 5min

  # git 绑定（计划增强 T3）
  git_branch: task-card/TC-001

  # 回归测试（计划增强 T14）
  regression_tests:
    - npm test login.test.ts
    - npm test e2e/login-sso.spec.ts

  # 历史可追溯
  history:
    - time: 2026-05-09T13:00:00Z
      actor: agt-002           # 总控
      event: created
    - time: 2026-05-09T13:05:00Z
      actor: agt-001           # 工程师A
      event: in_progress       # 接单
    - time: 2026-05-09T15:00:00Z
      actor: agt-001
      event: in_review         # 交付
      evidence:
        verifications_passed: 3/3
        diff_hash: abc123
        test_log_url: ./.task-cards/TC-001/test.log
        screenshot_url: ./.task-cards/TC-001/screenshot.png
```

### B.5 群规则 hook（he 律层）

```yaml
hook:
  id: no_at_on_done
  description: 完成型回复禁止 @ 任何人（防扇出风暴）
  priority: 200
  when: pre_message_send
  match:
    speaker_role: [MEMBER]
    content_pattern: "(完成|已交付|搞定)"
  check: "msg.mentions.length === 0"
  on_fail:
    action: reject              # reject | warn | log
    hint: "完成型回复请走任务卡状态变更，不要 @ 总控。"
```

事件点（when）枚举：
- `pre_message_send` —— 消息发送前
- `post_message_send` —— 消息发送后
- `pre_tool_use` —— 工具调用前
- `post_tool_use` —— 工具调用后
- `pre_state_transition` —— 任务卡状态切换前
- `round_count_changed` —— 轮次变化时

### B.6 风险等级 + 权限模式

```yaml
# 工具的风险等级（平台内置 + skill 自报）
tool_risk_levels:
  read_file: low
  list_directory: low
  web_search: low
  write_file_new: low           # 写新文件
  write_file_overwrite: medium  # 覆盖已有
  edit_file: medium
  run_command_readonly: low     # 如 ls / grep
  run_command_shell: medium
  run_command_destructive: high # 如 rm
  git_commit: medium
  git_push: high
  call_paid_api: high
  delete_file: high

# 群级权限模式
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

### B.7 群级 Cron 任务

```yaml
cron_task:
  id: cron-001
  chat_room_id: room-001
  name: 每日竞品扫描
  description: 每天 9 点查竞品动态

  # 调度
  schedule_type: preset          # preset | interval | cron | once
  cron_expression: "0 9 * * *"   # 标准 cron
  # 或 preset: 每天 9:00
  # 或 interval_minutes: 60
  # 或 once_at: 2026-05-15T15:00:00Z

  # 执行内容
  execution_content: "爬一下竞品本周更新并总结"
  auto_mention_agent: agt-005    # 自动 @ 资料员

  # 行为
  enabled: true
  max_retries: 3
  next_run_at: 2026-05-10T09:00:00Z
  last_run_at: 2026-05-09T09:00:00Z

  # 历史
  executions:
    - id: exe-001
      ran_at: 2026-05-09T09:00:00Z
      duration_ms: 12000
      status: success
      triggered_message_id: msg-...
```

### B.8 文件变更事件（计划增强 T4）

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
      diff_summary: "新增 SSOButton 组件，调整布局"
      lines_added: 12
      lines_removed: 8
      diff_url: ./.task-cards/TC-001/diffs/login.diff
```

### B.9 助手在群内的设置（chat_room_agent）

```yaml
chat_room_agent:
  id: cra-001
  chat_room_id: room-001
  agent_id: agt-001
  role: MEMBER                   # OWNER（仅用户） | MEMBER

  # 上下文控制
  inject_group_history: true     # 是否注入群历史

  # 群级覆盖（可选）
  override_system_prompt: ""     # 在群里临时改提示词
  override_model: null           # 在群里临时换模型

  # 状态
  status: idle                   # idle | typing | executing | error
  queue_count: 0                 # 排队待处理消息数
```

---

## C. API 端点速查

> 本节已根据实际代码（`server/src/gateway/`）校对。完整参数说明见 [09-api-reference.md](09-api-reference.md)。  
> ⚠️ 消息发送、标已读、未读数等走 **Socket.io**，不是 REST 端点。

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
POST   /llm-providers/parse-config       # 粘贴文本一键解析
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
PATCH  /agents/:id/status                # 激活/停用（非 GET）
POST   /agents/:id/clear-context
PUT    /agents/sort-order
POST   /agents/optimize-prompt
POST   /agents/optimize-prompt-stream    # 流式

# 快速对话
POST   /agents/quick-chat
GET    /agents/:agentId/quick-chat-rooms
GET    /agents/:agentId/quick-chat-count

# 在 agent.gateway.ts 中的群/执行相关
GET    /chatrooms/:chatRoomId/agents/:agentName/debug
GET    /chatrooms/:chatRoomId/agents/:agentId/executions
GET    /chatrooms/:chatRoomId/quick-chat-session      # GET 非 POST
```

### C.3 Skill
```
GET    /skills/search                              # ClawdHub 搜索
GET    /skills/shared                             # 共享 skill 列表
POST   /skills/create                             # 创建到共享目录
POST   /skills/symlink                            # symlink 安装到助手
DELETE /skills/symlink                            # 删除 symlink
GET    /skills/:slug                              # skill 详情
GET    /skills/external                           # 外部 skill 目录

# 助手级 skill（路径含 agentId）
POST   /agents/:agentId/skills/discover           # 发现 GitHub 仓库中的 skill
POST   /agents/:agentId/skills/install-selected   # 安装选中 skill
POST   /agents/:agentId/skills/install            # 安装单个 skill
GET    /agents/:agentId/skills                    # 助手已安装 skill 列表
DELETE /agents/:agentId/skills/:slug              # 卸载 skill
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

# 群成员（无独立成员列表端点，成员含在 GET /chatrooms/:id 响应内）
POST   /chatrooms/:id/agents                         # 添加成员
DELETE /chatrooms/:id/agents/:agentId                # 移除成员
PATCH  /chatrooms/:id/agents/:agentId/settings       # 更新成员设置
POST   /chatrooms/:id/agents/:agentId/clear-context  # 清空上下文
GET    /chatrooms/:id/agents/:agentId/context        # 查看上下文
GET    /chatrooms/:id/agents/:agentId/tasks          # 助手任务队列
GET    /chatrooms/:id/tasks/board                    # 任务看板（所有助手）

# 群级 Cron
GET    /chatrooms/:chatRoomId/cron-tasks
POST   /chatrooms/:chatRoomId/cron-tasks
```

### C.5 Message
```
GET    /messages                    # ?chatRoomId= 过滤
GET    /messages/:id
GET    /messages/:id/execution      # 关联执行记录
DELETE /messages/chatroom/:chatRoomId  # 清空群聊消息
DELETE /chatrooms/:chatRoomId/agents/:agentId/executions  # 清空执行记录

# ⚠️ 消息发送走 Socket.io（socket event: message），无 REST POST 端点
# ⚠️ 未读数更新走 Socket.io（event: unread:update），无 REST 端点
```

### C.6 Cron Task
```
GET    /cron-tasks/:taskId
PUT    /cron-tasks/:taskId
DELETE /cron-tasks/:taskId
PATCH  /cron-tasks/:taskId/enable
GET    /cron-tasks/:taskId/executions
POST   /cron-tasks/:taskId/test

# ⚠️ 无独立 /tasks 或 /tasks/board 端点；任务看板路径是 /chatrooms/:id/tasks/board
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

---

## D. 已知小问题清单

> 不属于第 04 章 13 大问题，但有体感的小坑，按需修。

### D.1 UI / 体验
- [ ] 助手快速连发多条消息时，前一条还在流式输出，后一条已开始拼接，UI 顺序错乱
- [ ] 群成员超过 8 人后侧栏显示拥挤
- [ ] `quick-chat` 和正式群的切换路径不顺畅
- [ ] cron 任务失败时通知不显眼
- [ ] 多群并行执行时，未读数偶尔不准
- [ ] skill 安装后未立即在助手配置面板出现，需要刷新

### D.2 流式输出
- [ ] 助手提示词优化（optimize-prompt）跑长了会断流
- [ ] 流式 thinking 在长内容时滚动到底部不流畅

### D.3 工作目录
- [ ] Web 版无法打开本地目录（已知限制，标注清楚即可）
- [ ] 工作目录占用大时打开预览很慢

### D.4 设置 / 配置
- [ ] LLM Provider 配置错误时，错误提示不明确
- [ ] 移动端连接的二维码在某些显示器上扫描困难（解析问题）

### D.5 数据 / 同步
- [ ] 服务断开重连后，部分消息可能重复显示
- [ ] 多设备切换时未读数同步有延迟

---

## E. 参考资料

### E.1 内部文档（按时间）
- `ai-team-platform-design.md` —— v1 头脑风暴稿（2026-05-09）
- `ai-team-platform-master.md` —— v2 单体主文档（2026-05-09）
- 本套 `01-07.md` —— v3 拆分版主文档（2026-05-09）

### E.2 竞品文档参考
- Claude Code 官方文档（hooks / skills / permission mode）
- Cursor docs（auto mode）
- Aider docs（git workflow / weak-model）
- Devin / SWE-agent / OpenHands 论文
- CrewAI / AutoGen / LangGraph / MetaGPT 官方文档
- Dify / Coze 产品页

### E.3 相关研究方向
- Multi-agent reinforcement learning
- LLM-based agent planning
- Tool use & function calling
- Long-context retrieval / agentic RAG
- Software engineering agent benchmarks (SWE-bench, HumanEval-X)
