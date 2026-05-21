# Requirements Document: 群组模板包

**Generated**: 2026-05-21
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 现在的群聊就相当于完整的一个工作流，群聊支持导入导出。同时导入导出群助手及其分类。以后还需要做市场。可以维护群聊市场。直接下载导入的本地。但是助手那一块可能需要注意，每个人的模型不一样。包括文本、语音和图片。就是助手的所有信息。还有技能。但是完整把技能也导入导出。  需要注意重复导入的各种问题。
>
> 叫群组模板包吧

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| Slack Channel Templates | 将 channel 里的 canvas、list、workflow 打包成模板，导入后生成可编辑副本 | 模板是预配置协作空间，不是原对象迁移 |
| Slack Workflow Templates | 从模板出发，用户补齐蓝色占位输入后发布 | 导入后补配置，而不是要求源环境完全一致 |
| Notion Templates / Duplicate | 公开页面和模板可直接复制到自己的 workspace，并继续私有化编辑 | 市场分发与本地副本分离 |
| Figma Community | Community 资源可 duplicate 到 Drafts，本地副本不带评论和版本历史 | 复制可用结构，不复制不可迁移上下文 |

### 用户心智模型

用户会默认认为“模板包”应该是一份可下载、可导入、可立即二次编辑的协作工作流副本，而不只是聊天记录导出。[推演]

### 行业惯例

- 模板创建的是新副本，不覆盖已有对象。
- 模板应包含结构化资产和默认配置，但不强绑定导入方的私有账号、密钥和环境。
- 导入前需要让用户知道模板里包含什么，以及哪些内容需要导入后补配置。
- 市场中的公开模板与本地导入实例应分层管理。

### 已知反模式

- 直接导出运行态快照，导入后因本地模型、路径、权限不同而大量失效。
- 使用名称作为唯一冲突判断，导致重复导入时误覆盖。
- 将绝对路径、密钥、私有 provider ID 作为模板硬依赖。
- 将模板和实例混为一体，后续无法支持版本更新或市场分发。

### 认知复杂度上限

- Slack/Notion/Figma 同类主流程通常在 3-5 步、2-3 个决策点。
- 群组模板包核心导入流程不应超过这个基线，除非存在必须的兼容性修复步骤。

### 基准结论

- ✅ 方向应对齐“模板 = 可复制的工作流资产副本”这一惯例。
- ✅ 导入后允许本地补配置，尤其是模型、语音、图片能力相关项。
- ⚠️ 若把完整技能、本地路径、模型绑定无区分地全部强导入，将偏离成熟产品的“结构可复制、环境需映射”模式。

---

## 三、官方文档核验

⚠️ Phase 0.6 未命中当前方案必须依赖的外部 API/SDK/平台能力定义；本稿中的技术约束主要来自项目内现有代码、Prisma schema、前后端类型与现有技能导入能力，不涉及外部官方 API 形态结论。[推演]

---

## 四、可行性 & 假设清单

### 假设提取

| # | Assumption | Risk if Wrong | Confidence |
|---|---|---|---|
| 1 | 用户希望导出的对象是“群组工作流结构”，而非聊天历史备份 | 若实际期待历史恢复，会遗漏消息与记忆恢复能力 | Medium |
| 2 | 助手的模型能力可以拆成“逻辑能力描述 + 本地环境映射” | 若必须强绑定 provider ID，跨设备导入会高失败率 | Medium |
| 3 | 技能目录可以作为可迁移资产独立复制 | 若技能依赖大量本地文件或外部仓库状态，完整导入会不稳定 | Medium |
| 4 | 重复导入最常见诉求是“生成副本”而不是“覆盖更新” | 若用户更想增量升级，v1 仅副本导入会不够 | Medium |
| 5 | 后续市场需要复用同一模板包格式 | 若市场另起一套格式，会造成二次迁移成本 | High |

### 技术可行性信号

- **Current stack**: 现有代码已具备 `ChatRoom` / `ChatRoomAgent` / `Agent` / `AgentCategory` / `AgentCapability` / `CronTask` 等实体基础，且已有群聊复制能力与技能导入能力。
- **Known blockers**:
  - 当前群聊复制仅覆盖群聊和成员关系，不覆盖完整工作流资产。
  - 助手模型配置包含 `llmProviderId`、`codexModel`、`claudeModel`、`speechConfig`、图片/音频 capability，明显依赖本地环境。
  - 技能导入当前面向“共享技能目录”，还没有“模板包内嵌技能载荷”的统一封装。
- **Third-party dependencies**: 无外部强依赖；本期主要是本地打包/导入与现有前后端模块扩展。
- **Feasibility verdict**: ✅ Clear path

### Dependency Identification

