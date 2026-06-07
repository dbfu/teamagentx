# Requirements Document: bridge-platform-commands

**Generated**: 2026-05-19
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 根据各频道对指令的支持情况，提供对各频道的指令支持。比如电报可以快捷艾特群助手，清空群消息等

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| Telegram Bot | `setMyCommands` API 注册指令 → 用户输入 `/` 时原生 UI 展示菜单 | 注册-发现-执行三段式；命令必须注册才可发现 |
| Slack App | slash commands 通过 App 配置注册，触发时 POST webhook 到 App | 指令与普通消息分离处理；必须在 3s 内响应或返回 200 延迟回复 |
| Discord Bot | `/command` 通过 application commands API 全局/服务器注册 | 支持参数类型声明；选项补全（autocomplete） |

### 用户心智模型

Telegram/Discord 用户默认期望：在任何 Bot 中输入 `/` 就能看到可用指令菜单，选择即执行，不需要记忆命令名。企微/钉钉/飞书用户无此期望，习惯通过 @机器人 + 自然语言交互。

### 行业惯例

1. **Telegram**: bot 必须通过 `setMyCommands` 注册指令，否则用户无从发现（原生 UX 约束）
2. 指令执行后必须有明确反馈消息，silent fail 是最差的用户体验
3. 指令名称全小写，使用下划线分隔（Telegram API 强制要求）
4. 各平台能力差异应在服务端处理，外部用户无需感知平台差异

### 已知反模式

- **能力过度承诺**：在不支持原生菜单的平台（企微/钉钉）也模拟 Telegram 风格的菜单 → 体验割裂，不如直接处理文本指令
- **Silent fail**：指令执行失败（agent 不存在、清空失败）不回复任何消息 → 用户以为消息丢失
- **跨平台行为不一致**：`/clear` 在 Telegram 有效，在企微无反应 → 用户困惑

### 认知复杂度上限（基准）

- Telegram 原生：2 步（输入 `/` → 从菜单选 → 执行），0 个需要记忆的命令名
- 其他平台文本指令：3 步（知道有 `/help` → 输入 → 看到指令列表 → 执行目标指令）

---

## 三、可行性 & 假设清单

### 假设清单

| # | 假设 | 风险 if Wrong | 置信度 |
|---|---|---|---|
| 1 | Telegram setMyCommands 调用时机为 bot 创建/更新凭证时 | 命令菜单不会自动更新，需额外 trigger 机制 | High |
| 2 | 飞书/钉钉/企微/QQ 不支持与 Telegram 等价的原生命令菜单 | 若某平台后来支持，需补充注册逻辑 [推演] | Medium |
| 3 | `/clear` = 清空 AgentRoomMemory，不删除平台侧历史消息 | 若用户期望是删消息，体验差距极大 | High — 需在 /help 说明 |
| 4 | `/at agent_name` 中 agent_name 匹配现有 agentService.findByName() | 名称不匹配时需有错误反馈 | High |
| 5 | 指令响应需要 sendDirectMessage（反向发消息到平台），当前架构已支持 | 已在 bridge.service.ts 中存在，Low Risk | High |

### 技术可行性信号

- **当前栈**: Fastify + bridge.service.ts + platform-senders.ts 已有 sendDirectMessage；BridgeInboundTextAdapter 接口可扩展
- **已知阻塞点**: 无。现有 `/bind` 指令处理模式（extractBindCode）可直接复用为新指令处理的模板
- **第三方依赖**: Telegram Bot API `setMyCommands` 端点（无需额外 SDK，已有 fetch 调用模式）
- **可行性判断**: ✅ Clear path

### 依赖方识别

- **影响模块**: `platform-inbound-adapters.ts`, `bridge-webhook-adapters.ts`, `bridge.gateway.ts`, `bridge.service.ts`, `platform-senders.ts`, `bridge-platform-registry.ts`
- **外部依赖**: Telegram Bot API `setMyCommands`
- **下游影响**: 所有已接入 bridge 的频道配置（无数据 migration，纯行为扩展）

### 范围边界

**In scope（本期）:**
- `/help` 指令：所有平台，列出当前群可用命令 + 群内助手名称
- `/at {agent_name}` 指令：所有平台，转换为 `@助手名` 触发对应助手
- `/clear` 指令：所有平台，清空当前 bridge 群绑定的 TeamAgentX 房间 AgentRoomMemory
- Telegram：在 bot 保存/更新凭证时调用 `setMyCommands` 注册以上 3 条指令
- 所有指令执行后通过 `sendDirectMessage` 回复确认消息

**Out of scope（本期不做）:**
- 飞书/钉钉/企微/QQ 的原生命令注册 API（若有）— 理由：能力差异大，需单独调研
- 自定义指令（让用户自定义 /mycommand）— 理由：YAGNI，当前无此需求
- 指令参数补全（autocomplete）— 理由：Telegram 支持但复杂度高，属 Excitement 级功能

