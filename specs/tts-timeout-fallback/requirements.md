# Requirements Document: TTS 超时 Fallback 竞态修复

**Generated**: 2026-05-18
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> 远程接口语音调用时长过长。需要提供解决方案。需要避免接口慢，导致 fallback。结果两个语音一起触发。那简直是灾难

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| ElevenLabs SDK | HTTP streaming + AbortController；fallback 触发时立即 abort 主请求 | Fallback 与 abort 绑定，结构上保证单声道 |
| Web Speech API | `speechSynthesis.cancel()` 在新 utterance 开始前必须调用 | 任何新播放前先 cancel 旧播放 |
| LiveKit Agents | TTS 队列中新任务进入时 abort 旧任务，不等旧任务完成 | abort-on-preempt 模式 |

### 用户心智模型
用户对语音播报的默认期望是"只有一个声音"，两个声音同时响被感知为严重系统错误，而非"慢了一点"的容忍范围。

### 行业惯例
1. **Fallback 触发时必须同步 abort 主请求**（AbortController）——这是防竞态的唯一正确姿势
2. **客户端应有独立的超时阈值**，低于服务端超时，控制 fallback 时机

### 已知反模式
- **无 AbortSignal 的 fallback**：fetch 飞行中，fallback 启动，fetch 完成后触发第二次播放
- **setTimeout + fallback 不带 cancel**：最常见的新手实现错误，看似正确，实则竞态
- **依赖 catch 块 fallback 但无 abort 机制**：当前实现，仅在接口报错时正确，慢不报错时有风险

### 认知复杂度基线
成熟产品主流程：1 步（触发 → 出声），0 个用户决策点。

### 基准结论
- ✅ 我们的方向与行业惯例对齐：abort + fallback 绑定
- ⚠️ 当前代码偏离惯例：fetch 无 AbortSignal，慢不等于报错，fallback 无法感知慢
- ❌ 风险：一旦引入超时逻辑（用户体验优化的必要方向），竞态必然出现

---

## 三、可行性 & 假设清单

### 假设提取

| # | 假设 | 风险等级 | 风险说明 |
|---|---|---|---|
| 1 | fallback 触发是因为接口慢而不是接口报错 | High | 当前代码只在 catch 里 fallback，慢不会触发 fallback——本方案加入超时后此假设成立 |
| 2 | 两个语音同时触发是由于 fetch 飞行中 + fallback 都完成了 | High | 这是需要设计保障的竞态场景，加超时后必然出现若无 abort |
| 3 | 远程 TTS 接口本身的延迟可以接受（1-8s），不需要换供应商 | Medium | 用户目标是不让慢导致 race，而非要求接口必须快 |
| 4 | `fallbackProvider: 'browser-local'` 在大部分用户侧已配置 | Medium | 未配 fallback 时，需求退化为"超时报错"，同样需要处理 |

### 技术可行性

- **当前栈**：Web `fetch()` API + `AbortController` 原生支持，路径清晰
- **已知阻塞点**：`apps/web/src/speech/providers/remote-tts-provider.ts` 的 fetch 调用无 `AbortSignal`
- **可行性**：✅ 清晰路径，改动集中在单文件约 10-15 行

### 依赖方识别

- **受影响模块**：`remote-tts-provider.ts`（主改动），`speech-service.ts`（验证兼容性）
- **下游调用方**：`browser-speech.ts` → `speakText()` → 所有 TTS 触发点（chat-message、chat-messages-list、assistant-voice-tab）
- **外部服务**：无变更（改动在客户端 fetch 层）

### 范围边界

**本期做：**
- 客户端 remote TTS fetch 增加 AbortSignal + 超时（默认 8000ms）
- 超时时 abort 请求后触发 fallback，保证单声道
- 超时可通过 `vendorOptions.timeoutMs` 覆盖

**明确不做（本期）：**
- 服务端流式 TTS（chunked transfer）——独立优化方向
- LlmProvider DB 查询缓存——收益小，不影响竞态问题

**永不做：**
- 允许同一 TTS 请求产生两次音频播放

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | 无数据变更 |
| API 合约变更 | Low | 内部接口，不暴露外部 |
| 用户行为变更 | Low | 对用户透明 |
| 下游系统影响 | Low | 仅 speech 模块内部 |

**整体可逆性：Low（低成本，可随时调整）**

---

## 四、5W2H 全景分析

**What**
为远程 TTS fetch 增加客户端超时控制（AbortController），超时时 abort 飞行中的请求后再触发 fallback，保证任意时刻最多一个语音在播放。