- **Other teams/services**: Web 前端、Fastify 网关、Prisma 数据层、技能管理模块、未来模板市场模块
- **External stakeholders**: 模板创建者、模板导入者、未来模板市场运营者
- **Upstream dependencies**: 现有助手配置体系、技能目录结构、群聊/群成员数据模型
- **Downstream dependents**: 模板市场、群聊初始化流程、助手分发流程、后续模板版本升级能力

### Scope Boundary Declaration

**In scope:**
- 群组模板包的导出、下载、本地导入
- 群组基础信息、群助手、分类映射、规则、默认助手、触发模式、定时任务、技能、能力配置的模板化
- 跨环境模型能力映射与缺失配置提示
- 重复导入冲突识别与处理规则
- 为未来模板市场预留统一模板元数据与包格式

**Out of scope (this iteration):**
- 模板市场的审核、付费、评分、搜索排序 — reason: 当前需求核心是先固定包格式与导入语义
- 聊天消息历史、执行记录、长期记忆的完整迁移 — reason: 更偏备份/恢复，不是模板复用主路径
- 外部平台机器人实例、密钥、Webhook 等高敏配置迁移 — reason: 强环境绑定且存在安全风险

**Deliberately excluded:**
- 导入时直接覆盖现有群组实例 — reason: 回滚复杂且与成熟产品“复制副本”心智冲突

### Reversibility Score

| Dimension | Score | Reason |
|---|---|---|
| Data migration cost | Medium | 需要新增模板包元数据与导入记录，但不必强改现有核心表 |
| API contract changes | Medium | 需要新增导入导出接口与状态反馈 |
| User-facing behavior change | Medium | 群组会新增模板入口与导入向导 |
| Downstream system impact | High | 若包格式和冲突规则设计错误，会影响后续模板市场与兼容性 |

**Overall reversibility**: High cost

---

## 五、5W2H 全景分析

**What** — 做什么
> 提供“群组模板包”能力，将一个群组视为一套可复用工作流，支持把群组结构、群助手、分类、规则、定时任务、技能及能力配置打包导出，并在另一台本地环境或未来模板市场中导入为新的群组副本。

**Why** — 为什么做
> 用户已经把群聊当成完整工作流使用；如果不能迁移和复用，优秀配置只能手工重建。该能力同时是未来“群组模板市场”的底层资产格式。

**Who** — 谁来用
> 主要用户: 工作流创建者 / 群组管理员  
> 次要用户: 团队成员、模板下载者、未来模板发布者  
> 受影响方: 前后端开发、技能维护者、市场运营者

**When** — 什么时候用
> 触发时机: 创建好一套群组工作流后想复用、分享、跨设备迁移，或从市场安装模板时  
> 使用频率: 中频（配置阶段高频、日常运行低频）  
> 时间约束: 导入后应尽快可用，缺失配置应在导入阶段显式暴露

**Where** — 在哪里用
> 使用环境: Web、Desktop、本地 API  
> 入口位置: 左侧群聊列表头部提供“导入模板包”；群聊右键菜单提供“导出模板包”；未来模板市场页复用同一套导入链路

**How** — 怎么做
> 核心操作路径: 导出模板包 → 下载文件 / 发布到市场 → 导入模板包 → 预览包含内容 → 处理模型/命名/技能冲突 → 生成新群组  
> 技术实现方向: 在现有群聊、助手、技能与能力配置之上增加统一模板清单、包格式、导入映射器与冲突处理器

**How Much** — 做到什么程度
> 规模/量级: 单个模板包需支持 1 个群组、多个助手、多个技能目录、若干定时任务与分类关系  
> 质量标准: 导入成功时应生成结构完整且可编辑的新群组；环境不兼容项必须清晰提示  
> 验收底线: 同一模板包可稳定导出、导入、重复导入，不发生静默覆盖或敏感配置泄露

---

## 六、用户角色 & 使用场景

### 主要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | AI 工作流配置管理员 |
| 使用频率 | 中频（每周） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 快速复用一套已经调好的多助手群组工作流 |
| 最大痛点 | 重新配置助手、分类、技能和模型映射成本很高，且容易漏项 |

### 次要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 模板市场运营人员 [推演] |
| 使用频率 | 中频（每周） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 维护可分享的模板目录并确保导入体验一致 |
| 最大痛点 | 没有统一模板资产格式时，市场无法稳定分发 |

### 受影响方