**Deliberately excluded:**
- 删除平台侧历史消息 — 理由：各平台权限模型差异，且无必要（清记忆≠删消息）

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | 无 schema 变更，指令处理纯逻辑 |
| API 合约变更 | Low | BridgeInboundTextAdapter 接口扩展向后兼容 |
| 用户侧行为变更 | Low | 纯增量，不改变现有消息流转行为 |
| 下游系统影响 | Low | 仅增加指令检测分支，不影响现有消息路径 |

**整体可逆性**: Low cost

---

## 四、5W2H 全景分析

**What** — 做什么
> 为接入 TeamAgentX 的各外部平台频道（Telegram/飞书/钉钉/企微/QQ）提供平台适配的文本指令支持：`/help`（查看帮助）、`/at {agent_name}`（快捷触发助手）、`/clear`（清空助手上下文记忆）。Telegram 额外注册原生命令菜单（setMyCommands），其他平台通过文本解析支持相同指令集。

**Why** — 为什么做
> 外部用户（如 Telegram 群成员）不知道如何与 AI 助手交互，缺乏发现机制和常用操作的快捷方式，导致使用门槛高、助手上下文积累过多无关内容时无法自助清空。

**Who** — 谁来用
> 主要用户: 外部平台（Telegram/企微等）中加入了 TeamAgentX 机器人的群成员（非 TeamAgentX 注册用户）
> 次要用户: TeamAgentX 管理员（配置 bot 时触发命令注册）
> 受影响方: 服务器端 bridge 处理流程

**When** — 什么时候用
> 触发时机: 外部平台用户在群内发送以 `/` 开头的消息
> 使用频率: `/at` 高频（每次想指定助手时）；`/clear` 低频（上下文混乱时）；`/help` 低频（首次使用时）
> 时间约束: Telegram setMyCommands 在 bot 配置保存时触发 [推演]

**Where** — 在哪里用
> 使用环境: 外部 IM 平台（Telegram/飞书/钉钉/企微/QQ），用户界面由平台提供
> 入口位置: bridge 入站消息处理链（server/src/modules/bridge/ 和 server/src/gateway/bridge.gateway.ts）

**How** — 怎么做
> 核心操作路径（用户侧）:
> 1. Telegram 用户输入 `/` → 看到原生命令菜单 → 选择 `/at 工程师助手` → 助手回复
> 2. 其他平台用户输入 `/at 工程师助手` → bot 回复确认并触发助手
>
> 技术实现方向:
> - 在 `BridgeInboundTextAdapter` 扩展 `processCommand()` 方法
> - `BridgeWebhookParseResult` 新增 `kind: 'command'` 类型
> - `bridge.gateway.ts` 入站处理中拦截 command 类型，dispatch 到 commandHandler
> - Telegram adapter 增加 `registerCommands(botId)` 调用 setMyCommands

**How Much** — 做到什么程度
> 规模/量级: 每个 bridge bot 3 条注册指令；单次指令处理 < 200ms（不含外部 API 调用）
> 质量标准: 指令识别准确率 = 100%（正则精确匹配，无歧义）；Telegram setMyCommands 调用失败不影响 bot 正常收发消息
> 验收底线: 在 Telegram 中输入 `/` 可见命令菜单；`/at 助手名` 能触发对应助手回复；`/clear` 能收到确认消息且助手下一条回复不含历史记忆

---

## 五、用户角色 & 使用场景

**主要用户**: Telegram/企微群普通成员（外部平台用户）
**次要用户**: TeamAgentX 管理员

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 首次使用指引 | 用户不知道如何和 bot 交互 | 了解有哪些指令可用 | 不能要求用户登录 TeamAgentX |
| 快捷触发特定助手 | 用户想让特定助手回答，群里有多个助手 | 精准触发目标助手而不触发全部助手 | 需在 Telegram 原生菜单中可见 |
| 清空上下文 | 上一轮对话跑偏，用户想让助手从头开始 | 清除助手历史记忆，重新开始 | 不删除平台侧消息记录 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 首次使用指引 | 外部用户完全不知道 bot 支持什么操作，只能乱试 [推演] | `/help` 列出所有可用命令和助手名，用户 0 培训上手 | 用户学习成本高，留存率低 |
| 快捷触发特定助手 | 用户需要手动输入 `@工程师助手 我的问题`，记忆助手全名，体验割裂 [推演] | Telegram 原生菜单 `/at` 可选，其他平台文本 `/at` 同等可用，触发精准 | 用户无法在 IM 中高效使用多助手群，功能折损 |
| 清空上下文 | 当前无法自助清空 bridge 群的助手记忆，需 TeamAgentX 管理员操作 | 用户自助 `/clear` 立即生效，30 秒内获得全新助手会话 | 用户感知助手"变傻了"无法自救，体验差 |

**价值可信度**: ⚠️ 基于合理推断（类似产品经验），无实际用户数据支撑

---

## 七、标准用户故事 & 验收标准

### Story 1 — 查看帮助

**User Story**: 作为 Telegram 群成员，我想要发送 `/help` 查看所有可用指令，以便了解如何与 bot 互动。

