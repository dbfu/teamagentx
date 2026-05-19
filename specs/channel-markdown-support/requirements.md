# Requirements Document: channel-markdown-support

**Generated**: 2026-05-19
**Mode**: iteration
**Depth**: light
**Status**: Draft

---

## 一、原始需求

> 研究一下接入频道对 md 的支持
>
> 我想知道频道本身对 md 的支持情况。以及他们都支持什么格式的
>
> 根据各频道支持的格式。转化后发送。电报使用MarkdownV2。飞书使用lark_md
>
> 其他频道也需要，按自己支持的格式来转化。输出成 specs/channel-markdown-support/requirements.md

---

## 二、竞品基准研究

⚠️ 基准研究受限，以下基于已有知识和当前代码库上下文推演 [推演]

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| Telegram Bot | 官方支持 `MarkdownV2` 与 `HTML` 两种 parse mode，[推演] 不支持完整 CommonMark | 发送前先做平台定制化转义与语法映射 |
| 飞书/Lark Bot | 更常见的是消息卡片与 `lark_md`/卡片 markdown 能力，[推演] 不是通用 Markdown 渲染器 | 以平台原生富文本能力为目标，而不是强行保留原始 Markdown |
| 企业微信 Bot | 原生 `markdown` 消息类型，支持有限语法和扩展标签 | 将通用 Markdown 收敛为“通知型 Markdown 子集” |
| Slack | 使用 `mrkdwn` 而非标准 Markdown [推演] | 多平台消息系统应维护“中间表示 + 渠道转换器” |
| 钉钉 Bot | 提供 markdown 类型模板消息，session webhook 分支常退化为 text [推演] | 同一平台内也可能按入口能力不同采取不同格式 |

### 用户心智模型

用户期望“在 TeamAgentX 里写一次 Markdown，大多数频道都能以尽量接近的格式显示”，但默认接受不同频道在细节上存在降级 [推演]。

### 行业惯例

- 不承诺完整 CommonMark 跨平台一致渲染，而是承诺“核心语义尽量保真” [推演]
- 先抽象为平台无关的消息语义，再映射到 Telegram `MarkdownV2`、飞书 `lark_md`、企业微信 markdown、钉钉 markdown 或纯文本 [推演]
- 遇到频道不支持的语法时，优先安全降级为纯文本，而不是发送失败 [推演]

### 已知反模式

- 将原始 Markdown 不加转换直接广播到所有频道，会导致转义冲突、消息发送失败或展示错乱 [推演]
- 将 HTML 作为统一中间格式，会在 Telegram/飞书/企业微信这类平台上产生额外不兼容 [推演]
- 把“平台发送格式”和“编辑器输入格式”耦合在一起，会让后续新增频道成本变高 [推演]

### 认知复杂度上限

- 成熟产品主流程复杂度通常为 3 步、2 个决策点以内 [推演]
- 理想主流程：
  1. 生成统一 Markdown 文本
  2. 根据频道选择转换器
  3. 发送原生格式或降级文本

### 基准结论

- ✅ 方向应对齐“统一输入 + 渠道转换”的行业惯例
- ✅ Telegram 使用 `MarkdownV2`、飞书使用 `lark_md` 与平台能力方向一致 [推演]
- ⚠️ 其他频道不能假设支持完整 Markdown，必须定义支持矩阵和降级规则

---

## 三、可行性 & 假设清单

### 假设提取

| # | Assumption | Risk if Wrong | Confidence |
|---|---|---|---|
| 1 | 当前出站消息文本可以在发送前统一进入一个“按平台转换”的步骤 | 若不同平台存在绕过统一发送链路的路径，将导致行为不一致 | Medium |
| 2 | 现有桥接平台的主要目标是文本消息，而非图片、文件、交互表单 | 若用户预期包含复杂卡片/附件，当前需求范围会不足 | Medium |
| 3 | 用户接受不同平台在表格、任务列表、嵌套块等高级语法上的降级 | 若需要完全一致渲染，当前方案无法满足 | High |
| 4 | Telegram 最终目标格式确定为 `MarkdownV2`，不再继续使用 HTML | 若仍需兼容 HTML 路径，迁移复杂度会上升 | High |