**Why**
远程 TTS 接口响应慢（1-30s 均有可能），若加入超时 fallback 而不 cancel 主请求，主请求仍会在 fallback 播放期间悄悄完成并触发第二次播放，造成双声道灾难。根本问题不是"接口太慢"，而是缺少 abort 机制保证 fallback 触发时主请求的生命周期终结。

**Who**
- 主要用户：配置了 `fallbackProvider: 'browser-local'` 的终端语音助手使用者
- 次要用户：平台配置管理员（需调整超时阈值）
- 受影响方：`speakText()` 的所有调用方

**When**
- 触发时机：每次调用 `speakText()` 且 provider 为远程供应商时
- 使用频率：高频（每条助手消息自动播报）

**Where**
- 客户端浏览器，`apps/web/src/speech/providers/remote-tts-provider.ts`
- 入口：`speakText()` → `webSpeechService.execute()` → `SpeechService.execute()`

**How**
1. 在 `remote-tts-provider.ts` 的 `synthesize()` 中创建 `AbortController`
2. 设定客户端超时（默认 8000ms，可通过 vendorOptions.timeoutMs 覆盖）
3. fetch 传入 `signal: controller.signal`
4. 超时后 `controller.abort()` → fetch 抛出 AbortError → rethrow → SpeechService 触发 fallback
5. fallback 触发时，由于 fetch 已 abort，远程请求不可能后续完成并播放

**How Much**
- 代码改动：`remote-tts-provider.ts` 约 10-15 行
- 超时阈值：默认 8000ms（低于服务端 30s）[推演]
- 质量标准：任意场景下两个语音不得同时播放（成功率 100%）

---

## 五、用户角色 & 使用场景

**主要用户**：语音助手使用者
**次要用户**：平台配置管理员

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 场景1：超时触发 fallback | 助手回复完成，远程接口响应 > 8s | 听到助手回复被朗读 | 等待期间用户无操作 |
| 场景2：远程 TTS 正常响应 | 助手回复完成，远程接口在 8s 内响应 | 听到高质量远程语音 | 无 |
| 场景3：无 fallback 时远程超时 | 同上，fallbackProvider=null | 收到明确失败提示 | 需要 UI 层处理错误 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 场景1 | fetch 无超时无 abort，加入超时 fallback 后必然竞态，两个声音同时播 ⚠️[推演] | fallback 触发后远程请求立即 abort，物理上不可能再完成并播放，单声道有结构性保证 | 一旦加超时逻辑，双声道 bug 必然出现，难以复现，严重损害产品信任度 ⚠️[推演] |
| 场景2 | 远程接口慢时（3-10s）用户等待上限是 30s，无感知 ⚠️[推演] | 最长等待降至 8s（超时后 fallback），用户等待上限可预期 | 继续等待最长 30s，体验差 |

---

## 七、标准用户故事 & 验收标准

### Story 1：超时触发 fallback，无竞态

**User Story**: 作为语音助手使用者，我想要远程 TTS 超时后自动切换到浏览器语音且不重叠，以便始终只听到一个清晰的声音。

**Acceptance Criteria**:
- [ ] AC1: When remote TTS fetch exceeds the timeout threshold, the system shall abort the fetch request via AbortController before initiating fallback synthesis
- [ ] AC2: When fallback synthesis is playing, the system shall not start any additional audio playback for the same TTS request, even if the aborted remote request somehow resolves
- [ ] AC3: When fallback completes successfully, the system shall resolve the `speakText()` promise normally without error
- [ ] AC4: When timeout is 8000ms and remote returns at 8001ms, the system shall have already aborted the request and started fallback within 100ms of the timeout firing

**Out of scope**: 多级 fallback 链，UI 显示"正在切换引擎"提示

---

### Story 2：正常远程 TTS 播放

**User Story**: 作为语音助手使用者，我想要远程 TTS 在超时阈值内正常响应时播放远程音频，以便享受高质量语音。

**Acceptance Criteria**:
- [ ] AC5: When remote TTS responds within the timeout threshold, the system shall play the remote audio and not trigger fallback
- [ ] AC6: When remote audio starts playing, the system shall not have initiated browser synthesis for the same request

**Out of scope**: 音质优化，模型切换

---

### Story 3：无 fallback 配置时超时报错

**User Story**: 作为语音助手使用者，我想要无 fallback 配置时远程 TTS 超时后收到明确错误，以便 UI 层可以展示重试提示。

**Acceptance Criteria**:
- [ ] AC7: When remote TTS exceeds timeout and no fallback provider is configured, the system shall throw an error with message containing "超时"
- [ ] AC8: When the timeout error is thrown, the system shall have no audio playing and no pending playback handles