**Acceptance Criteria**:
- [ ] AC1: When 用户在任意平台 bridge 群发送 `/help`，the system shall 向该用户/群回复包含所有可用指令名称和一句话说明的文本消息，通过 sendDirectMessage 在同一平台发送。
- [ ] AC2: When `/help` 回复内容中，the system shall 列出当前 TeamAgentX 房间内所有 isActive=true 的助手名称。
- [ ] AC3: When `/help` 识别失败（sendDirectMessage 网络错误），the system shall 记录错误日志，不抛出异常影响其他消息处理。
- [ ] AC4: When 消息内容是 `/HELP` 或 `/Help`（大小写变体），the system shall 等同于 `/help` 处理。

**Out of scope for this story**: 分平台展示不同格式的帮助内容

---

### Story 2 — 快捷触发助手

**User Story**: 作为 Telegram 群成员，我想要通过 `/at 工程师助手 我的问题` 快捷触发特定助手，以便不用手动输入 @助手名。

**Acceptance Criteria**:
- [ ] AC1: When 用户发送 `/at {name} {content}`，the system shall 将消息内容转换为 `@{name} {content}`，并经过正常的 parseMentions + agent 路由流程触发对应助手。
- [ ] AC2: When `/at` 后跟的助手名在 agentService.findByName() 中找不到（大小写不敏感匹配后仍无结果），the system shall 通过 sendDirectMessage 回复"❌ 未找到助手：{name}，请检查名称或发送 /help 查看可用助手"。
- [ ] AC3: When 用户仅发送 `/at`（无助手名），the system shall 回复"❌ 用法：/at 助手名 [消息内容]"。
- [ ] AC4: When 在 Telegram 中，用户在原生菜单输入 `/at`，the system shall 展示已注册的命令描述（通过 setMyCommands 预注册实现，不属于实时行为）。
- [ ] AC5: When `/at` 指令中的助手不是当前房间成员（isAgentMember 为 false），the system shall 回复"❌ 助手 {name} 不在当前群聊中"。

**Out of scope for this story**: `/at` 命令的参数自动补全（Telegram autocomplete）

---

### Story 3 — 清空上下文记忆

**User Story**: 作为企微群成员，我想要发送 `/clear` 清空 AI 助手的上下文记忆，以便让助手从头开始对话。

**Acceptance Criteria**:
- [ ] AC1: When 用户发送 `/clear`，the system shall 删除该 bridge 群绑定的 TeamAgentX chatRoomId 下所有 AgentRoomMemory 记录，并通过 sendDirectMessage 回复"✅ 助手上下文记忆已清空，下次对话将重新开始"。
- [ ] AC2: When `/clear` 执行时数据库操作失败，the system shall 回复"❌ 清空失败，请稍后重试"，并记录错误日志。
- [ ] AC3: When 房间内没有任何 AgentRoomMemory 记录（本已为空），the system shall 同样回复"✅ 助手上下文记忆已清空"（幂等）。
- [ ] AC4: When `/clear` 操作，the system shall 在 1500ms 内（含数据库操作 + 回复发送）完成响应，超时则记录日志不重试。

**Out of scope for this story**: 清空消息记录（Message 表）；清空 TaskQueue

---

### Story 4 — Telegram 原生命令菜单注册

**User Story**: 作为 TeamAgentX 管理员，我想要在保存 Telegram bot 配置时自动注册指令菜单，以便群成员输入 `/` 时可见可用指令。

**Acceptance Criteria**:
- [ ] AC1: When 管理员通过 API 创建或更新 Telegram bot 的凭证（botToken），the system shall 在凭证验证成功后调用 Telegram Bot API `setMyCommands`，注册 `/help`、`/at`、`/clear` 三条指令（附一句话描述）。
- [ ] AC2: When `setMyCommands` API 调用失败（网络错误/Token 无效），the system shall 记录警告日志，不影响 bot 创建/更新的主流程结果（非阻塞）。
- [ ] AC3: When `setMyCommands` 调用时，scope 为 `BotCommandScopeAllGroupChats`，the system shall 确保命令仅对群组生效（不污染私聊默认命令）。

**Out of scope for this story**: 删除 bot 时调用 deleteMyCommands；per-chat 命令注册

---

### Decision Log

| 决策 | 备选方案 | 选择理由 |
|---|---|---|
| `/clear` = 清空 AgentRoomMemory，不删平台消息 | 同时删平台侧消息 | 删平台消息需特殊权限，且各平台 API 差异大；用户需求核心是"助手记忆重置" |
| 指令统一以 `/` 开头，不区分平台 | 各平台用不同触发词 | 降低用户认知负担；`/` 是 IM bot 指令的行业惯例 |
| setMyCommands 在 bot 配置保存时触发 | 启动时/定时触发 | 与 bot 生命周期强绑定，配置即生效，无需额外任务 |
| `/at` 转换为 `@AgentName` 再经 parseMentions | 直接绕过 parseMentions 直接 dispatch | 复用现有路由逻辑，不引入新的 dispatch 路径 |
| 指令回复通过 sendDirectMessage（反向推送）| 回复存到 TeamAgentX 消息表再广播 | 指令响应是系统消息，不应污染 bridge 群的 AI 对话记录 |