### Technical Feasibility Signal

- **Current stack**: 代码库已存在桥接发送层 `server/src/modules/bridge/platform-senders.ts`，并已按平台分开发送逻辑；当前 Telegram 使用 HTML 转换，飞书使用卡片 markdown，企业微信使用 markdown，钉钉使用 markdown 或 text，QQ 使用纯文本。
- **Known blockers**: 当前没有统一“Markdown 中间表示能力矩阵”；Telegram 从 HTML 切到 `MarkdownV2` 需要重新设计转义规则；飞书 `lark_md` 与当前 card markdown 不是同一概念 [推演]。
- **Third-party dependencies**: Telegram Bot API、飞书开放平台、企业微信接口、钉钉接口、QQ Bot 接口；稳定性取决于各平台文档与格式校验。
- **Feasibility verdict**: ✅ Clear path

### Dependency Identification

- **Other teams/services**: Web 端频道配置页、服务端 bridge gateway、bridge service、平台 sender。
- **External stakeholders**: 使用频道桥接的运营人员/群机器人配置人员。
- **Upstream dependencies**: Agent 输出文本、房间消息同步链路、平台鉴权配置。
- **Downstream dependents**: 所有外部频道的消息展示效果、失败重试与告警体验。

### Scope Boundary Declaration

**In scope:**
- 定义统一 Markdown 输入到各频道原生格式的转换规则
- 明确 Telegram 使用 `MarkdownV2`
- 明确飞书使用 `lark_md`
- 明确其他已接入频道的原生格式与降级规则
- 定义最小可移植 Markdown 子集

**Out of scope (this iteration):**
- 图片、附件、交互卡片的统一抽象 — reason: 当前需求聚焦文本/Markdown 转换
- 新增未接入频道的完整实现 — reason: 当前只覆盖已接入和近期明确目标频道
- 富文本编辑器改造 — reason: 当前只定义发送侧行为

**Deliberately excluded:**
- 承诺所有频道完整兼容 CommonMark/GFM — reason: 各平台原生能力不同，成本高且不稳定

### Reversibility Score

| Dimension | Score | Reason |
|---|---|---|
| Data migration cost | Low | 主要是发送逻辑与格式策略调整，不涉及数据迁移 |
| API contract changes | Medium | 平台 sender 的内部契约可能需要调整为“结构化语义或中间表示” |
| User-facing behavior change | Medium | 外部频道中的显示样式会发生变化 |
| Downstream system impact | Medium | 影响所有 bridge 出站平台，但集中在 sender 层 |

**Overall reversibility**: Medium cost

---

## 四、5W2H 全景分析

**What** — 做什么
> 为 TeamAgentX 的频道桥接能力定义一套“统一 Markdown 输入 -> 各频道原生格式输出”的规则。Telegram 必须输出 `MarkdownV2`，飞书必须输出 `lark_md`，其他频道按各自支持的格式转换，不支持时降级为纯文本或更小语法子集。

**Why** — 为什么做
> 当前各频道对 Markdown 的支持差异很大，直接发送原文会导致格式错乱或接口报错。统一转换规则可以降低频道接入成本、提升消息展示一致性，并减少平台格式兼容问题。

**Who** — 谁来用
> 主要用户: 负责配置和使用桥接频道的运营人员/项目协作者 [推演]  
> 次要用户: 维护 bridge 平台适配器的后端开发者  
> 受影响方: 所有通过外部频道接收 TeamAgentX 消息的群成员

**When** — 什么时候用
> 触发时机: 当房间消息或 Agent 回复需要同步到外部频道时  
> 使用频率: 高频  
> 时间约束: 每次出站发送前必须完成格式选择和转换

**Where** — 在哪里用
> 使用环境: Server bridge 出站链路、Web 端频道配置说明 [推演]  
> 入口位置: `server/src/modules/bridge/platform-senders.ts` 及关联 sender 注册链路

