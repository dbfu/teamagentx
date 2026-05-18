# Requirements Document: 远程语音 API（TTS + STT 独立配置）

**Generated**: 2026-05-18
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 必须stt 和 tts 都必须通过接口。不能软件内置。查看是否免费的接口可以用。先使用免费的接口。
> tts 和 stt 要支持可以单独配置。而且最好国内外的模型都支持。

**背景补充**（对话中明确的上下文）：
- 现有浏览器 `SpeechRecognition` API 依赖 Google 服务，国内完全不可用
- 现有 edge-tts 是本地 Python 二进制，依赖系统安装，不可靠
- 用户群体同时包括国内用户和国际用户，需兼顾两种网络环境

---

## 二、竞品基准研究

### 参考产品与行业惯例

**SiliconFlow（硅基流动）**
- TTS：CosyVoice 系列，支持 `/audio/speech` OpenAI 协议，有免费额度（具体额度随官方政策变动）
- STT：SenseVoice-Small，支持 `/audio/transcriptions` OpenAI 协议，有免费额度
- 接口地址：`https://api.siliconflow.cn`，国内可直连
- 适合作为国内用户的默认推荐

**Groq**
- STT：Whisper Large v3 Turbo，支持 `/audio/transcriptions` OpenAI 协议
- 免费额度：2000 req/day，7200 sec/hour
- 仅支持 STT，无 TTS
- 适合国际用户的免费 STT 选项

**OpenAI**
- TTS：`/audio/speech`，gpt-4o-mini-tts 等，付费
- STT：`/audio/transcriptions`，whisper-1，付费
- 行业标准协议，众多兼容供应商的参考基准

**行业惯例发现**：
1. OpenAI 协议（`/audio/speech` + `/audio/transcriptions`）已成为语音 API 的事实标准，SiliconFlow / Groq / Azure / 阿里云均提供兼容接口
2. TTS 和 STT 在主流平台均为独立配置（不同模型、不同供应商），未有平台强制捆绑
3. 音频录制统一使用浏览器 `MediaRecorder` API，上传后由服务端调用 STT，而非依赖浏览器内置识别
4. 国内供应商（SiliconFlow、阿里云、科大讯飞）均提供 OpenAI 协议兼容接口，通过统一抽象可无缝切换

**主要反模式**：
- 把语音识别绑定到特定浏览器 API（`SpeechRecognition`），导致国内可用性归零
- TTS 和 STT 共用一套供应商配置，无法独立指向不同服务商
- 前端直接调用语音 API，泄露用户 API Key
- 在客户端内置语音模型（模型体积 > 软件体积本身）

---

## 三、可行性 & 假设清单

### 假设提取

| # | 假设 | 风险等级 | 风险描述 |
|---|---|---|---|
| A1 | SiliconFlow 免费额度长期稳定 | Medium | 官方政策可能调整，免费额度缩减或取消 |
| A2 | OpenAI 协议 TTS/STT 接口可作为统一抽象 | Low | 已有多家供应商实现，风险低 |
| A3 | 浏览器 `MediaRecorder` API 在所有目标平台可用 | Low | Chrome/Firefox/Edge/Safari 均已支持 |
| A4 | 音频文件上传服务端后调 STT 的延迟用户可接受 | Medium | 相比实时流式识别，有额外 RTT，需测量 |
| A5 | 现有 `LlmProvider` 表结构可复用存储语音供应商配置 | Low | 字段完全兼容（baseUrl + apiKey + model） |
| A6 | edge-tts 现有用户（选了 edge 预设的助手）迁移无感 | Medium | 需要归一化旧配置，迁移到新 provider |

### 技术可行性

- **当前栈**：Fastify 服务端已有 `/speech/tts` 网关 + SpeechRouter 框架，复用即可
- **已知阻塞点**：
  - edge-tts 的 3 个内置预设（edge-xiaoxiao / edge-xiaoyi / edge-yunxi）需迁移或下线
  - `AgentSpeechConfig` 当前只有一个 `profile`（TTS 用），需扩展 `sttProfile` 字段
  - 前端录音功能需从 SpeechRecognition 迁移到 MediaRecorder
- **第三方依赖**：依赖用户配置的语音供应商（SiliconFlow / Groq / OpenAI），无法自行控制可用性
- **可行性结论**：✅ 已有框架可复用，主要工作是新增 STT 路径 + 配置扩展

### 依赖方识别

- **上游**：LlmProvider 表（现有，存储供应商配置）
- **下游**：助手语音配置页面（需新增 STT 配置项）、语音输入 UI 组件
- **受影响**：选用了 edge-tts 预设的已有助手配置

### 范围边界

**本期做：**
- 新增服务端 `openai-compatible-stt` provider
- 新增 `POST /speech/stt` 网关（接收音频文件 → 返回转写文本）
- 前端录音改为 `MediaRecorder` → 上传 → 调 `/speech/stt`
- `AgentSpeechConfig` 扩展 `sttProfile` 字段（独立于 TTS 的 `profile`）
- 助手配置页新增 STT 供应商配置 UI
- 移除 edge-tts 本地 provider（保留 provider ID 作为历史数据归一化入口）
- 旧 edge-tts 预设迁移（自动降级到 browser-local 或让用户重新选择）

