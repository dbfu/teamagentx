# Requirements Document: Platform Markdown Rendering

**Generated**: 2026-05-19
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 飞书和三方平台支持渲染md
>
> （补充澄清）需要先知道各平台支持什么格式。然后去对齐格式

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| Feishu/Lark | Interactive Card + `tag: 'markdown'` 组件；表格需 `tag: 'table'`；有专属 Markdown 方言子集 | 平台定制方言，超出子集的语法需降级或独立 tag 处理 |
| Slack (mrkdwn) | 自定义 mrkdwn 方言（非 CommonMark）；Bot API 和桌面端语法有差异；复杂排版用 Block Kit JSON | API 场景维护独立方言转换层 |
| Telegram | 官方推荐 `parse_mode=HTML`，已实现 markdownToTelegramHtml；不推荐 MarkdownV2 | HTML 转换比 MD 方言转换更稳定 |
| DingTalk | `sampleMarkdown` + `msgKey` 支持有限语法；代码块/表格兼容差；session webhook 仅支持纯文本 | 语法降级，丢弃不支持的元素 |
| WeCom | `msgtype: 'markdown'`，仅支持加粗/颜色/换行/链接，不支持表格/代码块 | 须做精简映射 |
| QQ | Open Platform 支持 `msg_type: 2` (markdown)，当前实现为 `msg_type: 0`（纯文本） | 版本探测或统一降级 |

### 用户心智模型
用户（飞书/钉钉/企微等平台接收 AI 回复的成员）期望 AI 的代码块、列表、标题等格式能在消息气泡中**正常渲染**，而非出现 `**`、`#`、`` ` `` 等原始符号。

### 行业惯例
1. 每个平台独立维护一个 Markdown → 平台原生格式的转换函数，不共用转换逻辑
2. 超出平台支持范围的语法必须降级（转纯文本或简化标签），不得直接透传
3. 必须有 fallback：格式化失败时退回纯文本，确保消息总能送达
4. API 场景的格式化逻辑与用户手动输入场景分开处理

### 已知反模式
- 直接把标准 CommonMark 语法透传给不支持的平台（如 QQ plain text、WeCom）→ 用户看到乱码符号
- 将 WeCom/DingTalk 误认为支持完整 GFM → 表格/代码块静默失效
- Feishu card 用 `tag: 'markdown'` 传表格内容 → 内容被过滤，不报错但表格消失
- Telegram 使用 MarkdownV2 → 特殊字符转义规则极易出错，官方已不推荐

### 认知复杂度上限（成熟方案基线）[推演]
→ 主流程：发送消息 → 格式转换 → 调用平台 API，**3 步，0 个用户决策点**（全部在后端透明处理）
→ 我们的设计不应超过此基线（用户感知零变化，仅后端实现改变）

---

## 三、可行性 & 假设清单

### 假设清单

| # | 假设 | 风险（若错） | 置信度 |
|---|---|---|---|
| 1 | Feishu card `tag: 'markdown'` 不支持 GFM 表格，需拆为 `tag: 'table'` 或纯文本 | 表格内容静默丢失 | High |
| 2 | DingTalk `sampleMarkdown` 在群聊中支持基本 MD（加粗/斜体/代码块）但不支持表格 | 代码块等可能不渲染 | Medium |
| 3 | WeCom markdown 仅支持加粗(`**`)、颜色(`<font>`)、链接(`[text](url)`)、换行(`\n`) | 代码块/标题/表格静默为纯文本 | High |
| 4 | QQ Open Platform 当前接入方式（`msg_type: 0`）不支持 Markdown | MD 符号完整显示 | High |
| 5 | 各平台 API 响应在 5 秒内，不影响消息送达 SLA | 消息超时 | Medium |
| 6 | 不同平台的 MD 方言差异可以在发送层（server/modules/bridge/platform-senders.ts）解决，无需改上层 | 需要大规模重构 | High |

### 技术可行性

- **当前栈**: Node.js/TypeScript，已有 `markdownToTelegramHtml` 和 `markdownToFeishuCard` 转换函数，架构已分平台适配
- **已知阻塞点**: Feishu card `tag: 'markdown'` 的表格支持限制需要官方文档核实；QQ 新版 markdown API 需确认 BotToken 权限
- **第三方依赖**: 各平台 Open API（稳定性：飞书/钉钉/企微均为成熟 API）
- **可行性**: ✅ 各平台已有独立 sender 函数，改动范围可控，无需重构架构

### 依赖识别

- **受影响服务**: `server/src/modules/bridge/platform-senders.ts` 中的各平台 sender 函数
- **受影响模块**: `bridge.service.ts`（注册 sender）、`bridge-platform-registry`（平台能力）
- **外部依赖**: 飞书 OpenAPI、DingTalk Stream SDK、企微 API、QQ Open Platform API

### 范围边界

**本期做：**
- 调研并文档化每个平台（飞书/钉钉/企微/QQ/Telegram）支持的 Markdown 语法子集
- 为每个平台实现正确的格式转换函数，使常见 MD 元素（代码块/列表/加粗/斜体/标题/链接）在各平台正确渲染
- 超出各平台支持的 MD 语法降级为可读文本（不显示原始符号）

**本期不做（下一轮迭代）：**
- Feishu 表格的独立 `tag: 'table'` 渲染——复杂度高，需要解析 MD 表格并重建 JSON 结构
- 图片附件在各平台的渲染（当前只处理文本消息）
- 消息长度自动分段（仅 Telegram 已有）

**明确不做：**
- 引入第三方 MD 解析库（保持依赖精简，用正则转换即可满足需求）
- 用户可配置的渲染格式偏好（YAGNI）

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | 纯逻辑变更，无 schema 改动 |
| API 合约变化 | Low | 内部函数修改，无对外 API 变更 |
| 用户感知行为变化 | Low | 消息内容不变，只是格式渲染改善 |
| 下游系统影响 | Low | 各平台 sender 函数相互独立 |

**整体可逆性**: Low cost ✅

---

## 四、5W2H 全景分析

**What** — 做什么
> 为 TeamAgentX 的各第三方平台 Bridge（飞书/钉钉/企微/QQ，Telegram 已有）实现正确的 Markdown 格式转换：根据各平台实际支持的格式规范，将 AI Agent 输出的标准 Markdown 文本转换为对应平台原生可渲染的格式，超范围语法降级为可读纯文本。

**Why** — 为什么做
> AI Agent 在 TeamAgentX 内部生成的回复含大量 Markdown（代码块、列表、加粗等），发送到第三方平台后因格式不兼容直接显示原始符号（如 `**bold**`、`\`\`\`code\`\`\``），可读性差，影响用户对 AI 回复质量的感知，降低平台桥接功能的使用价值。