---

### 决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 在客户端 fetch 加 AbortSignal + setTimeout | 在 SpeechService 层包 Promise.race | 改动最小，abort 与 fetch 绑定最紧，无法出现 abort 后 fetch 仍飞行的漏洞 | 2026-05-18 |
| 超时默认 8000ms | 3000ms / 5000ms / 15000ms / 30000ms | 3-5s 对高质量模型太激进；15s 用户体验差；8s 是 P99 基准估算 [推演] | 2026-05-18 |
| AbortError → fallback（而不是 error） | 始终报错由 UI 重试 | 有 fallback 时用户不需知道换了引擎，体验更流畅 | 2026-05-18 |
| instructions fallback 的第二次 fetch 复用同一 AbortController | 新建第二个 controller | 超时从第一次 fetch 开始计算，避免 instructions fallback 绕过超时限制 | 2026-05-18 |

---

## 八、5Why 根因挖掘

**表层需求**：远程语音接口慢，导致两个语音同时触发

**Why 1**：为什么两个语音同时触发？
> 因为：远程 fetch 没有 AbortSignal，即使 fallback 已经开始播放，飞行中的 fetch 也可能后续完成并触发第二次 `playAudioUrl()`

**Why 2**：为什么 fetch 没有 AbortSignal？
> 因为：当前 fallback 机制是 try-catch（只在 error 时触发），设计时没有考虑"慢但不报错"的场景，因此没有 abort 的需要

**Why 3**：为什么没有客户端超时？
> 因为：服务端已有 30s `AbortSignal.timeout()`，开发者假设服务端会处理超时，未在客户端独立设置阈值

**Why 4**：为什么服务端超时不够用？
> 因为：服务端超时触发时返回 error response，客户端 catch 后触发 fallback；但需要等满 30s，且若在此之前有外部因素触发 fallback，就出现竞态

**Why 5**：为什么竞态是致命的？
> 因为：语音是串行的人类感知通道，两个声音同时输出是人脑无法解析的信息，不同于 UI 上"加载两个图片"的重叠——它直接破坏通信

**根本洞察**：问题的根因不是"接口太慢"，而是**缺少 abort 机制来保证 fallback 触发时主请求的生命周期终结**。即使接口变快，只要没有 abort，竞态风险永远存在。

**设计含义**：解决方案的核心是 AbortController，而不是换更快的接口。接口速度优化是独立的 Should 级需求。

---

## 九、Kano 需求分类

### Basic（缺少即扣分）
- 任意时刻最多一个语音在播放 — 成熟产品（Web Speech API、ElevenLabs SDK）均保证此约束，用户默认期待

### Performance（做得越好越满意）
- 从触发到出声的延迟越短越好 — 超时阈值越低，fallback 越快，用户满意度越高
- ⚠️ Kano 分类存在分歧（Basic vs Performance）：8s 超时阈值是否足够快属于 Performance，但单声道播放本身是 Basic

### Excitement（超预期）
- UI 显示"正在切换至本地语音…"提示
- ⚠️ Benchmark check：成熟产品（Siri、Google TTS）均静默切换，不提示用户——不实现，保持静默

### Kano-MoSCoW 对齐检查

| Kano 类型 | 期望 MoSCoW | 实际 MoSCoW | 是否对齐 |
|---|---|---|---|
| Basic（单声道保证） | Must | M1/M2 | ✅ |
| Performance（超时可配置） | Should | S1 | ✅ |
| Excitement（UI 提示） | Could/Won't | Won't | ✅ |

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | 需求 | 证据 |
|---|---|---|
| M1 | 客户端 remote TTS fetch 增加 AbortSignal，超时时 abort 请求 | 用户显式表达："两个语音一起触发，那简直是灾难" |
| M2 | abort 后触发 fallback，不允许 abort 的请求后续完成并播放 | 用户显式表达（核心 bug 场景） |
| M3 | 超时阈值必须小于服务端 30s 超时，避免服务端超时先触发 | 行业惯例：客户端应先于服务端感知超时 |

### Should（应该做）

| # | 需求 | 为什么不是 Must |
|---|---|---|
| S1 | 超时阈值可通过 `vendorOptions.timeoutMs` 覆盖 | 默认值能解决绝大多数场景，配置化是优化 |
| S2 | 超时发生时输出可观测日志（host + timeout duration） | 对功能无影响，但利于排查 |

### Could（可做可不做）