**本期不做：**
- 流式 STT（实时逐字识别）— 需要 WebSocket，成本高，第二阶段
- 移动端语音输入 — Flutter 端有独立方案，不在本次范围
- 语音供应商健康状态监控 — 第二阶段
- TTS 结果缓存 — 第二阶段

**明确永不做：**
- 在客户端内置本地语音模型（已明确拒绝，体积问题）
- 依赖浏览器 SpeechRecognition API 作为生产 STT（国内不可用）

### 可逆性评分

| 维度 | 分数 | 原因 |
|---|---|---|
| 数据迁移成本 | Medium | AgentSpeechConfig JSON 扩展字段，需归一化旧数据 |
| API 合约变更 | Low | 新增接口，现有 `/speech/tts` 不变 |
| 用户感知变更 | Medium | 录音方式变化，UI 新增 STT 配置项 |
| 下游影响 | Low | 语音模块已隔离，改动不外溢 |

**综合可逆性**：Medium

---

## 四、5W2H 全景分析

**What** — 做什么
> 将语音输入（STT）和语音输出（TTS）全部迁移到远程 API，移除本地二进制依赖。TTS 和 STT 支持独立配置各自的供应商、模型、音色等参数。默认推荐使用 SiliconFlow 等提供免费额度且国内可访问的供应商。

**Why** — 为什么做
> 现有浏览器 `SpeechRecognition` API 依赖 Google 服务，在中国大陆完全不可用，导致语音输入功能对国内用户等同于不存在。同时 edge-tts 本地二进制要求用户手动安装 Python 包，运维成本高且不可控。远程 API 方案可覆盖国内外用户，免安装，按需切换供应商。

**Who** — 谁来用
> 主要用户：使用 TeamAgentX 与 AI 助手对话的终端用户（发起语音输入、收听语音回复）
> 次要用户：管理员 / 助手配置者（配置助手的 TTS / STT 供应商）
> 受影响方：选用了 edge-tts 预设的已有助手（历史配置需迁移）

**When** — 什么时候用
> 触发时机：用户在聊天界面按住录音按钮 → 松开 → 语音被识别为文字输入
> 触发时机2：助手回复完成 → 语音自动播报或用户手动触发 TTS
> 使用频率：中高频（语音输入依赖用户习惯，语音播报取决于助手配置）
> 时间约束：无硬性 deadline，但国内用户语音功能已损坏，属紧急修复级别

**Where** — 在哪里用
> 使用环境：Web 浏览器（主要）、Electron 桌面端（复用 Web）
> 入口位置：聊天界面录音按钮、助手配置页语音 Tab

**How** — 怎么做
> TTS 路径（已有，维持）：前端 → `POST /speech/tts` → 服务端 openai-compatible-tts provider → 返回音频流
> STT 路径（新增）：前端 MediaRecorder 录音 → 上传音频文件 → `POST /speech/stt` → 服务端 openai-compatible-stt provider → 返回转写文本
> 配置方式：助手语音配置页面，TTS 和 STT 各自独立选择供应商和模型

**How Much** — 做到什么程度
> 规模：单个用户单次录音，音频文件不超过 25MB（OpenAI 协议限制），时长不超过 5 分钟 [推演]
> 质量标准：STT 识别延迟 < 5s（从上传完成到返回文字），TTS 延迟保持现有水平
> 验收底线：国内用户能正常完成语音输入 → 文字的完整流程，不依赖 Google 服务

---

## 五、用户角色 & 使用场景

### 主要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 日常使用者（产品内部用户，在国内网络环境下使用 TeamAgentX） |
| 使用频率 | 中频（每天使用聊天，语音输入偶尔触发） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 用语音快速输入问题，收听助手语音回复 |
| 最大痛点 | 点击录音按钮后无响应，或识别结果始终为空（国内网络下 SpeechRecognition 失败） |

### 次要用户角色

| 字段 | 内容 |
|---|---|
| 角色名称 | 助手配置者（负责设置助手参数的管理员或高级用户） |
| 使用频率 | 低频（偶尔调整助手配置） |
| 技术熟练度 | 技术用户 |
| 核心目标 | 为助手选择高质量的 TTS 音色，并指定 STT 供应商（国内 / 国际）|
| 最大痛点 | TTS 和 STT 被强制捆绑同一供应商，无法独立优化 |

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 场景 1：国内用户语音输入 | 聊天界面按住录音按钮 | 说出问题，识别为文字发送 | 国内网络，不能访问 Google 服务 |
| 场景 2：配置助手 TTS/STT | 进入助手语音配置 Tab | 分别设置 TTS 和 STT 供应商 | 需要有已配置的 LlmProvider（语音兼容） |
| 场景 3：国际用户切换供应商 | 修改助手 STT 配置 | 换用 Groq Whisper（更快速） | 需要有 Groq API Key |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 | 可信度 |
|---|---|---|---|---|
| 国内用户语音输入 | 浏览器 SpeechRecognition 在国内调用 Google 服务失败，表现为录音按钮按下无任何响应或永久等待，用户无法完成任何语音输入 | 通过 SiliconFlow 等国内可访问的 STT 接口完成识别，国内用户语音输入与国际用户体验一致 | 国内用户语音功能完全不可用，形同虚设，存在用户流失风险 | ✅ 实测可复现 |
| TTS/STT 独立配置 | 现有配置只有 TTS profile，STT 无法配置。用户无法为助手指定 STT 供应商 | TTS 和 STT 各自配置供应商、模型，可组合使用（如 SiliconFlow TTS + Groq STT） | 无法根据不同场景优化识别质量和成本，只能接受单一供应商 | ⚠️ 基于合理推断 |
| edge-tts 本地依赖 | edge-tts 需在服务端安装 Python 二进制，未安装时报 ENOENT 错误，用户无明确提示且无法自助解决 | 移除本地二进制依赖，TTS 完全走远程 API，服务端无需任何前置安装 | 使用 edge-tts 预设的助手在未安装环境下静默失败，影响助手可用性 | ✅ 已知问题 |