**Who** — 谁来用
> 主要用户：在飞书/钉钉/企微/QQ 群中触发 AI Agent 的企业员工
> 次要用户：配置了 Bridge 的 TeamAgentX 管理员（需要确认格式生效）
> 受影响方：后端开发者（维护各平台 sender 函数）

**When** — 什么时候用
> 触发时机：AI Agent 在任意平台 Bridge 聊天中完成任务并发送回复时
> 使用频率：高频（每次 AI 响应都会触发格式转换）
> 时间约束：无硬性 Deadline，但每天用户都在体验问题

**Where** — 在哪里用
> 使用环境：飞书/钉钉/企微/QQ 客户端（移动端 + 桌面端）
> 入口位置：`server/src/modules/bridge/platform-senders.ts` 中各平台的 `sendMessage` 函数

**How** — 怎么做
> 1. 整理各平台 Markdown 支持子集（以官方文档为准）
> 2. 在各平台 sender 函数中增加/改进格式转换逻辑（对标 `markdownToTelegramHtml` 模式）
> 3. 超范围语法降级：表格→缩进列表或纯文本，代码块→缩进或 \`code\` 保留，标题→加粗
> 4. 所有转换函数需有 fallback（转换异常则降级纯文本）

**How Much** — 做到什么程度
> 规模：5 个平台，每平台约 1 个转换函数，改动集中在单文件
> 质量标准：代码块/列表/加粗/链接在各平台正常渲染；原始 MD 符号不暴露给用户
> 验收底线：发送含 \`\`\`code\`\`\`、`**bold**`、`- list` 的消息，在各平台客户端不显示原始符号

---

## 五、用户角色 & 使用场景

**主要用户**: 企业员工（飞书/钉钉/企微/QQ 用户）
**次要用户**: TeamAgentX 管理员

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| AI 回复含代码块 | 员工在飞书群 @AI 问技术问题，AI 返回代码示例 | 看到可读的代码块，而非原始 ``` 符号 | 飞书客户端渲染能力限制 |
| AI 回复含有序/无序列表 | 员工请求 AI 列举步骤或选项 | 列表清晰呈现，每项独立换行 | 各平台列表语法不同 |
| AI 回复含 Markdown 表格 | 员工请求 AI 生成对比表格 | 表格可读（即使不能完美渲染也不能乱码） | 飞书/钉钉/企微均不完全支持 MD 表格 |
| QQ 平台接收 AI 回复 | QQ 群中 AI 完成任务 | 回复中的格式符号不裸露 | QQ 当前 msg_type=0 纯文本，无格式化 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| AI 回复含代码块（飞书） | 飞书用户看到 ` ```python\ncode\n``` `，需要自行过滤符号才能看懂代码 | 代码块正确渲染为飞书 card 的 code 样式，直接可读 | Bridge 功能的实际可用性打折扣，用户对 AI 质量产生误解 |
| AI 回复含格式（钉钉/企微） | 钉钉/企微用户看到 `**bold**` `## 标题` 等原始符号 | 加粗/标题/列表正常渲染，回复专业可读 | 用户停止在钉钉/企微使用 AI，Bridge 功能失去价值 |
| AI 回复含 MD 表格（各平台） | 表格显示为一排 `\| col \| col \|` 符号，完全不可读 | 降级为缩进列表或纯文本，至少信息保留 | 信息丢失或乱码，降低 AI 可信度 |
| QQ 平台纯文本发送 | 所有 MD 格式符号原样输出，严重影响可读性 | 移除/转义 MD 符号，输出干净纯文本 | QQ 渠道的 AI 回复不可用 |