**How** — 怎么做
> 核心操作路径: 生成消息文本 -> 识别目标频道 -> 选择该频道转换器 -> 输出频道原生消息格式 -> 发送  
> 技术实现方向: 建立最小可移植 Markdown 子集和频道能力矩阵，为每个平台实现独立转换器与降级策略

**How Much** — 做到什么程度
> 规模/量级: 覆盖当前已接入的 `telegram`、`feishu`、`dingtalk`、`wecom`、`qq` 五类平台，后续可扩展到新增平台  
> 质量标准: 常见文本语义在目标平台可稳定发送；不支持语法不得导致整条消息发送失败  
> 验收底线: 每个平台都有明确的目标格式、支持语法、降级规则和失败策略

---

## 五、用户角色 & 使用场景

### 主要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 社群运营 |
| 使用频率 | 高频（每天） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 让 TeamAgentX 回复稳定同步到不同外部群聊，并保持可读格式 |
| 最大痛点 | 同一段内容发到不同频道后展示不一致，甚至发送失败 |

### 次要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 后端开发工程师 |
| 使用频率 | 中频（每周） |
| 技术熟练度 | 技术专家 |
| 核心目标 | 以最小维护成本扩展新频道并保证已有频道稳定 |
| 最大痛点 | 平台格式差异散落在代码里，缺少统一规范与测试基线 |

### 受影响方（不直接使用，但受影响）

- 群成员: 接收到的消息排版、强调、链接和代码显示效果会变化
- 产品经理: 新频道接入时的范围控制与验收标准会更清晰

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| Agent 回复同步到 Telegram 群 | 房间内 Agent 生成带格式回复 | 在 Telegram 中保留强调、代码、链接等核心语义 | 必须符合 `MarkdownV2` 转义规则，否则接口会拒绝 [推演] |
| Agent 回复同步到飞书群 | 房间内 Agent 生成带格式回复 | 在飞书中按 `lark_md` 展示主要文本结构 | 飞书仅支持其原生语法子集，不保证通用 Markdown 全兼容 [推演] |
| Agent 回复同步到其他频道 | 房间内 Agent 生成带格式回复 | 能按频道支持能力尽量保真发送 | 钉钉、企业微信、QQ 能力不同，不支持部分语法时必须降级 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| Telegram/飞书等多频道同步 | 同一段 Markdown 在不同频道可能出现转义符外露、语法失效或发送失败 ⚠️ [推演] | 平台差异被收敛在转换层，房间侧只关心统一输入 | 频道桥接继续表现不稳定，用户对“同步消息可读性”失去信任 |
| 新增频道适配 | 没有统一支持矩阵时，每接一个频道都要临时判断语法兼容性 ⚠️ [推演] | 新频道接入可以复用统一规范，降低研发成本 | 平台适配逻辑持续分散，维护难度上升 |
| 消息失败处理 | 平台不支持某语法时可能整条发送失败 ⚠️ [推演] | 定义降级策略后，至少能保证文本送达 | 关键通知在外部群中丢失或无法阅读 |

---

## 七、标准用户故事 & 验收标准

### Story 1
**User Story**: 作为社群运营，我想要 TeamAgentX 在发送 Telegram 消息时将统一 Markdown 转为 `MarkdownV2`，以便群里成员能看到尽量完整的强调、链接和代码格式。

**Acceptance Criteria**:
- [ ] AC1: When the target platform is `telegram`, the system shall serialize outbound text as Telegram `MarkdownV2`.
- [ ] AC2: When the outbound text contains Telegram reserved characters, the system shall escape them according to `MarkdownV2` rules before sending.
- [ ] AC3: When the source text contains unsupported Markdown constructs, the system shall convert them to readable plain text instead of sending invalid `MarkdownV2`.

**Out of scope for this story**: Telegram 图片、按钮、投票或其他非文本富媒体消息。

### Story 2
**User Story**: 作为社群运营，我想要 TeamAgentX 在发送飞书消息时将统一 Markdown 转为 `lark_md`，以便飞书群里能稳定展示标题、强调、列表和链接等核心结构。