---

## 七、标准用户故事 & 验收标准

### Story 1：国内用户完成语音输入

**User Story**: 作为在中国大陆网络环境中使用 TeamAgentX 的日常使用者，我想要按住录音按钮说出我的问题并自动识别为文字，以便不需要手动打字就能提问。

**Acceptance Criteria**:
- [ ] AC1: When 用户按住录音按钮超过 0.5 秒后松开，the system shall 将录音上传并调用配置的 STT 服务，在 8 秒内将识别文字填入输入框
- [ ] AC2: When STT 识别成功，the system shall 将识别文字直接填充到消息输入框，用户可编辑后发送
- [ ] AC3: When STT 识别失败（网络错误 / 供应商不可用），the system shall 在输入框下方显示错误提示文字，不自动发送任何内容
- [ ] AC4: When 用户在国内网络环境下使用已配置 SiliconFlow 的助手，the system shall 不依赖 Google 服务完成识别
- [ ] AC5: When 录音时长不足 0.5 秒，the system shall 忽略该次录音，不发起 STT 请求

**Out of scope for this story**: 实时逐字显示（流式 STT）、离线识别

---

### Story 2：助手配置者独立配置 TTS 和 STT

**User Story**: 作为助手配置者，我想要在助手语音配置页面分别为 TTS 和 STT 选择不同的供应商和模型，以便根据质量和成本独立优化语音输入和语音输出。

**Acceptance Criteria**:
- [ ] AC1: When 进入助手语音 Tab，the system shall 展示 TTS 配置区域和 STT 配置区域，两者独立存在
- [ ] AC2: When 用户修改 STT 配置中的供应商选择，the system shall 不影响 TTS 配置中已选的供应商
- [ ] AC3: When 用户为 TTS 选择 SiliconFlow、为 STT 选择 Groq，the system shall 保存后实际 TTS 调用 SiliconFlow `/audio/speech`、STT 调用 Groq `/audio/transcriptions`
- [ ] AC4: When 选择的供应商未配置 API Key（LlmProvider 不存在或 key 为空），the system shall 在配置 UI 显示警告，提示用户先完成供应商配置
- [ ] AC5: When 保存助手配置，the system shall 将 ttsProfile 和 sttProfile 独立持久化到 AgentSpeechConfig JSON

**Out of scope for this story**: 语音供应商的测试播放（试听）、批量修改多个助手

---

### Story 3：edge-tts 历史助手平滑迁移

**User Story**: 作为选用了 edge-xiaoxiao / edge-xiaoyi / edge-yunxi 预设的已有助手配置者，我想要在系统移除 edge-tts provider 后助手仍然可以正常使用 TTS，以便不需要手动重新配置每个助手。

**Acceptance Criteria**:
- [ ] AC1: When 服务端移除 edge-tts provider 后，调用 TTS 时检测到 `provider = 'edge-tts'`，the system shall 自动 fallback 到 browser-local provider 而非报错
- [ ] AC2: When 读取含 `edge-tts` provider ID 的历史 AgentSpeechConfig，the system shall 归一化为可用 provider（`browser-local`），不抛异常
- [ ] AC3: When 助手使用 edge-tts 归一化后的 browser-local provider 成功播报，the system shall 在响应头 `X-Speech-Provider` 中返回实际使用的 provider（`browser-local`）

**Out of scope for this story**: 自动将 edge-tts 配置映射到 SiliconFlow 远程 TTS（需要用户主动配置 API Key）

---

### 决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| STT 使用服务端中转（MediaRecorder → 上传 → /speech/stt） | 前端直接调 STT API | API Key 不暴露给浏览器；统一审计入口；与 TTS 架构对称 | 2026-05 |
| edge-tts 降级为 fallback 到 browser-local，而非映射到远程 | 自动迁移到 SiliconFlow | 迁移到远程需要 API Key，不能无感；browser-local 不丢数据 | 2026-05 |
| 复用 LlmProvider 表存储语音供应商配置 | 新建 SpeechProvider 表 | LlmProvider 已有 baseUrl / apiKey / model 字段，完全兼容；避免重复建模 | 2026-05 |
| TTS 和 STT 各自独立的 profile 字段 | 共用一个 profile | 两者最优供应商往往不同；国内 TTS 选项和 STT 选项并不完全重叠 | 2026-05 |
| 优先推荐 SiliconFlow 作为默认 | 阿里云语音、科大讯飞 | SiliconFlow 同时支持 TTS + STT，OpenAI 协议，免费额度，接口最简单 | 2026-05 |