| # | 需求 | 延期原因 |
|---|---|---|
| C1 | 服务端流式 TTS（chunked transfer）降低首包延迟 | 改动范围更大，是独立优化方向 |
| C2 | LlmProvider 内存缓存减少 DB 查询 | 收益小（10-40ms），不影响 race condition |

### Won't（本期不做）

| # | 需求 | 原因 |
|---|---|---|
| W1 | 多级 fallback 链（remote A → remote B → browser） | YAGNI：目前只有一个 fallback，无第二使用者 |
| W2 | 超时后自动重试远程 | 用户需求是快速降级，不是等待重试 |
| W3 | UI 显示"正在切换引擎"提示 | 纯假设收益，成熟产品均静默处理（Kano: Excitement→Won't） |
| W4 | 超时时长服务端同步配置 | 当前只需客户端控制，多端共享配置无当前需求 |

---

## 十一、功能详细需求定义

### 功能 1：Remote TTS Fetch 客户端超时控制

**功能描述**
> 在 `remote-tts-provider.ts` 的 `synthesize()` 中，为 fetch 调用绑定 AbortController，设置客户端超时。超时触发时 abort 请求，让上层 SpeechService 触发 fallback。

**输入**

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| task.profile.vendorOptions.timeoutMs | number | 否 | 1000–30000 | 覆盖默认超时；未传则使用 DEFAULT_REMOTE_TTS_TIMEOUT_MS（8000） |
| task.input.text | string | 是 | 1–5000字符 | 待合成文本 |

**处理逻辑**
1. 若 text 为空，立即返回空 artifact，不启动超时（现有行为）
2. 读取 `vendorOptions.timeoutMs`，clamp 到 [1000, 30000]，未传则取 8000
3. 创建 `AbortController`，`setTimeout(controller.abort.bind(controller), timeoutMs)`，记录 timeoutId
4. 调用 `fetch(endpoint, { ..., signal: controller.signal })`（含 instructions fallback 的第二次 fetch 复用同一 controller）
5. fetch 成功返回：`clearTimeout(timeoutId)` → 正常处理音频
6. fetch 被 abort（AbortError）：`clearTimeout(timeoutId)` → rethrow，让 SpeechService catch 并触发 fallback
7. fetch 因其他原因失败：`clearTimeout(timeoutId)` → 按现有逻辑处理

**输出**

| 情况 | 输出 | 格式 |
|---|---|---|
| 成功（超时前返回） | SpeechArtifact（audioBuffer + mimeType） | 同现有 |
| 超时 | throw Error（name='AbortError' 或 message 含"超时"） | Error |
| 其他失败 | throw Error | Error（现有行为） |

**边界情况**

| 场景 | 系统行为 |
|---|---|
| timeoutMs 超出 [1000, 30000] 范围 | 静默 clamp，不报错 |
| fetch 在 abort 后仍尝试返回响应 | signal.aborted 为 true，Promise 已 reject，响应被忽略 |
| instructions fallback 的第二次 fetch | 复用同一 AbortController，超时从第一次 fetch 开始计算 |
| text 为空 | 不发起 fetch，直接返回空 artifact |
| 网络离线 | fetch 立即抛 TypeError，clearTimeout，走现有失败路径 |

**依赖关系**
- 依赖：无新增依赖
- 被依赖：SpeechService.execute() 的 catch 分支（已兼容 AbortError，见功能 2 说明）

---

### 功能 2：SpeechService fallback 路径兼容性验证

**功能描述**
> 验证（并在必要时修复）`SpeechService.execute()` 的 catch 块在接到 AbortError 时能正确走 fallback 分支。

**处理逻辑**
1. 审查 `speech-service.ts:execute()` 的 catch 块
2. 当前实现：catch 到任意 Error，若满足 fallback 条件则走 fallback，否则 rethrow
3. AbortError 是 Error 子类，已被 catch 覆盖，**无需代码改动**
4. 若未来 catch 块收窄为特定 error 类型，需确保 AbortError 不被排除

**输出**

| 情况 | 输出 |
|---|---|
| AbortError + 有 fallback | 执行 fallback，resolve |
| AbortError + 无 fallback | rethrow（message 含"超时"，供 UI 层展示） |

---

## 十二、非功能需求

### Performance（性能）
- 超时触发到 fallback 开始的延迟：≤ 100ms（AbortController 本地操作，无网络）
- 正常路径性能：无变化（abort 未触发时无额外开销）
- 无特殊吞吐量要求

### Security（安全）
- 无新增攻击面；AbortController 是客户端本地操作
- 日志仅输出 host，不暴露完整 URL 或 apiKey（遵循现有 #8 规范）
- 无 PII 变更