- 团队成员: 导入后直接使用新群组，受模板质量与能力映射结果影响
- 技能维护者: 需要确保技能在模板导入后仍可安装与识别

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 将现有群组导出成模板包 | 用户已调好一套群组工作流 | 生成一个可下载、可分享的模板包 | 不能泄露本地密钥、绝对路径与私有环境绑定 |
| 从本地模板包导入为新群组 | 用户拿到一个模板包文件 | 一键生成可编辑、尽量可运行的新群组 | 本地模型供应商与源模板可能不一致 |
| 重复导入同一模板包 | 用户多次尝试安装同一个模板 | 不误覆盖、不制造难以辨认的冲突对象 | 同名群组、同名助手、同 slug 技能可能已存在 |
| 将模板包接入未来市场 | 平台需要提供公开模板下载与安装 | 复用相同包格式支撑发布、下载、更新 [推演] | 本期不做完整市场运营能力 |

---

## 七、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 导出现有群组工作流 | 用户需要手工记录群规则、助手 prompt、分类、技能和模型能力，重建一次容易遗漏多处配置 [推演] | 一次导出即可沉淀可复用工作流资产，降低重复搭建成本 | 优秀工作流无法复用，群组仍停留在“单次配置”阶段 |
| 本地导入模板包 | 即使已有相似群聊复制能力，也无法完整带走技能、能力配置和未来市场元数据 | 新环境可快速得到结构完整的新群组，并只补必要的本地模型映射 | 用户迁移成本高，模板市场无法建立稳定安装预期 |
| 处理模型差异 | 不同用户本地 provider、文本/语音/图片模型能力不同，直接复制配置会失败或失真 | 通过逻辑能力映射与缺失提示，提高跨环境成功率 | 模板导入后出现大量不可用助手，用户无法判断问题出在哪 |
| 重复导入 | 当前没有统一包 ID、版本和冲突处理规则，重复导入很容易出现名称混乱或静默覆盖 [推演] | 导入行为可预测，支持安全重复安装 | 一旦模板市场上线，重复安装与升级会成为高频投诉点 |

**价值可信度**
- ⚠️ 基于合理推断（行业经验/类似案例）[推演]

---

## 八、标准用户故事 & 验收标准

### Story 1
**User Story**: 作为 AI 工作流配置管理员，我想要把现有群组导出为模板包，以便把一套多助手工作流分享给他人或在别的本地环境复用。

**Acceptance Criteria**:
- [ ] AC1: When the user exports a group, the system shall generate one template package containing group metadata, agent definitions, category mappings, capability metadata, skills payload references, and scheduled task definitions.
- [ ] AC2: When the package is generated, the system shall exclude secrets, API keys, absolute local paths, runtime message history, execution records, and long-term memory summaries from the exported payload.
- [ ] AC3: When an exported skill source is a symlink or external reference, the system shall normalize it into package-owned content or a clearly declared missing dependency record.

**Out of scope for this story**: 导出聊天消息历史与执行审计数据

---

### Story 2
**User Story**: 作为 AI 工作流配置管理员，我想要从模板包导入一个新群组，以便无需手工重建整套助手协作配置。

**Acceptance Criteria**:
- [ ] AC1: When the user imports a valid template package, the system shall create a new group instance instead of overwriting any existing group.
- [ ] AC2: When the package contains agents with text, image, or audio capabilities, the system shall validate whether each capability can be mapped to a local provider or local model configuration before completing import.
- [ ] AC3: When any required capability cannot be mapped automatically, the system shall mark the imported agent as needing configuration and shall present the unresolved items before the user confirms import. Optional capabilities such as audio shall not block import and shall be shown only as optional follow-up enhancements.

**Out of scope for this story**: 自动替用户创建新的本地模型供应商

---

### Story 3
**User Story**: 作为模板下载者，我想要在导入前看到模板包包含哪些内容和哪些兼容性问题，以便决定是否继续安装。

**Acceptance Criteria**:
- [ ] AC1: When the user selects a template package, the system shall display a preview including group name, included agents, categories, skills, scheduled tasks, and unresolved compatibility items.
- [ ] AC2: When the preview detects excluded or degraded content, the system shall list each degraded item and the reason for degradation.
- [ ] AC3: While unresolved compatibility items exist, the system shall not silently finalize import without explicit user confirmation.

**Out of scope for this story**: 市场内评分、评论与榜单展示

---

### Story 4
**User Story**: 作为 AI 工作流配置管理员，我想要安全地重复导入同一个模板包，以便不会误覆盖现有资产，也不会造成无法理解的冲突。

**Acceptance Criteria**:
- [ ] AC1: When the user imports a package with the same template identifier and version as a previously imported package, the system shall detect the duplicate before creating new assets.
- [ ] AC2: When a duplicate is detected, the system shall offer explicit actions limited to create another copy, cancel import, or continue with a renamed copy.
- [ ] AC3: When imported assets conflict by name but not by template identity, the system shall create a new copy with deterministic renaming rules and shall preserve source metadata for future traceability.

**Out of scope for this story**: 已导入实例的原地升级

---

### Story 5
**User Story**: 作为未来模板市场运营人员 [推演]，我想要本地导入包和市场分发包使用同一资产格式，以便后续市场能力无需重新设计底层模板模型。