---

## 八、5Why 根因挖掘

**Surface requirement**: 语音功能必须全程走远程 API，不能软件内置

**Why 1**: 为什么现有方案（browser-local STT）不可用？
> 因为：`SpeechRecognition` API 在国内网络环境下依赖 Google 服务，完全不可访问，用户录音后无任何响应

**Why 2**: 为什么 Google 服务不可用会导致功能归零？
> 因为：浏览器将识别请求发往 Google 服务器，该服务器在中国被屏蔽，前端没有任何 fallback 路径

**Why 3**: 为什么没有 fallback 路径？
> 因为：现有架构将 STT 绑定到单一的浏览器 API，没有"远程 STT provider" 的概念，切换路径不存在

**Why 4**: 为什么没有预留远程 STT provider 的扩展点？
> 因为：语音功能最初只考虑了浏览器本地方案，将 TTS 和 STT 都视为"本地能力"，未预期国内可用性问题

**Why 5**: 为什么没有预期国内可用性问题？
> 因为：语音功能在设计时缺乏对国内特殊网络环境的约束建模，导致关键依赖（Google 服务）不在产品可控范围内

**Root Insight**: 将语音能力绑定到平台无法控制的外部基础设施（Google 浏览器服务），是根本风险所在。解决方案不是"找另一个本地方案"，而是将语音 API 调用路径纳入应用可配置、可替换的范围内。

**Implication for design**: 需求方向正确——将 TTS 和 STT 全部纳入 provider 抽象，通过服务端中转调用可配置的远程 API，彻底解耦浏览器平台差异。

---

## 九、Kano 需求分类

### Basic Requirements（用户默认期望，不做就扣分）

- **录音后能得到识别文字** — 语音输入的核心功能，用户进入录音流程就默认此能力存在
- **识别结果填入输入框** — 行业惯例，任何语音输入产品均如此（Notion / 飞书 / 微信都如此）
- **错误时给出明确提示** — 基础用户体验，不能静默失败

### Performance Requirements（做得越好用户越满意）

- **识别速度**：STT 延迟越低越好，5s 是可接受上限，<2s 体验明显更好
- **识别准确率**：普通话识别率 > 95% 为基线，越高越好
- **支持的语言数量**：支持多语言识别对跨语言用户场景有明显加分

### Excitement Requirements（超预期惊喜）

- **自动选择最优供应商**（国内用户自动选 SiliconFlow，国际用户自动选 Groq）— ⚠️ Benchmark check: 暂无主流产品自动按地区路由语音 API，建议本期不做，作为 Could 处理
- **实时逐字识别**（流式 STT）— 超预期体验，但需 WebSocket，本期不做

### Indifferent

- **STT 供应商品牌展示** — 用户不关心调用的是哪家 API，Indifferent，不在 UI 前台展示
- **音频格式选择** — 用户不关心 webm / wav / mp3 的格式差异，内部决策即可

### Kano-MoSCoW 对齐检查

| Kano Type | MoSCoW | 检查结果 |
|---|---|---|
| Basic：录音识别 + 结果填入 + 错误提示 | Must | ✅ 对齐 |
| Performance：识别速度 | Should | ✅ 对齐 |
| Excitement：自动地区路由 | Won't（本期） | ✅ 对齐 |

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | 需求 | 证据 |
|---|---|---|
| M1 | 服务端新增 `openai-compatible-stt` provider，调用 `/audio/transcriptions` 接口 | 用户显式要求：STT 必须通过接口，不能内置 |
| M2 | 新增 `POST /speech/stt` 网关（JWT 鉴权，接收音频文件，返回转写文本） | 与 `/speech/tts` 对称，是 STT 服务端化的唯一入口 |
| M3 | 前端录音改为 `MediaRecorder` → 上传音频 → 调 `/speech/stt` | 用户显式要求 + 现有 SpeechRecognition 国内不可用（实测） |
| M4 | `AgentSpeechConfig` 扩展 `sttProfile` 字段，与 TTS `profile` 独立存储 | 用户显式要求：TTS 和 STT 要支持单独配置 |
| M5 | 助手语音配置页新增 STT 供应商配置区域（独立于 TTS 区域） | 用户显式要求：单独配置 |
| M6 | 移除 edge-tts 本地 provider 注册，旧 provider ID 做归一化兜底 | 用户显式要求：不能软件内置 + 现有实现依赖本地二进制 |
| M7 | 旧 `edge-tts` 供应商 ID 读取时自动 fallback 到 `browser-local`（不报错） | 行业惯例：历史数据迁移不能导致运行时崩溃 |

### Should（应该做）

| # | 需求 | 理由 |
|---|---|---|
| S1 | 录音 UI 显示录音中动效（波形 / 计时） | 用户体验改善，非核心功能路径 |
| S2 | STT 配置中展示供应商可用状态（API Key 是否已填） | 减少配置错误，但错误时已有明确提示可兜底 |
| S3 | SiliconFlow 作为 STT 推荐默认项，预置到 UI 选择列表 | 降低配置门槛，但不影响功能本身 |
| S4 | 录音时长上限校验（> 5 分钟提示） | 保护服务端，但大多数使用场景不会超限 |