---

## 八、5Why 根因挖掘

**Surface requirement**: 为各频道提供平台指令支持

**Why 1**: 为什么需要指令？
> Because: 外部用户不知道如何与 bridge 群里的 AI 助手有效互动

**Why 2**: 为什么用户不知道如何互动？
> Because: 没有任何发现机制（Telegram 原生期望有 `/` 菜单，但 bot 从未注册命令）；群里可能有多个助手，用户不知道要 @哪个

**Why 3**: 为什么发现机制缺失和多助手选择困难？
> Because: TeamAgentX 从 Web 端设计（用户在 Web UI 能看到助手列表），bridge 接入是后来叠加的，没有把"可发现性"带到外部平台

**Why 4**: 为什么"可发现性"没被带入外部平台？
> Because: bridge 初期目标是"消息透传"，指令体验是更高层的产品能力，不属于基础联通

**Why 5**: 为什么现在是补齐这个能力的时机？
> Because: bridge 基础能力已稳定，现在是从"能用"到"好用"的迭代节点；外部用户数量增加，使用体验直接影响产品口碑

**Root Insight**: bridge 接入初期只解决了"消息能传"，现在需要解决"用户能用好"——可发现性和快捷操作是把外部平台用户从"偶尔尝试"变成"日常使用"的关键。

**Implication for design**: 本次实现的 3 个指令（help/at/clear）正好对应"发现、使用、维护"三个核心操作，方向正确，无偏移。

---

## 九、Kano 需求分类

### Basic Requirements（用户默认期望）

- **指令执行有明确回复反馈** — 所有 bot 平台的基础惯例；无回复等于 silent fail，直接扣分
- **`/help` 指令可用** — Slack/Telegram 等主流平台所有 bot 必备

### Performance Requirements（做得越好越满意）

- **`/at` 的助手名匹配准确率** — 匹配越宽松（模糊匹配）越好；当前精确匹配是底线
- **指令响应速度** — 越快越好；目标 < 1500ms

### Excitement Requirements（超预期惊喜）

- **Telegram 原生命令菜单** — 外部用户不期待第三方 bot 有原生菜单，有了会惊喜
  - ⚠️ Benchmark check: 成熟 Telegram bot（如 OpenAI bot）均已实现，已是"行业标配"，reclassify → Basic for Telegram users

### Indifferent / Reverse

- **指令参数自动补全（autocomplete）** — Indifferent，大多数用户不感知此功能 → Deferred

### Kano-MoSCoW Alignment Check

| Kano Type | Expected MoSCoW | 实际分类 | 状态 |
|---|---|---|---|
| Basic | Must | `/help`, `/at`, `/clear` 指令处理 | ✅ 对齐 |
| Basic (Telegram) | Must | Telegram setMyCommands | ✅ 对齐 |
| Performance | Should | 助手名模糊匹配 | Should |
| Excitement→Basic | Must | Telegram 原生菜单 | ✅ 已重分类 |
| Indifferent | Won't | autocomplete | ✅ Deferred |

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | Requirement | Evidence |
|---|---|---|
| M1 | 所有平台入站消息识别 `/help` `/at {name}` `/clear` 三条指令（大小写不敏感） | 用户无发现机制（根因分析）；行业惯例 |
| M2 | 指令执行后通过 sendDirectMessage 向发送平台回复结果消息 | 行业惯例：bot 无回复 = silent fail |
| M3 | Telegram bot 保存/更新凭证时自动调用 setMyCommands 注册三条指令 | Telegram 官方文档；成熟 Telegram bot 均已实现（竞品） |
| M4 | `/at {name}` 将消息转换为 `@{name} {content}` 经正常路由触发助手 | 用户显式需求（原始需求："快捷艾特群助手"） |
| M5 | `/clear` 删除当前 chatRoomId 的全部 AgentRoomMemory 记录 | 用户显式需求（原始需求："清空群消息/上下文"）；无管理员入口的自助清空场景 |

### Should（应该做）

| # | Requirement | Why Not Must |
|---|---|---|
| S1 | `/at` 助手名支持模糊匹配（去除空格、大小写、全半角统一） | 精确匹配可满足基本需求；模糊匹配提升体验但非核心 |
| S2 | `/help` 回复内容包含群内当前活跃助手列表 | 无助手列表时 help 仍然有效；查询助手列表有额外 DB 开销 |
| S3 | `/clear` 同时重置 TaskQueue 中 pending 任务 | 当前无明确用户痛点；需评估清空 queue 的副作用 |

### Could（可做可不做）

| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | 飞书/钉钉/企微/QQ 若有原生命令注册 API，调用注册 | 目前未确认各平台支持；Telegram 已满足核心场景 |
| C2 | `/status` 指令：查看当前助手执行状态（idle/busy） | 有价值但不在原始需求；等用户提出后加 |

### Won't（本期不做）