**Acceptance Criteria**:
- [ ] AC1: When the system exports a template package, the package shall include stable template metadata including template identifier, version, title, summary, author/source, created time, and compatibility declarations.
- [ ] AC2: When the system imports a package from local disk or future market download, the same validation and conflict rules shall apply.
- [ ] AC3: When market-specific fields are absent, the local import flow shall still accept the package if all required core template fields are present.

**Out of scope for this story**: 模板市场的发布审核流程

---

## Decision Log

| Decision | Alternatives Considered | Why This Choice |
|---|---|---|
| 模板导入默认创建副本 | 直接覆盖现有群组；导入后 merge 到已有群组 | 最符合 Slack/Notion/Figma 心智，也最容易回滚 |
| 模型配置采用“能力映射”而非强绑定 provider ID | 完整复制 `llmProviderId`；导入失败后再手调 | 每个人本地模型不同，强绑定会显著降低导入成功率 |
| 本期市场只预留统一包格式，不直接实现完整市场 | 同期把市场发布、搜索、审核、版本升级全做 | 当前核心返工点在包格式与导入语义，不在市场运营功能 |
| 技能以“完整内容或声明式降级”导出 | 只导出技能名；依赖导入方再下载 | 用户明确要求完整导入导出技能，且市场分发也需要可离线安装资产 |

---

## 九、5Why 根因挖掘

**Surface requirement**: 群组需要支持模板包导入导出，并兼容未来模板市场。

**Why 1**: Why does the user need this?
> Because: 用户已经把群组当成完整工作流使用，重建成本高。

**Why 2**: Why does 重建成本高 matter?
> Because: 群组不只是名字和成员，还包含助手、分类、技能、能力配置和自动化规则。

**Why 3**: Why does that matter?
> Because: 这些配置分散在不同模块里，手工迁移容易遗漏并造成运行差异。

**Why 4**: Why does 运行差异 matter?
> Because: 一旦导入后不可用，用户对模板和市场的信任会迅速下降。

**Why 5**: Why does trust in templates matter?
> Because: 模板要成为产品的工作流分发基础设施，前提是“可复用且可预期”，否则无法形成可持续的分享和市场生态。

**Root Insight**: 真正要解决的不是“文件导入导出”，而是“把群组工作流沉淀为可分发、可迁移、可复用的产品资产”。

**Implication for design**: 模板包必须优先定义稳定资产边界、环境兼容策略和重复导入规则，而不是先做一个简单 ZIP 导出。

---

## 十、Kano 需求分类

### Basic Requirements (用户默认期望，不做就扣分)
- 模板包能导出并导入为新群组副本 — why it's basic: 这是功能成立的最小闭环
- 导入前可预览包含内容与不兼容项 — why it's basic: 不预览会让导入结果不可预测
- 重复导入不静默覆盖现有资产 — why it's basic: 这是模板安装的安全底线
- 导入后模型差异有明确映射或待配置提示 — why it's basic: 当前需求已明确指出每个人模型不一样

### Performance Requirements (做得越好用户越满意)
- 自动匹配更多本地文本/语音/图片能力 — improvement axis: 自动匹配率越高，导入后可立即使用的助手越多
- 技能打包后的完整度与成功率 — improvement axis: 技能越少降级，模板复用价值越高
- 模板预览信息的清晰度 — improvement axis: 用户越容易判断导入影响，决策成本越低

### Excitement Requirements (超预期惊喜，做了加分)
- 未来支持模板版本升级与实例同步差异视图 [推演] — why it delights: 让模板不只是复制，还能演进
- 市场内精选模板集合与推荐 [推演] — why it delights: 降低发现成本
- ⚠️ Benchmark check: 当前检索到的成熟产品主要强调复制与模板库，未强调实例升级能力，因此该项保留为后续验证项

### Indifferent / Reverse (需要讨论是否值得做)
- 导入时自动创建缺失的外部供应商账号 [推演] — classification: Reverse — recommendation: 不做，风险高且越权

### Kano-MoSCoW Alignment Check

| Kano Type | Expected MoSCoW | Mismatches to Flag |
|---|---|---|
| Basic | Must | 无 |
| Performance | Should/Could | 无 |
| Excitement | Could/Won't | 无 |

---

## 十一、MoSCoW 优先级