### Could（可做可不做）

| # | 需求 | 推迟原因 |
|---|---|---|
| C1 | 录音结束后预览音频（播放回放） | 需求未提及，复杂度高，用户习惯上不常见 |
| C2 | STT 历史记录（显示历次识别文本） | 属于审计功能，本期不需要 |
| C3 | 多语言自动检测（识别时不指定语言） | SiliconFlow 支持，但未在需求中明确 |

### Won't（本期不做）

| # | 需求 | 决策原因 |
|---|---|---|
| W1 | 流式实时 STT（逐字显示） | 需要 WebSocket 持久连接，架构复杂度高，第二阶段 |
| W2 | 移动端语音输入 | Flutter 端独立实现，本次不涉及 |
| W3 | 语音供应商自动地区路由 | 暂无实际需求支撑，Deferred（见 YAGNI） |
| W4 | TTS 结果缓存 | 第二阶段，与本次重构正交 |
| W5 | edge-tts 迁移向导（引导用户切换供应商） | 用户数量少，成本不值得，自动 fallback 已足够 |

---

## 十一、功能详细需求定义

### 功能 1：服务端 openai-compatible-stt Provider

**功能描述**
> 在服务端语音模块注册新的 `openai-compatible-stt` provider，调用 OpenAI 协议的 `/audio/transcriptions` 接口完成语音识别。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| audioBuffer | Buffer | 是 | 二进制音频数据 | 支持 webm / mp4 / wav / mp3 |
| mimeType | string | 是 | `audio/webm`, `audio/wav`, etc. | 上传文件类型 |
| task.profile.provider | string | 是 | `openai-compatible-stt` | provider 标识 |
| task.profile.model | string | 否 | 如 `SenseVoiceSmall`, `whisper-1` | 不指定时使用供应商默认 |
| task.profile.language | string | 否 | BCP-47 语言码，如 `zh` | 不指定时供应商自动检测 |
| task.context.agentId | string | 否 | Agent ID | 用于解析供应商配置 |

**处理逻辑**
1. 从 `task.context.agentId` 解析 `AgentSpeechConfig.sttProfile`，获取供应商配置
2. 从 `LlmProvider` 表查询对应供应商（同 openai-compatible-tts 的解析逻辑）
3. 校验供应商 `apiProtocol = 'openai'`，否则抛出配置错误
4. 校验 URL 安全性（仅允许 https，或 localhost 的 http）
5. 构造 `multipart/form-data` 请求，包含 `file`、`model`、`language`（若有）字段
6. 调用 `${baseUrl}/audio/transcriptions`，超时 30s
7. 解析响应 JSON，提取 `text` 字段
8. 返回 `SpeechArtifact { kind: 'transcript', text, provider: 'openai-compatible-stt' }`

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | SpeechArtifact with text | `{ kind: 'transcript', text: string, provider: string }` |
| 供应商返回错误 | 抛出错误 | string 错误消息 |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| agentId 对应的供应商未配置 STT | 抛出错误：`'未找到可用的语音识别供应商'` |
| 音频文件超过供应商限制（25MB） | 返回 400 错误，提示文件超限 |
| 供应商返回非 JSON 响应 | 抛出错误：`'STT 服务返回格式无效'` |
| 网络超时 | 30s 后抛出超时错误 |
| URL 安全校验失败 | 抛出错误，不发起请求（不触发 fallback） |

**与其他功能的依赖关系**
- 依赖：功能 4（AgentSpeechConfig.sttProfile 扩展）
- 被依赖：功能 2（/speech/stt 网关）

---

### 功能 2：POST /speech/stt 网关

**功能描述**
> 服务端新增 `POST /speech/stt` 接口，接收音频文件，调用 openai-compatible-stt provider，返回转写文本 JSON。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| Authorization | Header | 是 | `Bearer <JWT>` | 身份鉴权 |
| file | multipart | 是 | 音频二进制 | 支持 webm / wav / mp3 / mp4 |
| agentId | body/query | 否 | string | 用于解析助手 STT 配置 |
| language | body | 否 | BCP-47 | 识别语言提示 |

**处理逻辑**
1. JWT 鉴权，失败返回 401
2. 解析 multipart 表单，提取音频文件，大小校验 ≤ 25MB
3. 从请求参数获取 `agentId`，构造 `SpeechTask<{ audioBuffer, mimeType }>`
4. 调用 `serverSpeechService.execute(task)`，路由到 `openai-compatible-stt` provider
5. 取 `artifact.text` 返回 JSON 响应

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 转写文本 | `{ "text": "识别结果", "provider": "openai-compatible-stt" }` |
| 失败 | 错误信息 | `{ "error": "..." }` + 对应 HTTP 状态码 |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 未携带 Authorization | 返回 401 |
| 文件大小 > 25MB | 返回 400，`{ "error": "音频文件不得超过 25MB" }` |
| 无音频文件 | 返回 400，`{ "error": "缺少音频文件" }` |
| STT provider 不可用 | 返回 502，`{ "error": "语音识别服务不可用" }` |
| 并发请求 | 无特殊限制，由供应商侧速率限制兜底 |