**Acceptance Criteria**:
- [ ] AC1: When the target platform is `feishu`, the system shall serialize outbound text as `lark_md`.
- [ ] AC2: When the source text contains syntax unsupported by `lark_md`, the system shall downgrade that syntax to plain text while preserving the original reading order.
- [ ] AC3: When a message is sent to Feishu, the system shall not rely on CommonMark-only constructs that have no `lark_md` equivalent.

**Out of scope for this story**: 飞书交互卡片布局、按钮、图片混排统一抽象。

### Story 3
**User Story**: 作为后端开发工程师，我想要其他频道按各自支持的原生格式或纯文本降级发送，以便新增或维护频道时不需要重复处理 Markdown 兼容问题。

**Acceptance Criteria**:
- [ ] AC1: When the target platform is `wecom`, the system shall serialize outbound text as WeCom markdown.
- [ ] AC2: When the target platform is `dingtalk`, the system shall serialize outbound text as DingTalk markdown if the delivery path supports markdown, otherwise it shall send readable plain text.
- [ ] AC3: When the target platform does not support the requested Markdown construct, the system shall send a downgraded representation that preserves text content and link destination.

**Out of scope for this story**: 为每个平台补齐完全一致的视觉效果。

### Decision Log

| Decision | Alternatives Considered | Why This Choice |
|---|---|---|
| 以统一 Markdown 作为输入，而不是每个平台单独生成文案 | 平台专属模板直出 | 复用现有房间消息内容，减少上游分叉 |
| Telegram 目标格式选择 `MarkdownV2` | 继续使用 HTML | 用户已明确指定，且与 Telegram 原生能力方向一致 |
| 飞书目标格式选择 `lark_md` | 继续使用当前 card markdown 或纯文本 | 用户已明确指定，且有利于和平台语义对齐 |
| 为不支持语法定义降级规则 | 发送失败或直接原样透传 | 可保证消息可送达，降低平台兼容风险 |

---

## 八、5Why 根因挖掘

本次为 `light` 分析深度，未执行 5Why；根因结论由上文直接收敛为：频道原生格式不一致，缺少统一转换与降级规范。

---

## 九、Kano 需求分类

本次为 `light` 分析深度，未执行 Kano 分类。

---

## 十、MoSCoW 优先级

### Must (必须做)

| # | Requirement | Evidence (benchmark/pain point) |
|---|---|---|
| M1 | 为每个已接入频道定义明确的目标发送格式 | 用户明确要求“其他频道也需要，按自己支持的格式来转化” |
| M2 | Telegram 出站消息使用 `MarkdownV2` | 用户明确要求“电报使用MarkdownV2” |
| M3 | 飞书出站消息使用 `lark_md` | 用户明确要求“飞书使用lark_md” |
| M4 | 为不支持的 Markdown 语法提供降级策略，确保消息可发送 | 痛点：直接透传会导致格式错乱或发送失败 [推演] |
| M5 | 定义最小可移植 Markdown 子集 | 行业惯例：多平台消息系统通常先定义通用语义子集 [推演] |

### Should (应该做)

| # | Requirement | Why Not Must |
|---|---|---|
| S1 | 为每个平台补充语法转换测试样例 | 高价值，但用户当前先要需求规格，不是立即实现 |
| S2 | 在配置或文档中展示各频道支持矩阵 | 有助于运营理解差异，但存在人工规避方式 |
| S3 | 保留平台发送失败时的回退日志和原文预览 | 重要但不是需求核心目标本身 |

### Could (可做可不做)

| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | 统一支持图片、引用卡片、按钮等富媒体元素 | 当前需求只要求 Markdown/文本格式转换 |
| C2 | 提供“预览各频道渲染结果”的管理界面 | 有价值，但超出本期文本发送目标 |

### Won't (本期不做)

| # | Requirement | Decision Reason |
|---|---|---|
| W1 | 承诺所有频道实现完整 CommonMark/GFM 兼容 | 平台能力不一致，成本高且不可稳定验证 |
| W2 | 统一所有频道的视觉效果完全一致 | 各平台消息组件与排版能力天然不同 |
| W3 | 以 HTML 作为跨平台统一发送格式 | 与 Telegram `MarkdownV2`、飞书 `lark_md` 方向冲突，且可移植性差 |