| # | Requirement | Decision Reason |
|---|---|---|
| W1 | 删除外部平台历史消息 | 各平台权限模型差异极大；核心需求是清记忆，非删消息 |
| W2 | 自定义指令（用户自定义 /mycommand） | YAGNI：无当前需求，过度设计 |
| W3 | 指令参数 autocomplete | Indifferent 级别；Telegram 支持但实现复杂度高 |
| W4 | Telegram 删除 bot 时调用 deleteMyCommands | 影响范围小；bot 删除后 token 失效，命令自然失效 |

---

## 十一、功能详细需求定义

### 功能 1：入站指令识别与路由

**功能描述**
> 在 bridge 入站消息处理链中，识别以 `/` 开头的已知指令，将其路由到指令处理器而不是正常的 AI 消息路由。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| text | string | 是 | 经过 normalizeText() 处理后的消息文本 | 来自各平台 webhook 解析结果 |
| chatRoomId | string | 是 | UUID | bridge 绑定的 TeamAgentX 房间 ID |
| botId | string | 是 | UUID | 当前 bridge bot ID |
| platform | Platform | 是 | telegram/feishu/dingtalk/wecom/qq | 来源平台 |

**处理逻辑**
1. 检查 text.trim() 是否匹配 `/help`（大小写不敏感）
2. 检查是否匹配 `/at {name} [{content}]`（正则：`^\/at\s+(\S+)(?:\s+(.+))?$`，大小写不敏感）
3. 检查是否匹配 `/clear`（大小写不敏感）
4. 如果匹配任意一条：返回 `{ kind: 'command', commandType, params }` 而非 `kind: 'message'`
5. 如果不匹配：继续走现有 `kind: 'message'` 路径（不影响现有逻辑）

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 识别为已知指令 | `{ kind: 'command', commandType: 'help'|'at'|'clear', params: { agentName?, content? } }` | BridgeWebhookParseResult 新增类型 |
| 不是已知指令 | 原有 `{ kind: 'message', ... }` | 不变 |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| text 为 `/at`（无 agent name） | 识别为 `at` 指令，params.agentName = undefined，后续返回用法错误提示 |
| text 为 `/CLEAR` 或 `/Clear` | 等同 `/clear` 处理（toLowerCase 后匹配） |
| text 为 `/unknown_command` | 不匹配任何指令，走正常 message 路径（透传给 AI 助手） |
| 并发多条指令消息 | 各自独立处理，无共享状态依赖 |

**依赖关系**
- 依赖: `BridgeWebhookAdapter.parse()` 先完成 webhook 解析（提供 text, chatRoomId 等）
- 被依赖: `bridge.gateway.ts` 调用此识别逻辑后 dispatch 到对应指令处理器

---

### 功能 2：`/help` 指令处理

**功能描述**
> 获取当前房间内活跃助手列表，组装帮助文本，通过 sendDirectMessage 回复到来源平台。

**输入**
| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID | 查询助手列表用 |
| botId | string | 是 | UUID | 发回消息用 |
| externalId | string | 是 | 平台侧群 ID | sendDirectMessage 的目标 |
| platform | Platform | 是 | — | 发送时选择对应 sender |

**处理逻辑**
1. 查询 `chatRoomAgentService.listAgents(chatRoomId)` 获取 isActive=true 的助手名称列表
2. 组装回复文本：
   ```
   🤖 可用指令：
   /help - 查看帮助
   /at {助手名} [消息] - 快捷触发指定助手
   /clear - 清空助手上下文记忆

   当前群助手：{助手名1}、{助手名2}...
   ```
3. 调用 `bridgeService.sendDirectMessage(platform, botId, externalId, text)`

**输出**
| 情况 | 输出内容 |
|---|---|
| 成功 | sendDirectMessage 执行，平台收到帮助文本 |
| 无活跃助手 | 仍发送帮助文本，助手列表行显示"（当前无活跃助手）" |
| sendDirectMessage 失败 | 记录 error 日志，不抛出异常 |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 助手列表为空 | 回复正常帮助文本，助手列表行为空提示 |
| 数据库查询超时 | 仍发送不含助手列表的帮助文本 |

---

### 功能 3：`/at` 指令处理

**功能描述**
> 将 `/at {agent_name} {content}` 转换为 `@{agent_name} {content}`，触发对应助手的正常消息路由。

**输入**
| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| agentName | string | 是 | 非空字符串 | 从指令解析出的助手名 |
| content | string | 否 | 任意字符串 | `/at 助手名` 后面的消息内容 |
| 其他消息上下文 | — | 是 | — | chatRoomId, botId, externalId, platform, userId |

**处理逻辑**
1. 若 agentName 为空 → 回复用法错误，结束
2. 调用 `agentService.findByName(agentName)`（大小写不敏感）
3. 若 agent 不存在 → 回复"❌ 未找到助手：{agentName}"，结束
4. 调用 `chatRoomService.isAgentMember(chatRoomId, agent.id)`
5. 若不是成员 → 回复"❌ 助手 {agentName} 不在当前群聊中"，结束
6. 构造新消息文本 = `@{agent.name} ${content ?? ''}`.trim()
7. 将消息替换原 text，继续走正常 receiveBridgeMessage 路径（`kind: 'message'`）