**价值可信度**:
- ⚠️ 基于合理推断（行业经验 + 代码实测）[推演] — 尚未有实际用户投诉数据，但从代码中 msg_type=0 可直接确认 QQ 问题存在

---

## 七、标准用户故事 & 验收标准

### Story 1：飞书群收到 AI 代码块回复
**User Story**: 作为飞书群成员，我想要 AI 的代码示例以代码块样式显示，以便直接阅读而无需过滤符号

**Acceptance Criteria**:
- [ ] AC1: When AI sends a message containing fenced code blocks (` ```lang\ncode\n``` `), the system shall render it as a Feishu card code element (not raw backtick symbols)
- [ ] AC2: When AI sends a message containing `**bold**`, the system shall render it as bold text in the Feishu card
- [ ] AC3: When AI sends a message containing `- item` or `1. item` lists, the system shall render them as separate lines with bullet or number prefix
- [ ] AC4: When the Feishu API rejects the card payload, the system shall fall back to sending plain text within 1 retry attempt

**Out of scope for this story**: Feishu table rendering (deferred), image rendering

---

### Story 2：钉钉/企微群收到 AI 格式化回复
**User Story**: 作为钉钉或企微群成员，我想要 AI 回复中的加粗/列表/代码等格式正确渲染，以便获得专业可读的回复

**Acceptance Criteria**:
- [ ] AC5: When AI sends `**bold**` to DingTalk/WeCom, the system shall render it as bold using each platform's native bold syntax (DingTalk: `**`, WeCom: `**`)
- [ ] AC6: When AI sends ` ```code``` ` to DingTalk, the system shall render it using DingTalk's markdown code block syntax; when sent to WeCom, shall convert to inline code or plain text with a code-block prefix label
- [ ] AC7: When AI sends a markdown table to DingTalk or WeCom, the system shall strip the table syntax and output a human-readable plain text alternative (column names as labels, each row as a line)
- [ ] AC8: When AI sends `# Heading` to WeCom, the system shall convert it to `**Heading**` (bold) since WeCom does not support heading syntax

**Out of scope for this story**: WeCom table native rendering

---

### Story 3：QQ 群收到无原始符号的 AI 回复
**User Story**: 作为 QQ 群成员，我想要 AI 回复不含裸露的 Markdown 符号，以便内容可读