---

## 十一、功能详细需求定义

### 功能 1: 平台格式路由

**功能描述**
> 系统根据目标频道类型，为每条出站消息选择唯一的目标格式和对应转换器。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| platform | string | 是 | `telegram` / `feishu` / `dingtalk` / `wecom` / `qq` | 目标频道平台 |
| text | string | 是 | UTF-8 文本，允许包含统一 Markdown | 原始消息文本 |
| deliveryPath | string | 否 | 平台内部投递通道标识 | 用于区分同平台不同能力路径 |

**处理逻辑**
1. 系统读取目标 `platform`。
2. 系统查找该平台对应的目标格式。
3. 如果存在 `deliveryPath` 差异，系统按能力矩阵选择平台子路径策略。
4. 系统将消息交给对应转换器处理。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 目标平台格式标识与转换后的消息体 | 结构化发送载荷 |
| 失败 | 不支持的平台错误 | 错误对象 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 返回校验失败，不发送空消息 |
| 平台不存在 | 返回明确错误，不尝试默认发送 |
| 并发请求 | 各请求独立选择格式，不共享可变转换状态 |
| 网络超时 | 由平台发送层处理，格式路由层不吞掉错误 |
| 权限不足 | 由平台发送层返回鉴权失败，路由层透传错误 |

**与其他功能的依赖关系**

- 依赖: 功能 2、功能 3 的转换与降级规则
- 被依赖: 所有 bridge 出站 sender

### 功能 2: Markdown 语义转换

**功能描述**
> 系统将统一 Markdown 文本转换为目标频道支持的原生格式，保留尽量多的语义。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| platform | string | 是 | 已支持平台之一 | 目标频道平台 |
| text | string | 是 | 统一 Markdown 文本 | 待转换内容 |

**处理逻辑**
1. 系统识别文本中的核心语义：段落、换行、粗体、斜体、引用、代码、链接、列表。
2. 系统按平台映射规则生成目标格式。
3. 对平台不支持的语义执行降级。
4. 对目标格式需要的保留字符进行转义。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 目标平台可直接发送的格式化文本 | string |
| 失败 | 转换失败原因 | 错误对象 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 输出空字符串并阻止发送 |
| 超出取值范围 | 遇到未知语法按普通文本保留原文 |
| 并发请求 | 转换结果不得被其他请求污染 |
| 网络超时 | 不适用，转换阶段不依赖网络 |
| 权限不足 | 不适用 |

**与其他功能的依赖关系**

- 依赖: 平台能力矩阵定义
- 被依赖: 功能 1、功能 3

### 功能 3: 语法降级与送达保障

**功能描述**
> 当目标频道不支持某些 Markdown 语法时，系统应将其降级为可读文本，优先保障送达。

**输入**

| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| platform | string | 是 | 已支持平台之一 | 目标频道平台 |
| unsupportedSyntax | string[] | 是 | 识别出的不兼容语法列表 | 例如表格、任务列表、HTML |
| text | string | 是 | 原始消息文本 | 待降级内容 |

**处理逻辑**
1. 系统识别不兼容语法。
2. 系统按预定义规则将其转换为可读文本表示。
3. 如果目标平台完全不支持 Markdown，系统输出纯文本。
4. 如果目标平台发送格式校验失败，系统允许使用更低级别的文本格式重试 [推演]。

**输出**

| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 降级后的可发送文本 | string |
| 失败 | 最终发送失败原因 | 错误对象 |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 输入为空 | 返回空文本并阻止发送 |
| 超出取值范围 | 未识别语法按纯文本保留 |
| 并发请求 | 各自独立降级 |
| 网络超时 | 若发生在重试发送阶段，返回发送失败 |
| 权限不足 | 返回平台发送错误，不继续重试无效凭证 |

**与其他功能的依赖关系**

- 依赖: 功能 2
- 被依赖: 所有平台 sender 的可靠发送策略

### 平台支持矩阵