**输出**
| 情况 | 输出内容 |
|---|---|
| 成功 | 触发正常 AI 路由，助手回复（不额外发确认消息，助手的回复即是反馈） |
| agentName 为空 | sendDirectMessage: "❌ 用法：/at 助手名 [消息内容]" |
| agent 不存在 | sendDirectMessage: "❌ 未找到助手：{agentName}，发送 /help 查看可用助手" |
| agent 不在房间 | sendDirectMessage: "❌ 助手 {agentName} 不在当前群聊中" |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| agentName 包含 @ 符号（如 `/at @工程师助手`） | 去除 @ 后匹配，等同 `/at 工程师助手` |
| content 为空（`/at 工程师助手`）| 触发助手，消息内容为空字符串（助手收到空消息，由助手自行处理） |
| 并发 `/at` 指令 | 各自独立路由，无共享状态 |

**依赖关系**
- 依赖: agentService.findByName()；chatRoomService.isAgentMember()；receiveBridgeMessage 路径
- 被依赖: 无

---

### 功能 4：`/clear` 指令处理

**功能描述**
> 清空当前 bridge 群绑定的 TeamAgentX chatRoom 内所有 AgentRoomMemory 记录，并回复确认消息。

**输入**
| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID | 需清空的房间 ID |
| botId | string | 是 | UUID | 回复消息用 |
| externalId | string | 是 | 平台侧群 ID | 回复目标 |
| platform | Platform | 是 | — | 选择发送器 |

**处理逻辑**
1. 调用 `prisma.agentRoomMemory.deleteMany({ where: { chatRoomId } })`
2. 成功 → 调用 `sendDirectMessage` 回复"✅ 助手上下文记忆已清空，下次对话将重新开始"
3. 失败 → 调用 `sendDirectMessage` 回复"❌ 清空失败，请稍后重试"，记录 error 日志

**输出**
| 情况 | 输出内容 |
|---|---|
| 成功 | sendDirectMessage: "✅ 助手上下文记忆已清空，下次对话将重新开始" |
| 数据库失败 | sendDirectMessage: "❌ 清空失败，请稍后重试" + error log |
| 本已无记忆（0条删除） | 同成功（幂等） |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| chatRoomId 不存在（绑定关系已失效） | deleteMany 返回 0，视为成功，正常回复 |
| sendDirectMessage 在回复时失败 | 记录 warn 日志，不重试（避免重复发送） |
| 操作超过 1500ms | 记录 warn 日志，不影响后续消息处理 |

**依赖关系**
- 依赖: prisma.agentRoomMemory（已存在的 Prisma 模型）；bridgeService.sendDirectMessage()
- 被依赖: 无

---

### 功能 5：Telegram 命令注册（setMyCommands）

**功能描述**
> 在 Telegram bot 凭证验证成功后，调用 Bot API `setMyCommands` 注册三条指令到原生命令菜单。

**输入**
| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| botToken | string | 是 | Telegram bot token 格式 | 用于 API 鉴权 |
| scope | object | 否 | BotCommandScopeAllGroupChats | 固定为群组 scope |

**处理逻辑**
1. 调用 `POST https://api.telegram.org/bot{token}/setMyCommands`
2. body: `{ commands: [{command:"help", description:"查看帮助"}, {command:"at", description:"触发指定助手：/at 助手名 [消息]"}, {command:"clear", description:"清空助手上下文记忆"}], scope: {type:"all_group_chats"} }`
3. 成功（HTTP 200 ok:true）→ 记录 info 日志，继续
4. 失败（非 200 / ok:false）→ 记录 warn 日志（含 status 和 response body 前 200 字），**不影响主流程**

**输出**
| 情况 | 输出内容 |
|---|---|
| 成功 | info log；无用户侧反馈 |
| 失败 | warn log；bot 创建/更新 API 正常返回成功 |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| botToken 已注销/无效 | Telegram 返回 401，warn log，主流程不受影响 |
| 网络超时 | 设 5000ms 超时，超时后 warn log，主流程继续 |
| 重复调用（更新凭证时） | setMyCommands 是幂等的，安全重复调用 |

**触发时机**: `validateBridgeCredentials('telegram', ...)` 调用成功后（已在 bridge.service.ts 中），或在 bot 创建/更新 API handler 中调用 `registerTelegramCommands(botToken)` [推演：具体 hook 位置待实现时确认]

**依赖关系**
- 依赖: Telegram Bot API 可访问；validateBridgeCredentials() 完成（有效 token）
- 被依赖: 无

---

## 十二、非功能需求

### Performance（性能）

- 指令识别：纯正则匹配，< 1ms，无性能风险
- 指令执行（help/clear）：包含 DB 查询 + sendDirectMessage，目标 < 1500ms
- setMyCommands 调用：设 5000ms 超时，异步执行不阻塞主流程
- 降级行为：sendDirectMessage 失败时仅 log，不阻塞消息处理链