### Must (必须做)
| # | Requirement | Evidence (benchmark/pain point) |
|---|---|---|
| M1 | 导出群组模板包并生成可下载文件 | 用户显式表达“群聊支持导入导出” |
| M2 | 模板包包含群组、群助手、分类、技能、能力配置、规则与定时任务定义 | 用户显式表达“助手的所有信息”“完整把技能也导入导出”；当前群组已被视为完整工作流 |
| M3 | 导入时创建新群组副本而非覆盖 | Slack/Notion/Figma 均采用 duplicate/copy 心智 |
| M4 | 处理文本、语音、图片模型差异并提供映射/待配置机制 | 用户显式表达“每个人的模型不一样，包括文本、语音和图片” |
| M5 | 检测重复导入并提供显式冲突处理 | 用户显式表达“需要注意重复导入的各种问题” |
| M6 | 模板包具备未来市场可复用的稳定元数据 | 用户显式表达“以后还需要做市场” |

### Should (应该做)
| # | Requirement | Why Not Must |
|---|---|---|
| S1 | 导入前模板内容预览与降级说明 | 强烈建议，但理论上可由导入后查看替代，因此不是最小成立条件 |
| S2 | 自动匹配本地现有 provider 与 capability | 有手动补配置兜底 |
| S3 | 对技能来源做“完整复制 / 降级声明”统一处理 | 重要但可先接受部分技能需手动修复的情况 |

### Could (可做可不做)
| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | 模板封面、标签、简介编辑器 | 提升市场可运营性，但不影响基础导入导出 |
| C2 | 导入完成后生成兼容性修复向导 | 可作为第二阶段体验优化 |

### Won't (本期不做)
| # | Requirement | Decision Reason |
|---|---|---|
| W1 | 模板市场发布、审核、搜索、评分、付费 | 本期目标是沉淀模板资产格式，不是搭市场运营系统 |
| W2 | 聊天历史、执行记录、长期记忆完整迁移 | 这是备份恢复问题，不是模板复用核心 |
| W3 | 已导入实例的原地升级与双向同步 | 需求未直接要求，且会显著增加冲突复杂度 |
| W4 | 自动创建或同步本地 LLM 供应商密钥配置 | 安全风险高，且不应替用户操控本地敏感配置 |

### YAGNI Flags

Items detected as speculative / future-proofing (not required now):
- 模板市场评分评论系统 → Moved to Won't. Reason: no current requirement justifies this.
- 模板实例升级同步 → Moved to Won't. Reason: current ACs can all pass without it.

---

## 十二、功能详细需求定义

### 功能 1: 模板包导出

**功能描述**
> 系统允许用户从现有群组生成一个群组模板包文件，用于本地导入或未来市场分发。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| chatRoomId | string | 是 | UUID/现有群组 ID | 要导出的群组 |
| packageTitle | string | 否 | 1-100 字符 | 默认使用群组名称 |
| packageSummary | string | 否 | 0-500 字符 | 模板简介 |
| includeSkills | boolean | 是 | true/false | 是否导出技能内容 |
| includeCronTasks | boolean | 是 | true/false | 是否导出定时任务定义 |

**处理逻辑**
1. 系统读取群组基础信息、成员中的助手定义、分类关系、规则、默认助手、触发模式、定时任务和可迁移能力配置。
2. 系统剔除消息历史、执行记录、记忆摘要、密钥、绝对工作目录、本地私密 provider 标识。
3. 系统为模板生成稳定元数据，包括 templateId、version、exportedAt、sourceAppVersion、内容摘要与兼容性声明。
4. 系统对技能做内容打包；若技能无法完整打包，则写入降级记录。
5. 系统输出单个模板包文件。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 模板包下载信息、模板元数据摘要 | file + JSON metadata |
| 失败 | 失败原因 | error object |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 群组不存在 | 返回明确错误，不生成文件 |
| 群组内无助手 | 仍允许导出，仅导出群组结构 |
| 技能目录缺失 | 导出成功，但在包内写入缺失技能清单 |
| 并发请求 | 同一群组多次导出应生成独立文件，不互相覆盖 |
| 网络超时 | 已生成的临时文件应清理，返回可重试错误 |
| 权限不足 | 仅群组有权限的用户可导出 |

**与其他功能的依赖关系**
- 依赖: 功能 5 的模板元数据规范
- 被依赖: 功能 2、功能 3

---

### 功能 2: 模板包导入预检

**功能描述**
> 系统在真正创建群组前，对模板包做解析、预览、兼容性检查与冲突识别。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| packageFile | file | 是 | 模板包文件 | 用户选择的模板包 |
| importMode | string | 否 | `preview` | 本功能仅做预检 |

**处理逻辑**
1. 系统解析模板包结构与版本。
2. 系统展示群组、助手、分类、技能、定时任务摘要。
3. 系统检查 templateId/version 是否曾被导入。
4. 系统检查助手能力是否能映射到本地文本、语音、图片能力。
5. 系统生成预检结果，包括可导入项、需配置项、降级项、冲突项。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 预检报告、兼容性结果、冲突选项 | JSON |
| 失败 | 无法解析、版本不支持、包损坏等错误 | error object |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 文件为空 | 返回“模板包不能为空” |
| 版本过旧/过新 | 返回明确版本兼容提示 |
| 缺少必填元数据 | 标记为无效模板包，禁止继续 |
| 并发请求 | 每次预检结果独立缓存，不串用状态 |
| 网络超时 | 前端保留原文件选择状态，允许重试 |
| 权限不足 | 无导入权限用户不得看到确认入口 |