**Acceptance Criteria**:
- [ ] AC9: When AI sends any message containing markdown syntax to QQ, the system shall strip all markdown symbols (`**`, `#`, `` ` ``, `~~`, `[]()`) and output clean plain text
- [ ] AC10: When AI sends a code block to QQ, the system shall preserve the code content but remove backtick fences, replacing them with a `[代码]\n...\n[/代码]` label wrapper
- [ ] AC11: When AI sends a list to QQ, the system shall convert `- item` to `• item` and `1. item` to `1. item` (retain numbering, remove dash)

**Out of scope for this story**: QQ native markdown API (msg_type=2) — deferred pending QQ Bot permission verification

---

### Story 4：Telegram 已有实现保持稳定
**User Story**: 作为 Telegram 用户，我想要 AI 回复的 HTML 格式渲染保持稳定，以便现有体验不退化

**Acceptance Criteria**:
- [ ] AC12: When `markdownToTelegramHtml` is called with a string containing code blocks, the system shall output valid `<pre><code>` HTML tags
- [ ] AC13: When `markdownToTelegramHtml` encounters an HTML parse error from Telegram API (status 400 with "can't parse entities"), the system shall fall back to plain text in one retry

**Out of scope for this story**: Changes to Telegram sender logic (no new work needed)

---

### Decision Log

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 不引入第三方 MD 解析库 | unified/remark/marked | 转换需求有限，正则函数已满足；引入 AST 解析增加复杂度和依赖 | 2026-05-19 |
| QQ 保持 msg_type=0 纯文本，不切换 msg_type=2 markdown | 升级 QQ Markdown 消息 | QQ markdown API 需要特殊权限，默认 Bot 无法调用；风险高，收益不确定 | 2026-05-19 |
| Feishu 表格降级为纯文本，不用 tag:table | 解析 MD 表格重建 Feishu card JSON table | MD 表格 → Feishu card JSON 结构复杂，易出错；当期 ROI 低，延期 | 2026-05-19 |
| WeCom 代码块降级为 `【代码】\n...\n` | 完全删除代码内容 | 保留代码内容比完全删除对用户价值更大 | 2026-05-19 |

---

## 八、5Why 根因挖掘

**Surface requirement**: 飞书和三方平台支持渲染 Markdown

**Why 1**: 为什么需要 MD 渲染？
> Because: AI Agent 的回复本身包含 Markdown 格式（代码块、列表、加粗等），不渲染则原始符号裸露，降低可读性

**Why 2**: 为什么 AI 回复包含 Markdown？
> Because: LLM 的训练数据和 RLHF 使其默认以 Markdown 格式输出结构化内容，这是 LLM 的标准行为

**Why 3**: 为什么不在 LLM 输出层做处理（让 AI 不输出 MD）？
> Because: 不同渠道（Web UI、飞书、钉钉）对格式需求不同；Web UI 已有完整 MD 渲染；在 LLM 侧统一关闭 MD 会破坏 Web 体验

**Why 4**: 为什么各平台的渲染处理不一样？
> Because: 各平台有自己独立的消息协议和格式规范，不存在统一标准；这是平台碎片化的根本特征

**Why 5**: 为什么这个问题没有在 Bridge 上线时解决？
> Because: Bridge 功能上线时 Telegram（已有转换）是主要平台，其他平台陆续接入时没有系统性做格式对齐

**Root Insight**: AI 输出层产生的 Markdown 需要在**每个平台出口**做一次方言翻译，这是平台碎片化固有成本，无法从源头消除。

**Implication for design**: 需求方向正确，但必须以"各平台独立转换函数"为设计原则，不能寄希望于找到通用方案。Telegram 已有的 `markdownToTelegramHtml` 是正确模板，复制到其他平台即可。

---

## 九、Kano 需求分类

### Basic Requirements（用户默认期望，不做就扣分）
- **AI 回复不显示原始 MD 符号** — why it's basic: 基础的消息可读性，行业惯例（Slack、Telegram 均已解决）；当前 QQ 完全裸露符号是明确的 Basic 缺失
- **代码块内容保留** — why it's basic: 代码块是 AI 技术回复最常见的格式，内容丢失不可接受

### Performance Requirements（做得越好用户越满意）
- **Feishu card 的 Markdown 渲染视觉质量** — improvement axis: 飞书 card 支持的格式越丰富，回复越专业；可持续迭代（如后续支持表格）
- **格式降级的可读性** — improvement axis: 降级方案越优雅（如表格降级为对齐的纯文本），用户体验越好

### Excitement Requirements（超预期惊喜，做了加分）
- **飞书表格渲染为原生 card table** — ⚠️ Benchmark check: 暂无同类产品（AI Bot in Feishu）完整支持 MD→card table 自动转换；验证后再决定是否做

### Indifferent / Reverse
- **QQ 升级到 msg_type=2 markdown** — Indifferent for most users（QQ markdown 能力有限，且权限门槛高）→ 延期评估

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | 需求 | 证据 |
|---|---|---|
| M1 | 各平台发送函数中超范围 MD 语法必须降级，不得将原始符号透传给用户 | 行业惯例（Slack/Telegram/Feishu 均有此处理）+ 代码实测（QQ msg_type=0 直接裸露） |
| M2 | 飞书 card `tag: 'markdown'` 内容需符合飞书 MD 方言（基础加粗/列表/代码行内/链接） | 飞书官方文档明确定义支持语法子集 |
| M3 | 钉钉群聊 Markdown 消息中的代码块和列表正确渲染 | DingTalk `sampleMarkdown` 官方支持 |
| M4 | 企微 `msgtype: 'markdown'` 中不出现不支持的语法（如代码围栏/表格） | WeCom 官方文档明确不支持，透传会乱码 |
| M5 | QQ 平台去除所有 MD 符号，输出干净纯文本 | 当前 msg_type=0 纯文本模式，MD 符号完全裸露 |

### Should（应该做）

| # | 需求 | 为什么不是 Must |
|---|---|---|
| S1 | MD 表格在钉钉/企微降级为可读的纯文本（保留数据，去除 `\|` 符号） | 表格出现频率低于代码块/列表；有些 AI 回复可完全避免表格 |
| S2 | 各平台 sender 函数增加格式转换的单元测试 | 代码质量必要项，但不阻塞功能上线 |

### Could（可做可不做）

| # | 需求 | 延期原因 |
|---|---|---|
| C1 | 飞书 card 中 MD 表格渲染为 `tag: 'table'` JSON 结构 | 实现复杂度高（需解析 MD 表格 AST），ROI 低 |
| C2 | Telegram 消息长度分段（目前已有基础实现） | 当前实现满足 90% 场景 |

### Won't（本期不做）

| # | 需求 | 决策原因 |
|---|---|---|
| W1 | QQ 升级到 `msg_type: 2` Markdown 渲染 | 需要 QQ Open Platform 特殊权限，默认 Bot 不支持；风险高 |
| W2 | 跨平台统一 MD 方言转换层（抽象公共函数） | YAGNI：当前 5 个平台各有特殊性，强行抽象增加复杂度；等有 3 个以上平台共享逻辑时再重构 |
| W3 | 用户可配置的渲染模式（如"飞书用 card 还是 post"） | YAGNI：当前无场景需要用户配置渲染模式 |
| W4 | 图片 URL 在各平台的转换（缩略图、媒体消息） | 超出文本格式范围，独立需求 |

---

## 十一、功能详细需求定义

### 功能 1：飞书 Markdown → Feishu Card 格式规范化

**功能描述**
> `markdownToFeishuCard` 函数中 `tag: 'markdown'` 的内容需符合飞书 Markdown 方言子集，不可包含飞书不支持的语法。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| md | string | 是 | 任意标准 Markdown 文本 | AI Agent 生成的原始 MD 输出 |
| agentName | string | 是 | 1-50 字符 | 用于 card header |

**飞书 Markdown 方言支持子集（以官方文档为准）**

| 语法 | 飞书支持 | 处理方式 |
|---|---|---|
| `**bold**` | ✅ | 透传 |
| `*italic*` | ✅ | 透传 |
| `` `inline code` `` | ✅ | 透传 |
| `[text](url)` | ✅ | 透传 |
| `- list` / `1. list` | ✅ | 透传 |
| `# Heading` (h1-h4) | ✅ | 透传 |
| ` ```code block``` ` | ⚠️ 需核实 | 需测试；若不支持则转为 `` `inline` `` 或缩进文本 |
| `\| table \|` | ❌ | 降级为每行 `字段: 值` 的纯文本列表 |
| `~~strikethrough~~` | ❌ | 移除 `~~` 符号，保留内容 |
| `> blockquote` | ⚠️ 需核实 | 若不支持，去除 `>` 前缀 |

**处理逻辑**
1. 检测 MD 文本中是否包含飞书不支持的语法（表格、删除线等）
2. 表格：将每行转换为 `**col1**: val1 / **col2**: val2` 格式文本
3. 删除线：去除 `~~` 符号，保留内容
4. 其余标准 MD 语法：透传到 `tag: 'markdown'` content
5. 若整个 card 发送失败（HTTP != 2xx），降级为 `msg_type: 'text'` 纯文本（去除所有 MD 符号）

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | Feishu Interactive Card JSON | `{ config, elements: [{ tag: 'markdown', content: '...' }] }` |
| 降级 | 纯文本消息 | `{ receive_id, msg_type: 'text', content: JSON.stringify({ text: '...' }) }` |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| md 为空字符串 | 发送空 card，content 为空；不抛出错误 |
| md 长度超过 4096 字符 | 截断至 4096 字符后发送（飞书 card markdown 字段限制）[推演，需核实] |
| Feishu API 返回 400 | 记录错误日志，降级为文本消息重发一次 |
| agentName 含特殊字符 | 通过 `escapeFeishuMdInline` 已有转义，保持不变 |

---

### 功能 2：钉钉 Markdown 格式规范化（群聊模式）

**功能描述**
> `dingtalkSend` 函数中，对群聊的 `sampleMarkdown` 消息体进行格式规范化，确保钉钉支持的 MD 语法正确传递，不支持的语法降级。

**钉钉 Markdown 方言支持子集**

| 语法 | 钉钉支持 | 处理方式 |
|---|---|---|
| `# Heading` (h1-h6) | ✅ | 透传 |
| `**bold**` | ✅ | 透传 |
| `*italic*` | ✅ | 透传 |
| `[text](url)` | ✅ | 透传 |
| `- list` / `1. list` | ✅ | 透传 |
| ` ```code block``` ` | ⚠️ 有限支持 | 保留围栏，但视钉钉客户端版本 |
| `\| table \|` | ❌ | 降级为每行 `字段: 值` |
| `> blockquote` | ✅ | 透传 |
| `![img](url)` | ✅ (部分) | 透传 |

**处理逻辑**
1. 对 `text` 字段执行表格降级（MD 表格 → 纯文本列表格式）
2. 保留其他 MD 语法（钉钉 sampleMarkdown 支持基本 MD）
3. session webhook 模式（`externalId` 以 `sessionWebhook:` 开头）：降级为纯文本（当前已是，维持不变）

**边界情况**
| 场景 | 系统行为 |
|---|---|
| session webhook 模式 | 维持现有 text 纯文本发送，不做 MD 处理 |
| 表格 MD | 转为 `字段1: 值1 | 字段2: 值2` 每行格式 |
| 代码块无法渲染 | 保留代码内容，围栏保持；不做额外处理（由钉钉客户端决定） |

---

### 功能 3：企微 Markdown 格式规范化

**功能描述**
> `wecomSend` 函数中，将 AI 输出的标准 MD 转为企微支持的有限 Markdown 方言，避免不支持的语法导致乱码。

**企微 Markdown 支持子集**

| 语法 | 企微支持 | 处理方式 |
|---|---|---|
| `**bold**` | ✅ | 透传 |
| `<font color="...">text</font>` | ✅ | 仅系统内部使用，AI 输出不含 |
| `[text](url)` | ✅ | 透传 |
| 换行 `\n` | ✅ | 透传 |
| `# Heading` | ❌ | 转为 `**Heading**`（加粗） |
| `` `code` `` (inline) | ❌ | 去除反引号，保留内容 |
| ` ```code block``` ` | ❌ | 转为 `【代码】\n内容\n【/代码】` |
| `- list` | ❌（部分支持） | 转为 `• item` |
| `1. list` | ❌（部分支持） | 转为 `1. item`（去除 Markdown 感知） |
| `\| table \|` | ❌ | 降级为每行 `字段: 值` |
| `~~strikethrough~~` | ❌ | 去除符号，保留内容 |
| `*italic*` | ❌ | 去除符号，保留内容 |
| `> blockquote` | ❌ | 去除 `>` 前缀 |

**处理逻辑**（新增 `markdownToWecomMarkdown(md: string): string` 函数）
1. 标题 `#...#####` → `**标题内容**`
2. 代码围栏 ` ``` ` → `【代码】\n代码内容\n【/代码】`
3. 行内代码 `` ` `` → 去除反引号，保留内容
4. 无序列表 `- ` / `* ` → `• `
5. 有序列表 `1. ` → 保留数字和点，去除多余空格
6. 删除线 `~~` → 去除符号
7. 斜体 `*text*` → 去除符号
8. 表格 → 每行 `字段: 值` 纯文本
9. 引用 `> ` → 去除前缀
10. 加粗 `**` → 透传
11. 链接 `[text](url)` → 透传

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 嵌套 MD（如 `**\`code\`**`） | 先处理代码，再处理加粗 |
| 代码块内有 MD 语法 | 代码内容不做 MD 转换，原样保留 |
| content 超过企微 2048 字符限制 [推演] | 截断并追加 `...(内容已截断)` |

---

### 功能 4：QQ 纯文本 Markdown 符号清理

**功能描述**
> `qqSend` 函数中，将 AI 输出的 MD 转为干净纯文本（移除所有 MD 语法符号，保留内容语义）。

**处理逻辑**（新增 `markdownToQQPlainText(md: string): string` 函数）
1. 代码围栏 ` ``` ` → `[代码]\n代码内容\n[/代码]`
2. 标题 `#...#####` → 保留标题内容，去除 `#` 前缀，加空行分隔
3. 加粗 `**text**` → `text`（去除 `**`）
4. 斜体 `*text*` → `text`
5. 删除线 `~~text~~` → `text`
6. 行内代码 `` `code` `` → `code`
7. 链接 `[text](url)` → `text (url)`
8. 无序列表 `- ` → `• `
9. 有序列表 `1. ` → 保留
10. 表格 → 每行 `字段: 值`
11. 引用 `> ` → 去除前缀

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 纯文本（不含 MD） | 原样返回，不做处理 |
| 代码块嵌套 MD | 代码内容原样保留，不做 MD 处理 |
| content 超过 QQ 单次消息限制 [推演，需核实] | 截断发送，不分段（当前架构不支持 QQ 分段） |

---

## 十二、非功能需求

### Performance（性能）
- 格式转换函数为纯同步正则操作，P99 执行时间 < 5ms（文本长度 < 10000 字符）
- 不引入异步操作，不影响当前 Bridge 发送链路延迟
- 降级发送（fallback）最多额外增加 1 次 HTTP 请求，不做无限重试

### Security（安全）
- 转换函数不执行任何用户输入的代码，仅字符串替换，无注入风险
- Feishu card JSON 中的用户内容需通过 `escapeFeishuMdInline` 处理特殊字符（现有机制，保持）
- 不新增外部依赖，不引入新的攻击面

### Compatibility（兼容性）
- 各平台 API 兼容：基于各平台当前稳定版 API（飞书 v1/im/messages，DingTalk v1.0，WeCom v3，QQ bots.qq.com）
- 函数接口向后兼容：`markdownToFeishuCard` / `markdownToTelegramHtml` 签名保持不变，仅修改内部实现
- 不依赖平台 API 版本字段，降级逻辑不依赖平台特定的错误码（仅基于 HTTP status）

### Usability（易用性）
- 用户无感知：格式改善对用户透明，无需学习或操作
- 消息总能送达：任何格式转换错误都必须 fallback 到纯文本，不能因格式问题导致消息丢失

### Maintainability（可维护性）
- 每个平台转换函数需有独立单元测试，覆盖：代码块、列表、加粗、表格降级、链接等典型 case
- 转换函数需添加 JSDoc 注释，说明该平台支持的 MD 语法子集（作为活文档）
- 所有平台的 MD 支持子集整理到 `server/src/modules/bridge/PLATFORM_MARKDOWN.md` 作为参考文档

### Scalability & Extensibility（可扩展性）
- 新增平台时，复制现有转换函数模板（`markdownToXxxFormat`），实现 `SenderFn` 接口
- 当前设计不强制抽象公共转换层（YAGNI），但函数命名规范 `markdownTo{Platform}Format` 需统一
- 配置化：各平台 MD 支持子集不做配置化（过度设计），以代码注释形式固化

---

## 十三、架构影响分析

### 受影响模块

| 模块 | 文件路径 | 影响类型 | 风险级别 |
|---|---|---|---|
| platform-senders | `server/src/modules/bridge/platform-senders.ts` | 直接改动（修改 feishuSend、dingtalkSend、wecomSend、qqSend 及新增转换函数） | d=1 WILL CHANGE |
| platform-senders.test | `server/src/modules/bridge/platform-senders.test.ts`（如有） | 需新增测试 | d=1 WILL CHANGE |
| bridge.service | `server/src/modules/bridge/bridge.service.ts` | 无变化（仅调用 sender，不感知格式） | 无影响 |
| bridge-webhook-adapters | `server/src/modules/bridge/bridge-webhook-adapters.ts` | 无变化 | 无影响 |
| 飞书/钉钉/企微/QQ Open API | 外部服务 | 接口调用参数可能变化（如 WeCom 新增 content 字段转换） | Low |

### 数据模型变更
- 新增表/集合: 无
- 修改 schema: 无
- Migration required: No
- Breaking changes: 无

### 接口合约变化
- 新增内部函数: `markdownToWecomMarkdown`, `markdownToQQPlainText`, `markdownToDingtalkMarkdown`
- 修改函数: `markdownToFeishuCard`（内部实现，签名不变）
- 无对外 API 变更，无 Socket.io event 变更

### 集成点
- `feishuSend` → Feishu API `/im/v1/messages`（msg_type 保持 `interactive`，content 内容格式规范化）
- `dingtalkSend` → DingTalk API `/v1.0/robot/groupMessages/send`（msgParam.text 格式规范化）
- `wecomSend` → WeCom API `/appchat/send`（markdown.content 格式规范化）
- `qqSend` → QQ API `/v2/groups/{id}/messages`（content 清理 MD 符号）

### 风险摘要

| 风险 | 级别 | 缓解方案 |
|---|---|---|
| 飞书 card markdown 方言与官方文档不一致 | Medium | 上线前实测各元素渲染效果，以实测为准 |
| WeCom 转义后内容超出 2048 字符限制 | Low | 增加截断逻辑（can be measured by existing logs） |
| 正则转换破坏代码块内的特殊字符 | Medium | 先提取代码块占位，转换后还原（参考 markdownToTelegramHtml 已有模式） |
| 降级 fallback 循环（card→text 再次失败） | Low | fallback 仅触发一次，失败后记录日志，不再重试 |

**整体架构风险**: Low ✅

---

## 十四、认知复杂度评估

**主流程（用户视角）**:
1. 用户在平台群聊中发送消息给 AI
2. AI 回复自动以正确格式显示

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 主流程步骤数（用户侧） | 2 步 | 低 |
| 决策点数量（用户侧） | 0 个 | 低 |
| 新概念数量（用户侧） | 0 个（对用户透明） | 低 |

**综合评级**: 低负担 ✅

**基准对比** [推演]:
| 产品 | 同功能步骤数 | 来源 |
|---|---|---|
| Slack Bot | 2 步（发消息→收格式化回复） | Phase 0.5 benchmark |
| Telegram Bot | 2 步 | 已有实现 |

**结论**: 我们的设计与基准持平，用户感知 0 新增步骤。

---

## 十五、YAGNI 审查

### 已通过 YAGNI 审查的需求项

| 需求项 | 保留理由 | 对应验收标准 |
|---|---|---|
| 飞书 card 格式规范化 | 飞书是主要平台，每次 AI 回复都经过此路径 | AC1-AC4 |
| 钉钉 MD 格式规范化 | 当前代码有已知 bug（表格乱码），直接影响用户 | AC5-AC8 |
| 企微 MD 方言转换 | WeCom 透传标准 MD 必然乱码，有现实痛点 | AC5-AC8 |
| QQ MD 符号清理 | msg_type=0 裸露符号是实测问题，不是假设 | AC9-AC11 |

### Deferred 项

| 需求项 | 标记原因 | 触发条件 |
|---|---|---|
| 飞书表格 → tag:table JSON | 实现复杂（需 MD 表格 AST 解析），ROI 低；当前用户场景中表格频率低 | 当飞书平台用户明确反馈表格不可读，且 AI 表格回复频率 > 20% 时 |
| QQ msg_type=2 Markdown | 需要 QQ Bot 特殊审批权限，不是默认开放 | 当 QQ 平台大规模接入且有 Bot 权限时 |
| 跨平台公共转换层 | 当前 5 个平台各有特殊性，强行抽象增加维护成本 | 当 3 个以上平台共享 50% 以上转换逻辑时 |
| 用户可配置渲染模式 | 无用户需求，纯推测性设计 | 当有明确用户提出配置需求时 |

---

## 十六、扩展预留建议

**架构扩展点**:
- 函数命名规范 `markdownTo{Platform}Format` 统一，新增平台直接添加新函数，不改现有逻辑
- `BridgePlatformAdapter` 接口不需要扩展（sendMessage 已接收 string text，转换在函数内部完成）

**后续迭代方向（Won't 候选）**:
- 飞书表格渲染 — 触发条件: 用户反馈表格频率 > 20% 且飞书 card table API 稳定
- QQ Markdown API — 触发条件: QQ Bot 权限开放且用户规模支撑投入

**配置化建议**:
- 各平台 MD 支持子集硬编码在转换函数中（以代码注释记录），不配置化
- 字符长度截断阈值（WeCom 2048，Feishu 4096）可提取为常量，但不需要外部配置

---

## 十七、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 不引入第三方 MD 解析库 | unified/remark/marked | 转换需求有限（5 种语法映射），正则足够；引入 AST 解析增加包体积和维护成本 | 2026-05-19 |
| QQ 保持 msg_type=0，仅清理符号 | 升级到 msg_type=2 Markdown | QQ Markdown API 需要特殊权限审批，风险不可控；清理符号是安全可行的最小改动 | 2026-05-19 |
| Feishu 表格降级纯文本 | 解析 MD 表格重建 Feishu card JSON table | MD → Feishu card table JSON 结构复杂，首版不值得投入；信息保留比丢失更重要 | 2026-05-19 |
| WeCom 代码块用【代码】标签包裹 | 删除代码内容 / 保留围栏 | 保留代码内容是最高优先级；【代码】标签是企微用户可理解的视觉分隔 | 2026-05-19 |
| 各平台独立转换函数，不抽象公共层 | 抽象 MarkdownConverter 接口 | YAGNI：当前平台差异大于共性，过早抽象增加维护成本 | 2026-05-19 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