| 平台 | 目标格式 | 核心支持项 | 明确降级项 |
|---|---|---|---|
| Telegram | `MarkdownV2` | 段落、粗体、斜体、引用、链接、行内代码、代码块、列表 [推演] | 表格、HTML、自定义块 |
| 飞书 | `lark_md` | 段落、标题、强调、列表、引用、链接 [推演] | 通用 HTML、复杂嵌套、GFM 表格 |
| 企业微信 | `markdown` | 强调、链接、引用、部分颜色 [推演] | 复杂嵌套、任务列表、表格 |
| 钉钉 | `markdown` 或 `text` | 标题、引用、链接、基础强调 [推演] | 不支持路径下统一降级为 text |
| QQ | `text` [推演] | 纯文本、链接文本 | 所有 Markdown 语义降级为纯文本 |

### 最小可移植 Markdown 子集

- 段落与换行
- 粗体
- 斜体
- 引用
- 行内代码
- 代码块
- 链接
- 无序列表

### 非兼容语法默认处理

- 表格 -> 多行纯文本
- 任务列表 -> 普通列表，保留 `[x]` / `[ ]` 字面值
- HTML 标签 -> 去除标签，仅保留可读文本
- 图片语法 -> 保留 alt 文本与 URL，按纯文本发送
- 多层嵌套块 -> 展平为普通段落或列表

---

## 十二、非功能需求

本次为 `light` 分析深度，非功能需求未展开；默认要求如下：

- 转换过程必须是纯函数式或等价的无共享污染行为 [推演]
- 平台不兼容不得导致整个发送链路静默失败
- 平台差异必须可测试、可扩展、可文档化

---

## 十三、架构影响分析 [Iteration Mode]

本次为 `light` 分析深度，未执行完整架构影响章节；已完成基础代码库扫描，结果如下：

- 相关模块集中在 `server/src/modules/bridge/` 与 `server/src/gateway/bridge.gateway.ts`
- 当前平台定义位于 [bridge-platform-registry.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/bridge-platform-registry.ts:16)
- 当前平台发送逻辑位于 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:1)
- `handleWebhookByAdapter` 的上游影响面为 `LOW`，直接调用方 1 个，位于 `bridgeGateway`
- 当前已知出站格式：
  - Telegram: HTML，见 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:132)
  - 飞书: interactive card markdown，见 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:254)
  - 钉钉: markdown 或 text，见 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:377)
  - 企业微信: markdown，见 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:454)
  - QQ: text，见 [platform-senders.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/bridge/platform-senders.ts:501)

---

## 十四、认知复杂度评估

本次为 `light` 分析深度，未执行完整认知复杂度模型。

当前主流程估计：

- **主流程步骤数**: 3 步
- **决策点数量**: 2 个
- **复杂度评级**: Low
- **基准对比**: 主流产品同类能力通常也是“输入 -> 渠道格式转换 -> 发送”三段式 [推演]

---

## 十五、扩展预留建议

**架构扩展点**:

- 统一定义 `PlatformMessageFormat` 枚举，如 `telegram_markdown_v2`、`lark_md`、`wecom_markdown`、`dingtalk_markdown`、`plain_text`
- 将“语义解析”和“平台输出”拆分，便于新增频道复用

**后续迭代方向**:

- 渲染预览面板 — 触发条件: 运营需要在绑定频道前预览各平台显示差异
- 富媒体统一支持 — 触发条件: 文本格式转换稳定且出现明确的图片/卡片需求

**配置化建议**:

- 每个平台的目标格式应显式配置或固定在 sender 内，不允许隐式猜测
- 是否允许失败后降级重试应可配置 [推演]

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| Telegram 改用 `MarkdownV2` | HTML、纯文本 | 用户明确指定，且更接近频道原生格式 | 2026-05-19 |
| 飞书改用 `lark_md` | card markdown、纯文本 | 用户明确指定，利于平台语义收敛 | 2026-05-19 |
| 其他频道按平台原生格式转换 | 统一发 Markdown 原文 | 平台能力差异大，统一原文不可控 | 2026-05-19 |
| 不支持语法时优先降级送达 | 发送失败、丢弃格式 | 业务上“消息送达”优先于“样式完全一致” | 2026-05-19 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