**与其他功能的依赖关系**
- 依赖: 功能 5 的模板元数据规范
- 被依赖: 功能 3、功能 4

---

### 功能 3: 模板包导入落地

**功能描述**
> 用户确认后，系统将模板包导入为新的群组副本，并写入导入来源信息。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| packageFile | file | 是 | 模板包文件 | 已通过预检的模板包 |
| groupName | string | 否 | 1-100 字符 | 不填时用模板默认名 |
| unresolvedMappings | array | 否 | 映射列表 | 用户手动补的模型/能力映射 |
| duplicateAction | string | 是 | `cancel` / `create_copy` / `rename_copy` | 重复导入处理方式 |

**处理逻辑**
1. 系统基于模板创建新群组，不修改任何现有群组。
2. 系统创建或关联分类、助手、能力配置、技能副本与定时任务。
3. 系统对无法自动映射的能力保留“待配置”状态。
4. 系统写入导入来源元数据，用于未来去重与追踪。
5. 系统返回新群组 ID 与导入报告。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 新群组 ID、导入报告、待处理项 | JSON |
| 失败 | 导入失败原因 | error object |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 禁止提交 |
| 超出取值范围 | duplicateAction 非法时返回 400 |
| 并发请求 | 同一包被同时导入时，每次都按独立副本创建，不共享临时对象 |
| 网络超时 | 后端应保证导入事务性，避免半成品群组 |
| 权限不足 | 阻止导入并返回权限错误 |

**与其他功能的依赖关系**
- 依赖: 功能 2 的预检结果
- 被依赖: 功能 4

---

### 功能 4: 重复导入与冲突处理

**功能描述**
> 系统识别模板级重复和资产级命名冲突，避免静默覆盖。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| templateId | string | 是 | 稳定模板标识 | 来自模板包 |
| version | string | 是 | 语义化版本或内部版本号 | 来自模板包 |
| assetFingerprints | array | 是 | 摘要列表 | 用于内容级比对 |

**处理逻辑**
1. 系统按 templateId + version 检查是否导入过同一模板包。
2. 系统按资产来源 ID 与 fingerprint 识别助手、技能、分类的潜在重复。
3. 若是模板级重复，系统只允许取消、创建副本或重命名副本。
4. 若只是命名冲突，系统按确定性规则重命名，并保留来源信息。
5. 系统在导入结果中输出冲突处理明细。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 冲突判断结果、建议动作、最终处理记录 | JSON |
| 失败 | 冲突检测失败原因 | error object |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 禁止继续导入 |
| 超出取值范围 | 非法版本或非法动作返回错误 |
| 并发请求 | 使用唯一导入会话，避免重复检测状态互串 |
| 网络超时 | 不得在未知状态下自动继续导入 |
| 权限不足 | 不展示可执行处理动作 |

**与其他功能的依赖关系**
- 依赖: 功能 2、功能 3
- 被依赖: 无

---

### 功能 5: 模板元数据与市场兼容规范

**功能描述**
> 系统为模板包定义统一元数据，使本地导入和未来市场下载共享同一资产格式。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| templateId | string | 是 | 稳定唯一标识 | 模板身份 |
| version | string | 是 | 版本号 | 模板版本 |
| title | string | 是 | 1-100 字符 | 模板标题 |
| summary | string | 否 | 0-500 字符 | 模板简介 |
| source | object | 是 | 作者/来源信息 | 本地或市场来源 |
| compatibility | object | 是 | 文本/语音/图片能力声明 | 导入预检依据 |

**处理逻辑**
1. 系统在导出时写入统一元数据。
2. 系统在导入时以相同元数据驱动校验、预览和冲突判断。
3. 市场专属字段缺失时，本地导入仍可接受核心模板包。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 规范化模板元数据 | JSON |
| 失败 | 缺失必填字段或格式错误 | error object |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 模板无效 |
| 超出取值范围 | 标题/版本不合法时拒绝导出或导入 |
| 并发请求 | 同一模板元数据生成应可重复，不依赖运行时顺序 |
| 网络超时 | 元数据校验失败不应创建任何群组对象 |
| 权限不足 | 仅有导出/发布权限者可生成对外模板 |

**与其他功能的依赖关系**
- 依赖: 无
- 被依赖: 功能 1、功能 2、功能 4

---

## 十三、非功能需求