### Security（安全）

- 身份认证：指令执行依赖现有 bridge 绑定关系鉴权（无绑定的消息不进入处理链）
- 授权：所有平台用户均可执行 `/clear`（设计上不限制，因为清空记忆无数据泄露风险）
- 数据敏感度：AgentRoomMemory 属于内部状态，不包含用户 PII
- 注入风险：agentName 参数通过 `findByName()` 查询，不做 SQL 拼接，无注入风险
- SSRF：sendDirectMessage 使用已有的 platform sender，不新增外部网络调用路径

### Compatibility（兼容性）

- 当前 5 个平台（telegram/feishu/dingtalk/wecom/qq）均需支持文本指令识别
- `BridgeInboundTextAdapter` 接口扩展需向后兼容（新增 processCommand 可为 optional 方法 [推演]）
- Telegram setMyCommands scope 使用 `all_group_chats`，兼容所有 Telegram 群类型
- 第三方依赖: Telegram Bot API（stable，无版本锁定风险）

### Usability（易用性）

- 无需 TeamAgentX 账号，外部平台用户直接可用
- Telegram 原生菜单：0 学习成本（输入 `/` 即见）
- 其他平台：发 `/help` 可自助发现，最多 1 步引导
- 错误消息需用中文（与目标用户群匹配），包含正确用法示例
- 无障碍：纯文本回复，不依赖图片/特殊格式

### Maintainability（可维护性）

- 指令定义集中在单一常量/类型文件，新增指令只需改一处
- 每条指令处理函数独立，可单独单测
- 日志规范：成功路径 info，预期失败（agent 不存在等）warn，非预期失败 error
- Observability：关键指令执行需记录 `[Bridge][Command]` 前缀日志，含 platform/chatRoomId/commandType

### Scalability & Extensibility（可扩展性）

- 新增指令：在指令识别常量中添加正则，新增 handler 函数，注册到 setMyCommands 列表 — 不影响现有代码
- 新增平台：`BridgeInboundTextAdapter` 实现 `processCommand()` 方法即可，无额外要求
- 配置化：三条指令的 description 文案可抽为常量，无需配置化（低优先级）

---

## 十三、架构影响分析

### Affected Modules

| Module | File/Path | Impact Type | Risk Level |
|---|---|---|---|
| Bridge 入站适配器 | `server/src/modules/bridge/platform-inbound-adapters.ts` | 接口扩展 + 各平台实现 | d=1 直接改动 |
| Webhook 解析结果类型 | `server/src/modules/bridge/bridge-webhook-adapters.ts` | BridgeWebhookParseResult 新增 kind:'command' | d=1 直接改动 |
| Bridge 网关入站处理 | `server/src/gateway/bridge.gateway.ts` | 新增指令 dispatch 分支 | d=1 直接改动 |
| Telegram 发送器 | `server/src/modules/bridge/platform-senders.ts` | 新增 registerCommands() 函数 | d=1 新增（不改现有函数） |
| Bridge 服务（可选） | `server/src/modules/bridge/bridge.service.ts` | validateBridgeCredentials 后触发注册 | d=2 行为变更 |
| Platform Registry | `server/src/modules/bridge/bridge-platform-registry.ts` | 可选：新增 supportsNativeCommands 字段 | d=3 可选扩展 |

### Data Model Changes

- 无新表/无 schema 变更
- 使用现有 `AgentRoomMemory`（deleteMany 操作）
- Migration required: **No**

### Interface Contract Changes

- **新增**: `BridgeWebhookParseResult` union 新增 `{ kind: 'command', commandType: string, params: Record<string, string> }` — 向后兼容（现有 switch/if 不处理新 kind，自然 ignore）
- **扩展**: `BridgeInboundTextAdapter` 接口新增可选方法 `processCommand?(text: string): CommandParseResult | null`
- **无 API 变更**: 所有改动在 server 内部，不影响对外 REST/Socket API

### Integration Points

- 新增外部调用: `https://api.telegram.org/bot{token}/setMyCommands`（仅 Telegram，非阻塞）
- 复用现有: `bridgeService.sendDirectMessage()`；`agentService.findByName()`；`chatRoomService.isAgentMember()`；`prisma.agentRoomMemory.deleteMany()`

### Risk Summary

| Risk | Level | Mitigation |
|---|---|---|
| BridgeWebhookParseResult 新 kind 影响现有 switch | Low | 新增分支不影响 'message'/'challenge'/'ignore' 路径 |
| setMyCommands 调用失败影响 bot 创建 | Low | 明确非阻塞，warn log 即止 |
| `/at` 转换逻辑绕过某些前置校验 | Medium | 复用 receiveBridgeMessage 完整路径，不 bypass 校验 |
| AgentRoomMemory 删除误删其他 room 数据 | Low | deleteMany 条件严格限定 chatRoomId，无跨房间风险 |

**Overall architecture risk**: **Low**

---

## 十四、认知复杂度评估