**与其他功能的依赖关系**
- 依赖：功能 1（openai-compatible-stt provider）
- 被依赖：功能 3（前端录音 → STT 流程）

---

### 功能 3：前端录音改为 MediaRecorder + STT 接口调用

**功能描述**
> 前端聊天界面的录音按钮改用 `MediaRecorder` API 录制音频，松开后上传到 `/speech/stt` 获取识别文字，填入输入框。移除对 `SpeechRecognition` API 的依赖。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| 用户操作 | 按住/松开录音按钮 | — | 按住时长 ≥ 0.5s | 短于 0.5s 的按压忽略 |
| 麦克风权限 | 浏览器权限 | 是 | 用户授予 | 未授权时提示用户 |

**处理逻辑**
1. 按住按钮：请求麦克风权限（若未授权），开始 `MediaRecorder` 录音
2. 松开按钮：停止录音，获取音频 Blob
3. 判断时长：< 0.5s 则丢弃，不发请求
4. 上传音频 Blob 到 `POST /speech/stt`，携带当前 `agentId`
5. 请求中展示"识别中..."状态
6. 收到响应：将 `text` 填入消息输入框，用户可编辑
7. 失败：在输入框下方展示错误提示，不清空输入框

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 识别成功 | 文字填入输入框 | string |
| 识别失败 | 错误提示文字 | UI 提示（非 toast，靠近录音按钮） |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 麦克风权限被拒绝 | 弹出提示："请允许麦克风权限后重试" |
| 录音时长 < 0.5s | 静默丢弃，不发 STT 请求，不显示任何提示 |
| 网络超时（> 10s） | 显示超时提示，保留已有输入框内容 |
| 录音时已有输入框内容 | 识别结果追加到已有内容后（加空格），不覆盖 |
| 浏览器不支持 MediaRecorder | 录音按钮显示为禁用状态，hover 提示"当前浏览器不支持录音" |

**与其他功能的依赖关系**
- 依赖：功能 2（/speech/stt 接口）
- 被依赖：无

---

### 功能 4：AgentSpeechConfig 扩展 sttProfile 字段

**功能描述**
> 在 `AgentSpeechConfig` 类型中增加 `sttProfile: SpeechProfile | null` 字段，与现有 `profile`（TTS 专用）独立存储，支持 TTS 和 STT 配置不同供应商。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| sttProfile.provider | string | 否 | `openai-compatible-stt` | STT provider ID |
| sttProfile.model | string | 否 | 如 `SenseVoiceSmall` | 不填时使用供应商默认 |
| sttProfile.language | string | 否 | BCP-47 | 识别语言 |
| sttProfile.vendorOptions.llmProviderId | string | 否 | LlmProvider ID | 指定语音供应商 |

**处理逻辑**
1. `normalizeAgentSpeechConfig` 更新：新增 `sttProfile` 字段的默认值填充（`null` 时不填充，保持空）
2. `serializeAgentSpeechConfig` / `deserializeAgentSpeechConfig` 自动包含 `sttProfile`（JSON 序列化天然支持）
3. 旧有 JSON 数据无 `sttProfile` 字段时，反序列化后 `sttProfile = null`，不报错

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 旧 AgentSpeechConfig JSON 无 sttProfile | 反序列化结果 `sttProfile = null`，STT 调用使用系统默认配置 |
| sttProfile.provider 不合法 | 归一化时保留原值，运行时路由失败会有明确错误 |

**与其他功能的依赖关系**
- 依赖：无（基础 schema 变更）
- 被依赖：功能 1、功能 5

---

### 功能 5：助手语音配置页 STT 配置区域

**功能描述**
> 在助手语音配置页的语音 Tab 中，新增独立的 STT（语音输入）配置区域，允许用户选择 STT 供应商、模型，与 TTS 配置区域并列展示。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| 用户界面操作 | 下拉选择供应商 | 否 | 已配置的 LlmProvider 列表 | 留空表示使用系统默认 |

**处理逻辑**
1. STT 配置区域展示已配置的 LlmProvider 列表（过滤 `apiProtocol = 'openai'` 的供应商）
2. 用户选择供应商后，可选填 STT 模型名称
3. 用户点击保存：将 `sttProfile` 写入 `AgentSpeechConfig` 并调用 `PATCH /agents/:id`
4. 读取时：从 `AgentSpeechConfig.sttProfile` 回填 UI 状态

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 无已配置的 OpenAI 兼容供应商 | 显示提示："请先在供应商配置中添加语音兼容的供应商" |
| STT 配置留空 | 保存后 `sttProfile = null`，运行时使用系统默认 STT（若有）|

**与其他功能的依赖关系**
- 依赖：功能 4（sttProfile 字段）
- 被依赖：无

---

### 功能 6：移除 edge-tts Provider 并归一化历史配置

**功能描述**
> 从服务端默认语音服务实例中移除 edge-tts provider 注册，同时在配置读取时将 `provider = 'edge-tts'` 的历史数据自动归一化为 `browser-local`，保证旧配置不导致运行时错误。