### Performance (性能)
- Response time: 模板预检接口在包含 10 个以内助手、20 个以内技能目录时，P95 响应时间应小于 2 秒。[推演]
- Throughput: 支持单用户串行导入为主，无需高并发优化；同一用户并发导入至少支持 3 个会话。[推演]
- Data volume: 单个模板包应支持中等规模技能内容，若超出限制需在导出阶段给出明确提示。[推演]
- Degradation behavior: 当技能过大或能力映射无法完成时，系统应降级为“部分导入 + 待配置提示”，不得静默失败。

### Security (安全)
- Authentication: 仅登录用户可导入导出模板包。
- Authorization: 仅具备群组管理权限的用户可导出该群组模板包；导入权限受群组创建权限控制。
- Data sensitivity: 模板包默认视为敏感配置资产，不得包含 API key、token、Webhook secret、绝对本地路径。
- Attack surface: 需防止恶意模板包触发路径穿越、任意文件写入、脚本注入、压缩包炸弹等风险。[推演]
- Audit trail: 导入、导出、冲突处理结果需记录审计日志，至少包含操作者、时间、模板 ID、版本、结果。

### Compatibility (兼容性)
- Browser/platform targets: 与现有 Web / Desktop 导入导出能力保持一致。
- API versioning: 模板包格式必须包含版本号；导入端需支持向后兼容至少一个稳定版本。[推演]
- Data format compatibility: 本地导出包与未来市场下载包使用同一核心格式。
- Third-party integration constraints: 不依赖外部市场服务即可完成本地导入导出。

### Usability (易用性)
- Learnability: 新用户应能在不阅读外部文档的情况下完成“选择模板包 → 预览 → 导入”主流程。
- Error recovery: 显式给出待配置项、降级项、冲突项和下一步建议。
- Accessibility: 无特殊要求，遵循系统默认标准。
- Mobile/responsive: 导入预览页面在桌面端优先保证完整性，移动端至少可查看摘要并禁止高风险确认。[推演]

### Maintainability (可维护性)
- Code coverage expectation: 导入导出、冲突处理、能力映射逻辑需有针对性的单测与集成测试。
- Documentation requirements: 需要模板包格式说明、字段说明、导入降级规则说明。
- Observability: 需记录导出大小、预检失败原因、导入失败原因、自动映射命中率等指标。[推演]
- Deployment: 模板能力应支持失败回滚，避免半导入状态残留。

### Scalability & Extensibility (可扩展性)
- Growth assumptions: 6-12 个月内需要承接模板市场，因此包格式应稳定且可扩展。[推演]
- Extension points: 模板元数据、能力映射器、技能打包器、冲突策略器应为独立扩展点。
- Configuration vs code: 冲突重命名规则、导出内容开关、兼容性策略应尽量配置化。
- Multi-tenancy: 当前单租户本地产品可不引入复杂多租户模型，但模板来源信息应预留作者/市场来源字段。

---

## 十四、架构影响分析 [Iteration Mode]

### Affected Modules

| Module | File/Path | Impact Type | Risk Level |
|---|---|---|---|
| ChatRoom Service | [chatroom.service.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/chatroom/chatroom.service.ts:330) | Direct change | d=1 WILL BREAK [推演，非实际扫描] |
| Skill Import Service | [skill-install.service.ts](/Users/liqing/qing/code/team/teamagentx/server/src/modules/skill/skill-install.service.ts:940) | Interface change | d=1 WILL BREAK [推演，非实际扫描] |
| Skill Gateway | [skill.gateway.ts](/Users/liqing/qing/code/team/teamagentx/server/src/gateway/skill.gateway.ts:1232) | Direct change | d=1 WILL BREAK [推演，非实际扫描] |
| Prisma Schema | [schema.prisma](/Users/liqing/qing/code/team/teamagentx/server/prisma/schema.prisma:37) | Data model change | d=2 LIKELY [推演，非实际扫描] |
| Web Agent / Chat APIs | [agent-api.ts](/Users/liqing/qing/code/team/teamagentx/apps/web/src/lib/agent-api.ts:1) | Behavior change | d=2 LIKELY [推演，非实际扫描] |

### Data Model Changes

- New tables/collections: 建议新增 `TemplatePackage`、`TemplateImportRecord` 或等价模型 [推演]
- Modified schemas: 可能需要为导入来源、模板 identity、能力映射状态增加字段 [推演]
- Migration required: Yes — complexity: Medium
- Breaking changes: 不应破坏现有 `ChatRoom` / `Agent` 运行路径，应通过新增模型与新增接口承接

### Interface Contract Changes

- New APIs: 导出模板包、预检模板包、确认导入模板包、查询导入历史 [推演]
- Modified APIs: 群组复制能力可能需要抽象为模板实例化底层能力 [推演]
- Deprecated APIs: 无
- Event/message schema changes: 导入进度、兼容性结果、冲突处理结果可能需要新的前端交互响应 [推演]