### 主流程分析（Telegram 用户使用 /at）

**步骤拆解**:
1. 用户在 Telegram 输入 `/`（触发原生菜单）
2. 从菜单选择 `/at`
3. 补充助手名和消息内容
4. 发送

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 4 | 中等 |
| 决策点 | 1（选哪个助手） | 低 |
| 新概念数量 | 1（助手名） | 低 |

**综合评级**: 低负担（Telegram）

### 主流程分析（其他平台文本指令）

**步骤拆解**:
1. 用户发送 `/help`（发现指令集）
2. 阅读帮助，确定目标指令
3. 输入 `/at 助手名 消息内容`
4. 收到助手回复

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 4 | 中等 |
| 决策点 | 1（选哪条指令） | 低 |
| 新概念数量 | 2（指令格式 + 助手名） | 低 |

**综合评级**: 低负担

### 基准对比

| 产品 | 同功能步骤数 | 来源 |
|---|---|---|
| Telegram 成熟 bot（如 @ChatGPTBot）| 2 步（输/选）| Phase 0.5 benchmark |
| Slack bot slash commands | 2-3 步 | Phase 0.5 benchmark |

**结论**: 我们的设计（4步）比 Telegram 原生基准（2步）多 2 步，差距来源于"需要记住助手名"这一步。可通过 Should 项"助手名补全提示"在未来缩小差距，当前可接受。

---

## 十五、扩展预留建议

**架构扩展点**:
- `BridgeInboundTextAdapter.processCommand()` 接口：新增平台的指令处理实现只需实现此方法，无需改其他代码
- 指令注册：新增指令只需在指令常量数组中添加一条，setMyCommands 注册会自动包含
- `BridgeWebhookParseResult` kind:'command' 类型：commandType 为 string 而非 union，支持未来新增指令类型

**后续迭代方向（Won't 列表中的候选）**:
- 飞书/钉钉原生命令注册（若平台开放 API）— 触发条件: 某平台明确支持 + 有用户诉求
- `/status` 指令（查看助手执行状态）— 触发条件: 用户明确提出需要等待反馈
- 助手名 autocomplete（Telegram）— 触发条件: `/at` 使用量大但错误率高

**配置化建议**:
- 指令 description 文案抽为常量（无需配置化，改代码即可）
- setMyCommands scope 固定为 all_group_chats，无需配置化

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| `/clear` = 清空 AgentRoomMemory，不删平台消息 | 同时删平台侧历史消息 | 删平台消息需特殊权限；用户诉求核心是"助手记忆重置"；各平台 API 差异极大 | 2026-05-19 |
| 指令统一 `/` 前缀，不区分平台 | 各平台定制触发词 | 降低用户认知负担；`/` 是 IM bot 指令的行业惯例；降低维护成本 | 2026-05-19 |
| setMyCommands 在 bot 凭证保存时触发（非阻塞） | 启动时/定时 trigger | 与 bot 生命周期绑定，配置即生效；非阻塞避免注册失败影响 bot 创建 | 2026-05-19 |
| `/at` 转换消息文本 → 复用 receiveBridgeMessage | 直接 dispatch 到 enqueueAgentTask | 复用现有路由和校验逻辑（isMember check 等），不引入新执行路径 | 2026-05-19 |
| 指令回复通过 sendDirectMessage（反向推送） | 存入 Message 表再广播 | 指令响应是系统消息，不应污染 bridge 群的 AI 对话记录；避免触发再次 receivedMessage | 2026-05-19 |
| 所有平台用户均可执行 /clear（不做权限控制） | 仅房主/管理员可清空 | 清空记忆无数据泄露风险；权限控制需 bridge 侧用户标识，实现复杂度高且收益低 | 2026-05-19 |

---

## YAGNI 检查结果

### 已通过 YAGNI 的需求项

| 需求项 | 保留理由 | 对应 AC |
|---|---|---|
| `/help` 指令 | 外部用户零培训可发现性的基础 | AC 1.1-1.4 |
| `/at` 指令 | 原始需求明确提出"快捷艾特群助手" | AC 2.1-2.5 |
| `/clear` 指令 | 原始需求明确提出"清空群消息/上下文" | AC 3.1-3.4 |
| Telegram setMyCommands | Telegram 原生 UX 要求；不注册则命令不可发现 | AC 4.1-4.3 |

### Deferred 项（同步到 MoSCoW Won't）

| 需求项 | YAGNI 原因 | 触发条件 |
|---|---|---|
| 自定义指令（/mycommand） | 当前无用户需求，纯推测性 | 有具体用户反馈后 |
| 指令 autocomplete | 只有 Telegram 支持，当前没有用户因缺失 autocomplete 流失 | /at 错误率统计显示有需要时 |
| /status 指令 | 原始需求未提及 | 用户明确提出需要等待反馈机制时 |
| deleteMyCommands（bot 删除时） | bot 删除后 token 失效，命令自然无效，不需要主动清理 | 永不（token 失效即等同清除） |

---

<!-- 预留扩展位 -->