**处理逻辑**
1. `server/src/modules/speech/default-service.ts`：移除 `createEdgeTtsProvider()` 注册
2. `normalizeSpeechProviderId()` 扩展：`'edge-tts' → 'browser-local'`（前后端均需更新）
3. edge-tts 的 3 个内置预设（edge-xiaoxiao / edge-xiaoyi / edge-yunxi）从预设列表中移除
4. 现有助手若 `profile.provider = 'edge-tts'`，读取时经归一化后使用 `browser-local`

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 调用 TTS 时 profile.provider = 'edge-tts' | 归一化为 browser-local，正常播报，不报错 |
| edge-tts provider 不在注册表 | SpeechRouter 找不到 provider 时，按 fallback 规则路由 |

**与其他功能的依赖关系**
- 依赖：无
- 被依赖：功能 1（保证 provider 注册表整洁）

---

## 十二、非功能需求

### Performance（性能）

- STT 识别延迟：从音频上传完成到收到识别文字，P90 < 5s（取决于供应商，不强制保证）
- TTS 延迟：维持现有水平，不因本次改动引入回归
- 音频上传：文件 ≤ 25MB，超出前端拦截，不发请求
- 服务端 `/speech/stt` 接口：无额外并发限制，由供应商侧速率限制兜底

### Security（安全）

- JWT 鉴权：`POST /speech/stt` 必须携带有效 JWT，与 `/speech/tts` 一致
- API Key 隔离：语音供应商 API Key 只存在于服务端，前端不可见
- URL 安全校验：openai-compatible-stt provider 沿用 openai-compatible-tts 的 URL 校验（仅 https，或 localhost http）
- 文件类型校验：服务端校验上传文件 MIME 类型，不接受非音频文件
- 审计：`X-Speech-Provider` 响应头记录实际调用的 provider

### Compatibility（兼容性）

- 浏览器：Chrome 74+，Firefox 79+，Safari 14.1+（MediaRecorder 支持范围）
- API 协议：仅支持 OpenAI 协议兼容的 `/audio/transcriptions` 接口（`apiProtocol = 'openai'`）
- 历史数据：旧 `AgentSpeechConfig` JSON（无 `sttProfile` 字段）向后兼容，读取时默认 null
- edge-tts provider ID 向后兼容（归一化而非报错）

### Usability（易用性）

- 录音流程：按住开始、松开结束，无需任何配置即可发起（前提是助手已配置 STT 供应商）
- 错误恢复：识别失败后，用户可重新录音或手动输入，不丢失当前输入框内容
- 配置页：TTS 和 STT 区域有明确标签区分，不混淆
- 无障碍：录音按钮有 aria-label，键盘用户可通过 Space 键触发（遵循现有 UI 规范）

### Maintainability（可维护性）

- openai-compatible-stt provider 结构与 openai-compatible-tts provider 保持一致，减少认知切换成本
- 无特殊 code coverage 要求，遵循项目默认标准
- 日志：服务端调用 STT 时记录 provider、model、音频时长（不记录音频内容）

### Scalability & Extensibility（可扩展性）

- 新增 STT 供应商：只需新增 provider 实现并注册，不需要修改网关或前端
- 语言配置：`sttProfile.language` 字段已预留，后续可在 UI 暴露语言选择
- 未来流式 STT：SpeechProvider 接口已有 `openRealtimeSession` 可选方法，可在不修改现有 provider 的前提下扩展

---

## 十三、架构影响分析（Iteration Mode）

### 受影响模块

| 模块 | 路径 | 影响类型 | 风险等级 |
|---|---|---|---|
| serverSpeechService 注册 | `server/src/modules/speech/default-service.ts` | Direct change（移除 edge-tts，无影响调用方） | LOW |
| speech.gateway | `server/src/gateway/speech.gateway.ts` | Direct change（新增 /speech/stt 路由） | LOW |
| normalizeSpeechProviderId | `server/src/modules/speech/speech-config.ts` | Direct change（新增 edge-tts 归一化） | LOW |
| speech-presets | `server/src/modules/speech/speech-presets.ts` | Direct change（移除 edge 预设） | LOW |
| AgentSpeechConfig type | `server/src/modules/speech/speech-config.ts` | Interface change（新增 sttProfile 字段） | LOW（JSON 字段新增，向后兼容） |
| assistant-voice-tab | `apps/web/src/components/chat/assistant-detail/assistant-voice-tab.tsx` | UI change（新增 STT 区域） | LOW |
| browser-local-provider | `apps/web/src/speech/providers/browser-local-provider.ts` | 移除 STT 部分使用（不删除，保留 TTS） | LOW |
| 前端录音 UI 组件 | 具体路径待探查 | Direct change（MediaRecorder 替换） | MEDIUM（需找到正确组件） |

### 数据模型变更

- 新表：无
- 修改 schema：`AgentSpeechConfig` TypeScript 类型新增 `sttProfile?: SpeechProfile | null` 字段（JSON 存储，无需 Prisma migration）
- Migration required：**No**（AgentSpeechConfig 以 JSON 字符串存于 `Agent.speechConfig`，新字段向后兼容）
- Breaking changes：无（旧数据读取时 sttProfile 为 undefined → 归一化为 null）

### 接口合约变更

- 新接口：`POST /speech/stt`（新增）
- 修改接口：无（`/speech/tts` 不变）
- 废弃接口：无

### 风险摘要