### Integration Points

- Services this feature calls: chatroom service、agent service、skill install service、cron task service、Prisma
- Services that will call this feature: Web settings page、future marketplace page [推演]
- Shared state / caches affected: 助手执行缓存、技能共享目录、群组列表缓存 [推演]

### Risk Summary

| Risk | Level | Mitigation |
|---|---|---|
| Breaking existing callers | Medium | 新增模板接口，尽量不改现有基础 CRUD 契约 |
| Data migration failure | Medium | 使用新增表和可选字段，避免重构核心表语义 |
| Performance regression | Low | 导入导出属于低频管理操作，可采用后台处理与预检缓存 |
| Rollback complexity | High | 采用“新建副本 + 导入事务 + 导入记录”策略，避免覆盖式导入 |

**Overall architecture risk**: High

补充说明:
- `duplicate` 方法的 gitnexus 上游影响为 `LOW`，说明当前复制能力的直接调用面有限，但它覆盖面也明显不足，不能直接等同于模板实例化。
- `importExternalSkill` 的 gitnexus 上游影响为 `LOW`，说明可作为技能打包/导入基础能力扩展。

---

## 十五、认知复杂度评估

### 主流程分析

**主流程名称**: 从模板包导入新群组

**步骤拆解**:
1. 选择本地模板包文件
2. 查看模板预览
3. 处理冲突与不兼容项
4. 确认导入
5. 进入新群组

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 5 | 中 |
| 决策点 | 3 | 中 |
| 新概念数量 | 4（模板包、能力映射、降级项、重复导入） | 中 |

**综合评级**: 中等

### 基准对比

| 产品 | 同功能步骤数 | 来源 |
|---|---|---|
| Slack 模板 | 4-5 步 | Phase 0.5 benchmark |
| Notion Duplicate | 3-4 步 | Phase 0.5 benchmark |
| Figma Duplicate | 3-4 步 | Phase 0.5 benchmark |

**结论**: 我们的设计与基准持平，但“模型/能力映射”额外引入了一个必要决策点，这是由产品域差异决定的。

---

## 十六、YAGNI 审查与扩展预留建议

### 已通过 YAGNI 审查的需求项（确认保留）

| 需求项 | 保留理由 | 对应验收标准 |
|---|---|---|
| 导出群组模板包 | 用户原始需求直接提出 | Story 1 / AC1 |
| 导入时处理模型能力差异 | 用户原始需求直接提出 | Story 2 / AC2 / AC3 |
| 完整导入导出技能 | 用户原始需求直接提出 | Story 1 / AC3 |
| 重复导入检测 | 用户原始需求直接提出 | Story 4 / AC1-AC3 |
| 统一模板元数据 | 后续市场已被明确提出，且若不先定格式后续返工成本高 | Story 5 / AC1-AC3 |

### Deferred 项（推测性/过度设计，本期不做）

| 需求项 | 标记原因 | 触发条件（何时再评估） |
|---|---|---|
| 模板实例升级同步 | 删掉它当前 AC 仍全部成立 | 当模板市场出现“已安装模板更新”需求时 |
| 模板评分/评论/榜单 | 当前需求未要求 | 当开始做模板市场运营闭环时 |
| 自动创建本地 provider/密钥 | 安全与越权风险高 | 当产品提供安全的本地 provider 初始化流程时 |

### 扩展预留建议（架构层面）

| 扩展点 | 预留方式 | 为什么现在就要预留 |
|---|---|---|
| 模板市场来源信息 | 在元数据中预留 source/author/channel 字段 | 否则本地包与市场包会分叉 |
| 能力映射策略 | 用独立映射器处理文本/语音/图片 capability | 否则后续支持更多模型类型会侵入导入主流程 |
| 技能打包策略 | 用独立技能打包器区分复制、降级、缺失声明 | 否则技能导入逻辑难扩展 |

### 配置化建议

- 冲突命名规则应配置化，不硬编码为唯一文案
- 导出内容开关应配置化，例如是否包含定时任务、是否包含技能内容
- 模型能力映射规则应配置化，支持不同 provider 匹配策略

---

## 十七、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 使用“群组模板包”作为统一资产名 | 群聊模板包、群组资产包 | 更产品化，也能覆盖未来市场场景 | 2026-05-21 |
| 导入默认创建新副本 | 覆盖现有群组、合并到已有群组 | 降低误操作与回滚风险 | 2026-05-21 |
| 本期只做市场兼容，不做完整市场 | 同期做模板市场全链路 | 先解决格式和导入语义，减少返工 | 2026-05-21 |
| 不导出敏感本地配置 | 全量导出一切助手字段 | 跨环境兼容与安全性优先 | 2026-05-21 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