### Compatibility（兼容性）
- `AbortController` 支持：Chrome 76+、Firefox 97+、Safari 15.4+，满足项目目标浏览器范围 [推演]
- 无 API 版本兼容性问题（纯客户端内部改动，无外部接口变更）

### Usability（易用性）
- 对用户完全透明；超时和 fallback 均为系统行为，无需用户操作
- 超时报错（无 fallback 时）应有明确文本，例："语音服务响应超时，请重试"

### Maintainability（可维护性）
- 超时阈值以命名常量定义（`DEFAULT_REMOTE_TTS_TIMEOUT_MS = 8000`），不使用魔法数字
- 超时和 abort 逻辑集中在 `remote-tts-provider.ts`，不跨文件散落
- 改动应有对应单测：正常路径、超时路径、无 fallback 路径各一个

### Scalability & Extensibility（可扩展性）
- 超时阈值通过 `vendorOptions.timeoutMs` 可覆盖，无需修改代码
- AbortController 模式可复用于 `remote-stt.provider.ts`（其已有 AbortError 处理，见 line 163）

---

## 十三、架构影响分析

### 受影响模块

| 模块 | 文件路径 | 影响类型 | 风险 |
|---|---|---|---|
| Remote TTS Provider（客户端） | `apps/web/src/speech/providers/remote-tts-provider.ts` | Direct change：synthesize() 加 AbortController + setTimeout | d=1，主改动 |
| SpeechService | `apps/web/src/speech/speech-service.ts` | 验证兼容性，无需改动 | d=2，低风险 |
| browser-speech.ts | `apps/web/src/lib/browser-speech.ts` | 无变更，speakText() 签名不变 | d=3，无影响 |

### 数据模型变更
- 无

### 接口合约变更
- `synthesize()` 内部行为变更（增加超时），返回类型不变，调用方无感知
- `speakText()` 签名不变

### 风险摘要

| 风险 | 等级 | 缓解方式 |
|---|---|---|
| AbortError 被 SpeechService catch 后不走 fallback | Medium | 审查 catch 块确认覆盖 AbortError（当前已覆盖） |
| 超时阈值设置过低导致高质量模型频繁 fallback | Low | 默认 8000ms，可通过 vendorOptions 覆盖 |
| playbackManager 状态残留 | Low | AbortError 在 synthesize 层抛出，不进入 playAudioUrl，playbackManager 无需改动 |
| instructions fallback 绕过超时 | Low | 两次 fetch 复用同一 controller，超时从第一次开始计算 |

**整体架构风险：Low**

---

## 十四、认知复杂度评估

**主流程步骤数（用户视角）**：1-2 步
**决策点数量（用户视角）**：0 个
**复杂度评级**：低负担

超时/abort 逻辑对用户完全透明。基准对比：ElevenLabs/OpenAI 同功能 = 1 步（触发 → 出声）[推演]，与我们的设计持平。

---

## 十五、扩展预留建议

**架构扩展点**：
- `vendorOptions.timeoutMs` 已预留覆盖超时的入口，无需改接口
- AbortController 模式可直接复用于 `remote-stt.provider.ts`（STT 超时场景）

**后续迭代方向**（Won't 列表中的候选）：
- 服务端流式 TTS — 触发条件：用户反馈"等待时间仍然过长"或 P99 > 5s
- LlmProvider 内存缓存 — 触发条件：DB 查询成为可观测的延迟瓶颈
- 多级 fallback 链 — 触发条件：出现第二个备选远程供应商

**配置化建议**：
- `DEFAULT_REMOTE_TTS_TIMEOUT_MS` 以常量定义，将来可提升为环境变量或 LlmProvider 表字段

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 在客户端 fetch 加 AbortSignal + setTimeout | 在 SpeechService 层包 Promise.race | 改动最小，abort 与 fetch 绑定最紧，无法出现 abort 后 fetch 仍飞行的漏洞 | 2026-05-18 |
| 超时默认 8000ms | 3000ms / 5000ms / 15000ms | 3-5s 对高质量模型太激进；15s 用户体验差；8s 是 P99 基准估算 [推演] | 2026-05-18 |
| AbortError → 走 fallback 而不是直接报错 | 始终报错由 UI 重试 | 有 fallback 时用户不需知道换了引擎，体验更流畅 | 2026-05-18 |
| instructions fallback 的第二次 fetch 复用同一 AbortController | 新建第二个 controller | 超时从第一次 fetch 开始计算，避免 instructions fallback 绕过超时限制 | 2026-05-18 |

---

<!-- 新增分析维度在此添加，不改动上方结构 -->