| 风险 | 等级 | 缓解 |
|---|---|---|
| 前端录音组件位置未确认 | M | 实施前先探查当前录音 UI 组件路径 |
| edge-tts 归一化遗漏（前端/服务端不同步） | L | 两端均更新 normalizeSpeechProviderId |
| SiliconFlow 免费额度政策变动 | M | 抽象层已隔离，切换供应商不需改代码 |

**整体架构风险：LOW**

---

## 十四、认知复杂度评估

### 主流程分析（终端用户：完成一次语音输入）

**步骤拆解**:
1. 按住录音按钮
2. 说出问题
3. 松开按钮
4. 等待识别（看到"识别中..."）
5. 识别结果出现在输入框，确认后发送

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 5 | 中等 |
| 决策点 | 1（是否接受识别结果/编辑后发送） | 低 |
| 新概念数量 | 0（与语音助手交互是普遍认知） | 低 |

**综合评级**：低负担（步骤数略高但全为线性操作，无认知分支）

### 主流程分析（配置者：配置助手 STT 供应商）

**步骤拆解**:
1. 进入助手设置 → 语音 Tab
2. 在 STT 配置区域选择供应商
3. 可选：填写模型名称
4. 点击保存

**指标统计**:
| 指标 | 数值 | 评级 |
|---|---|---|
| 步骤数 | 4 | 低 |
| 决策点 | 1（选哪个供应商） | 低 |
| 新概念数量 | 2（STT、供应商选择） | 低 |

**综合评级**：低负担

### 基准对比 [推演]

| 产品 | 同类功能步骤数 | 说明 |
|---|---|---|
| 飞书语音消息 | 3步（按住/说/松开） | 无识别等待感知，体验最流畅 |
| 微信语音 | 3步（同上） | 同类操作参考 |
| 我们的设计 | 5步（含等待 1 步，确认 1 步） | 相比多 2 步，但远程 API 有延迟不可避免 |

**结论**：与竞品相比多 2 步（等待 + 确认），这 2 步是远程 STT 固有延迟的自然呈现，可通过良好的等待动效降低感知负担。不需要简化。

---

## 十五、YAGNI 检查

### 已通过 YAGNI 审查的需求项

| 需求项 | 保留理由 | 对应验收标准 |
|---|---|---|
| openai-compatible-stt provider | 当前需求核心，无法缺少 | M1 |
| POST /speech/stt 网关 | 前端调用 STT 的唯一入口，当前就需要 | M2 |
| MediaRecorder 替换 SpeechRecognition | 国内可用性问题已发生，必须修复 | M3 |
| sttProfile 独立字段 | 用户明确要求 TTS/STT 分别配置 | M4 |
| edge-tts 移除 + 归一化 | 已明确不再使用本地二进制 | M6, M7 |

### Deferred 项（本期不做）

| 需求项 | 标记原因 | 触发条件 |
|---|---|---|
| 流式实时 STT | 无当前用户需求，架构成本高，YAGNi 规则 1 | 有用户明确反馈逐字识别体验需求时 |
| 语音供应商自动地区路由 | 推测性功能，用户未提及，YAGNI 规则 4 | 有明确多地区用户基数数据时 |
| STT 历史记录 / 审计 | 无当前需求，YAGNI 规则 5 | 有合规或审计明确需求时 |
| 录音多语言 UI 选择 | sttProfile.language 字段已预留，但 UI 暴露无当前需求 | 有非中文语音输入用户时 |

### 扩展预留建议

| 扩展点 | 预留方式 | 为什么现在就要预留 |
|---|---|---|
| 未来 STT provider（如阿里云、讯飞） | SpeechProvider 接口 + SpeechRegistry，新增只需 register | 已有框架，不堵路即可 |
| 流式 STT | SpeechProvider.openRealtimeSession 接口已定义 | 不实现但不删除接口，第二阶段直接扩展 |
| sttProfile.language | AgentSpeechConfig 已包含，UI 暂不暴露 | 字段已在 schema 中，后续增加 UI 零改动 |

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| STT 走服务端中转（前端 → /speech/stt → 供应商） | 前端直接调供应商 API | API Key 不暴露浏览器；统一入口便于鉴权和日志；与 TTS 架构对称 | 2026-05 |
| edge-tts 归一化为 browser-local（而非远程 TTS） | 自动迁移到 SiliconFlow | 远程 TTS 需要 API Key，无感迁移不可能；browser-local 作为兜底不丢可用性 | 2026-05 |
| 复用 LlmProvider 表存储语音供应商 | 新建 SpeechProvider 表 | 字段完全兼容（baseUrl/apiKey/model），避免重复建模 | 2026-05 |
| TTS profile 和 STT sttProfile 独立字段 | 共用一个 profile | 两者最优供应商往往不同；成本结构不同（TTS 按字符/STT 按时长） | 2026-05 |
| 默认推荐 SiliconFlow | 阿里云语音、科大讯飞、Groq | 同时支持 TTS + STT，OpenAI 协议，有免费额度，国内可直连，配置最简单 | 2026-05 |
| 移除 browser-local STT（SpeechRecognition） | 保留作为 fallback | 国内不可用，保留会给用户虚假的 fallback 感，不如去掉减少混乱 | 2026-05 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
