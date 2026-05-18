# Requirements Document: TTS 预合成缓存（接口延迟根治）

**Generated**: 2026-05-18
**Mode**: iteration
**Depth**: full
**Status**: Draft
**关联 Spec**: [tts-timeout-fallback](../tts-timeout-fallback/requirements.md)（竞态修复，独立实施，建议优先合并）

---

## 一、原始需求

> 接口慢的问题必须处理啊，是否可以考虑提前缓存

---

## 二、竞品基准研究

### 竞品参考

| 产品/框架 | 解决方式 | 可提取的模式 |
|---|---|---|
| Pipecat（2025） | 以 `hash(prompt+voice+params)` 为 key 缓存 audio blob；常用语句命中率 70%+ | 对话消息需按完整参数 hash，非仅 text |
| Amazon Polly Bidirectional | LLM 流式 token 逐字发给 TTS，音频在 LLM 未完成时已开始流出 | 流式预合成，适合 auto_final_only 优化 |
| ElevenLabs SDK | HTTP streaming：完整文本发给 TTS 服务端，音频边合成边流回，首包 < 200ms | 流式传输，与预合成缓存互补 |

### 用户心智模型
用户期待点击"朗读"后立即出声，如同点击本地媒体文件播放，而非"发起一个网络请求"。

### 行业惯例
1. **对话消息缓存的 key 必须包含完整的 voice config**（provider、model、voice、speed、format），避免不同配置互相污染
2. **预热失败必须静默**——预热是性能优化，不能成为播放失败的原因

### 已知反模式
- **跨会话缓存对话消息**：对话内容几乎不重复，命中率 < 5%，引入持久化复杂度不值当
- **预热时不去重 inflight 请求**：多次快速触发同文本预热会导致重复 API 调用
- **预热无上限**：大量消息涌入时不加约束会造成 API 浪费和内存压力

### 认知复杂度基线
用户主流程：1 步（点击 → 出声），预缓存完全透明，不增加用户操作步骤。

---

## 三、可行性 & 假设清单

### 假设提取

| # | 假设 | 风险等级 | 风险说明 |
|---|---|---|---|
| 1 | 手动播放模式下用户通常在消息出现后 1-5s 内点击播放 | High [推演] | 决定预热窗口是否足够；若用户极快点击则仍 miss |
| 2 | 对话消息平均长度 ≤ 500 字符 | Medium [推演] | 超长消息不预热；若大部分消息超长则预热覆盖率低 |
| 3 | 预热额外 API 调用不造成显著费用压力 | Medium [推演] | 若每条消息都预热，API 调用量约翻倍；须加长度过滤 |
| 4 | 浏览器标签内存足以容纳 20 条音频 Blob | Low | 单条 MP3 约 30-200KB，20 条 ≤ 4MB，安全 [推演] |

### 技术可行性

- **当前栈**：`Blob` API + `URL.createObjectURL` + 内存 Map，原生支持，无新依赖
- **已知阻塞点**：`remote-tts-provider.ts` 的 `synthesize()` 当前将 fetch 与 play 耦合，需在 fetch 完成后允许将 blob 缓存而不立即播放
- **可行性**：✅ 清晰路径，改动集中，新增文件约 60 行，修改文件约 35 行

### 范围边界

**本期做：**
- On-arrive 预合成：消息到达时后台发起合成，缓存音频 Blob
- `speakText()` 命中缓存时跳过远程请求直接播放
- 20 条 LRU 缓存上限，500 字符预热阈值

**明确不做（本期）：**
- Streaming 句级预合成（LLM 流式输出时按句切割并行合成）
- 跨会话 IndexedDB 持久化缓存
- 服务端 Redis/DB 级缓存

**永不做：**
- 允许预热失败阻塞正常播放路径

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | 纯内存缓存，页面刷新即清空 |
| API 合约变更 | Low | `speakText()` 签名不变 |
| 用户行为变更 | Low | 对用户透明 |
| 下游系统影响 | Low | 仅 speech 模块 + 消息列表组件 |

**整体可逆性：Low**

---

## 四、5W2H 全景分析

**What**
在消息到达时即后台触发 TTS 合成，将音频 Blob 缓存在内存 LRU Map 中；`speakText()` 命中缓存则跳过远程请求直接播放，未命中则正常请求。

**Why**
对话消息几乎不重复，传统跨会话缓存命中率极低。有价值的缓存是**当次消息的合成与播放解耦**：利用消息可见到用户点播之间的人类反应时间窗口（1-5s），把远程合成的等待从"用户等待"变为"后台静默预热"。

**Who**
- 主要受益：启用语音且使用手动播放模式的终端用户
- 次要受益：自动播报模式下有多条消息排队的用户（后续消息可在前一条播放时预热）
- 无影响：使用 browser-local 的用户（无需预热）

**When**
- 预热触发：新消息出现在消息列表时（复用现有 messages useEffect）
- 消费：`speakText()` 被调用时（用户点播或自动播报触发）
- 触发条件：provider 为 `openai-compatible-tts` + 消息非空 + 归一化文本 ≤ 500 字符

**Where**
- 预热触发：`apps/web/src/components/chat/chat-messages-list.tsx`
- 缓存实现：新建 `apps/web/src/speech/tts-prefetch-cache.ts`
- 缓存消费：`apps/web/src/speech/providers/remote-tts-provider.ts`

**How**
1. 消息到达 → 若满足预热条件 → 后台调用 `prewarmTts(text, voiceConfig)`
2. `prewarmTts` 生成 cacheKey → 若 key 已在缓存（pending 或 resolved）则跳过
3. 发起 fetch `/speech/tts` → 合成成功 → 存入 `TtsPrefetchCache`（Blob + mimeType）
4. `speakText()` → `synthesize()` → `ttsPrefetchCache.get(key)` → 命中则创建 BlobURL → 播放
5. 未命中则正常 fetch（含 abort 超时机制，见 tts-timeout-fallback spec）
6. 缓存超 20 条时 LRU 淘汰

**How Much**
- 新增代码：`tts-prefetch-cache.ts` ~60 行 + 修改 2 个文件共 ~35 行
- 内存上限：~4MB（20 条 × 200KB 上估）[推演]
- 预期效果：手动播放场景命中率约 80% [推演]（消息显示 > 1s 后用户点播）

---

## 五、用户角色 & 使用场景

**主要用户**：语音助手使用者（手动播放模式）
**次要用户**：语音助手使用者（自动播报模式，多消息排队场景）

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| A：手动播放命中预热缓存 | 用户在消息出现 1-5s 后点击朗读 | 即时出声 | 消息 ≤ 500 字符，provider = remote |
| B：手动播放，预热进行中（miss） | 用户在消息出现 <1s 内点击朗读 | 正常出声（等待预热完成） | 同上 |
| C：自动播报，多消息排队 | 消息 N 播放中，消息 N+1 到达 | N+1 播放时即时出声 | 消息 ≤ 500 字符 |
| D：超长消息，不预热 | 消息文本 > 500 字符 | 正常出声（走原有 fetch 路径） | 无 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| A | 点击播放后等待 2-8s 空白，用户不确定是否点击生效 ⚠️[推演] | 点击后 ≤ 200ms 出声，感知上等同于本地播放 | 继续等待 2-8s，语音功能体验与浏览器本地语音差距明显 |
| C | 自动播报队列中第 2、3 条消息等待时间叠加 ⚠️[推演] | 排队时预热完成，队列消费无额外等待 | 多条消息场景下每条都要等待，自动播报卡顿感明显 |

---

## 七、标准用户故事 & 验收标准

### Story A：手动播放命中缓存

**User Story**: 作为语音助手使用者，我想要点击朗读时立即出声而不等待网络，以便获得流畅的语音体验。

**Acceptance Criteria**:
- [ ] AC1: When user clicks play and cache contains a resolved entry for the matching key, the system shall start audio playback within 200ms of click without issuing a remote fetch
- [ ] AC2: When pre-warm succeeds and user never plays the message, the system shall silently release the cached blob without error when the entry is evicted

---

### Story B：预热进行中时用户触发播放

**User Story**: 作为语音助手使用者，我想要即使预热未完成也能正常播放，以便不因缓存状态影响功能。

**Acceptance Criteria**:
- [ ] AC3: When pre-warm is in-progress (Promise pending) and speakText() is called for the same cache key, the system shall await the existing Promise instead of issuing a duplicate fetch request
- [ ] AC4: When pre-warm fails silently, the system shall fall through to the normal fetch path without exposing the pre-warm error to the caller

---

### Story C：超长文本不预热

**User Story**: 作为平台管理员，我想要超长消息不触发预热，以便避免 API 浪费。

**Acceptance Criteria**:
- [ ] AC5: When message text after normalization exceeds 500 characters, the system shall not initiate pre-warm for that message
- [ ] AC6: When speakText() is called for a text that was not pre-warmed due to length limit, the system shall use the normal remote fetch path

---

### Story D：缓存容量控制

**Acceptance Criteria**:
- [ ] AC7: When the cache contains 20 entries and a new entry is added, the system shall evict the least recently used entry before adding the new one
- [ ] AC8: When a cached blob is evicted, the system shall not revoke its ObjectURL if it is currently playing (eviction affects cache index only, not active playback)

---

### 决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 缓存在客户端内存（Map） | IndexedDB / localStorage / 服务端 Redis | 对话消息不重复，跨会话复用价值低；内存操作最快，实现最简 | 2026-05-18 |
| 以完整 voice config 参数为 key | 仅 text 为 key | 不同 voice/speed 配置合成结果不同，key 必须包含所有影响合成的参数 | 2026-05-18 |
| 预热阈值 500 字符 | 无上限 / 200 字符 / 1000 字符 | 500 字符约 1-2 段话，覆盖大多数对话消息；防止长文章触发高成本合成 [推演] | 2026-05-18 |
| 20 条 LRU 上限 | 10 条 / 50 条 | 一次对话会话通常 10-30 条消息；20 条覆盖近期消息同时控制内存 [推演] | 2026-05-18 |
| 预热 fetch 不加 AbortSignal 超时 | 加 AbortSignal | 预热失败静默即可，无需超时；AbortSignal 用于 speakText() 正常路径（见 tts-timeout-fallback spec）| 2026-05-18 |

---

## 八、5Why 根因挖掘

**表层需求**：远程 TTS 接口慢，用提前缓存解决

**Why 1**：用户为什么感知到慢？
> 因为：从点击"朗读"到首声出现，中间有 2-8s 空白等待

**Why 2**：为什么有这段空白？
> 因为：合成请求在用户触发时才发出，需等待完整 HTTP 往返 + GPU 推理

**Why 3**：为什么不能提前发出请求？
> 因为：当前架构中合成请求与播放意图绑定在同一调用栈，没有"提前准备"机制

**Why 4**：为什么合成需要等播放意图？
> 因为：设计时没有区分"消息可能被播放"（消息显示时）和"消息正在被播放"（点击朗读时）

**Why 5**：分离这两个状态的业务价值是什么？
> 因为：消息出现到用户点播之间存在人类反应时间窗口（1-5s），这段时间可以用来预热合成，把等待转移到用户感知不到的后台

**根本洞察**：缓存的价值不在于对话消息的跨会话复用（命中率极低），而在于**当次消息的合成与播放解耦**，利用人类反应时间窗口消化延迟。

**设计含义**：on-arrive 预合成是正确方向；服务端缓存和 IndexedDB 对本场景无显著价值。

---

## 九、Kano 需求分类

### Basic
- 预热失败不影响正常播放 — 降级保障，用户默认期待功能始终可用

### Performance（做得越好越满意）
- 预热覆盖率（多少消息在用户点播前完成预热）
- 缓存命中时的播放启动延迟（越低越好）

### Excitement（超预期）
- 流式句级预合成（LLM 流式输出时同步预合成）— 用户不知道有这个能力，做到了会惊喜
- ⚠️ Benchmark check：Amazon Polly 已支持此模式，但实现复杂度高，当前 Deferred

### Kano-MoSCoW 对齐

| Kano 类型 | 期望 MoSCoW | 实际 | 对齐 |
|---|---|---|---|
| Basic（降级保障） | Must | M3（预热失败静默回退） | ✅ |
| Performance（覆盖率/延迟） | Should/Must | M1/M2 | ✅ |
| Excitement（流式预合成） | Could | C1 | ✅ |

---

## 十、MoSCoW 优先级

### Must

| # | 需求 | 证据 |
|---|---|---|
| M1 | 消息到达时后台预合成，结果缓存至内存 | 用户显式要求"提前缓存"解决接口慢问题 |
| M2 | speakText() 命中缓存时跳过远程 fetch，直接播放 | M1 的前提，否则缓存无意义 |
| M3 | 预热进行中时 speakText() 复用同一 Promise，不重复请求 | 行业惯例：重复 inflight 请求是反模式 |

### Should

| # | 需求 | 原因 |
|---|---|---|
| S1 | 超过 500 字符不预热（阈值可配） | 防 API 浪费；默认值覆盖大多数对话消息 |
| S2 | 缓存最多 20 条，LRU 淘汰 | 控制内存；20 条足够一次会话 |
| S3 | 预热失败静默处理，fallthrough 到正常 fetch | 降级设计，保障功能可用性 |

### Could

| # | 需求 | 延期原因 |
|---|---|---|
| C1 | Streaming 句级预合成 | 改动范围大（socket-store + 消息流），独立迭代 |
| C2 | 服务端 TTS 流式传输（chunked transfer） | 独立方向，见 tts-timeout-fallback spec C1 |

### Won't

| # | 需求 | 原因 |
|---|---|---|
| W1 | 跨会话 IndexedDB 持久化缓存 | 对话消息重复率 < 5%，引入复杂度不值当 [推演] |
| W2 | 服务端 Redis/DB 级缓存 | 同 W1，且引入基础设施依赖 |
| W3 | 预热进度 UI 展示 | 透明处理，展示反而增加认知负担 |

---

## 十一、功能详细需求定义

### 功能 1：TtsPrefetchCache（内存 LRU 缓存模块）

**功能描述**
> 内存 Map 实现的 LRU 缓存，存储预合成的 TTS 音频 Blob。Key = 完整 voice config 参数 + 文本的字符串拼接，Value = `Promise<{blob: Blob, mimeType: string}>` 或已 resolved 的结果。

**数据结构**

| 字段 | 类型 | 说明 |
|---|---|---|
| key | string | `${provider}\|${model}\|${voice}\|${speed}\|${format}\|${normalizedText}` |
| value | Promise<CachedAudio> | inflight 或已 resolved；resolved 后含 blob + mimeType |
| capacity | number | 最大条目数，默认 20 |

**处理逻辑**
1. `get(key)`: 返回 cache entry 的 Promise，不存在则返回 null
2. `set(key, promise)`: 写入缓存；若超出 capacity，淘汰最久未访问的 key
3. `has(key)`: 是否已有 entry（pending 或 resolved）
4. `clear()`: 清空全部缓存（页面卸载时调用）

**边界情况**

| 场景 | 系统行为 |
|---|---|
| Promise rejected（合成失败） | 从缓存中删除该 key，不持有 rejected promise |
| capacity = 0 | 不缓存任何条目（允许禁用缓存） |
| 同一 key 并发 set | 第二次 set 会覆盖，保留最新 promise |

---

### 功能 2：prewarmTts() — 后台预合成触发

**功能描述**
> 在消息到达时调用，后台发起 TTS 合成请求，将结果存入 TtsPrefetchCache。失败时静默处理。

**输入**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| text | string | 是 | 已归一化的消息文本（同 speakText 使用的 normalizeSpeechText 输出） |
| voiceConfig | 部分 SpeakTextOptions | 是 | provider, model, voiceId, rate, format 等合成参数 |

**处理逻辑**
1. 若 text 为空或长度 > 500 字符 → 直接返回，不预热
2. provider 不是 `openai-compatible-tts` → 直接返回，不预热（browser-local 无需预热）
3. 生成 cacheKey
4. 若 `cache.has(cacheKey)` → 直接返回（去重）
5. 构造 fetch promise（同 synthesize 的 fetch 路径，但不调用 playAudioUrl）
6. `cache.set(cacheKey, fetchPromise)`
7. fetchPromise resolve → 缓存 blob + mimeType
8. fetchPromise reject → `cache.delete(cacheKey)`（静默失败）

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 同文本快速多次调用 | 第一次写入缓存后，后续调用在步骤 4 被跳过 |
| fetch 超时 | 无 AbortSignal，等待完成或网络错误；失败时静默删除 key |
| 消息文本 > 500 字符 | 不发起预热，speakText() 走正常 fetch 路径 |

---

### 功能 3：speakText() 缓存命中优化

**功能描述**
> 在 `remote-tts-provider.ts` 的 `synthesize()` 中，发起 fetch 前先查询 TtsPrefetchCache；命中则直接使用缓存 Blob 播放，跳过远程请求。

**处理逻辑**
1. 生成 cacheKey（同 prewarmTts 的 key 生成逻辑）
2. 调用 `cache.get(cacheKey)` → await Promise
3. 若 resolved → 创建 `URL.createObjectURL(blob)` → 调用 `playAudioUrl()` → 返回 artifact
4. 若 cache miss（get 返回 null）或 await 报错 → 走正常 fetch 路径（含 AbortSignal 超时）

**边界情况**

| 场景 | 系统行为 |
|---|---|
| 缓存 Blob 已被 GC（理论上不应发生，Blob 持有引用） | `URL.createObjectURL` 失败 → 降级走正常 fetch |
| 缓存 entry pending（预热进行中） | await Promise，等待完成后播放，不发起新 fetch |
| 缓存 entry rejected（预热已失败） | get 返回 null（失败时已删除 key），走正常 fetch |

---

### 功能 4：消息到达时触发预热

**功能描述**
> 在 `chat-messages-list.tsx` 的消息处理 effect 中，对满足条件的新消息调用 `prewarmTts()`。

**触发条件（全部满足才预热）**
1. 消息为非用户消息（agentId 存在）
2. agent 的 voice config 启用（`voiceConfig.enabled === true`）
3. provider 为 `openai-compatible-tts`（远程）
4. 归一化文本非空且长度 ≤ 500 字符

**处理逻辑**
1. 在现有 `toSpeak` 过滤后，对**所有 voiceConfig.enabled && remote provider 的新消息**（不限于 auto_final_only）调用 `prewarmTts()`
2. 预热为 fire-and-forget（void），不等待结果，不影响消息渲染

---

## 十二、非功能需求

### Performance（性能）
- 缓存命中路径：从 `speakText()` 调用到音频开始播放 ≤ 200ms
- 预热请求：后台 fire-and-forget，不阻塞消息渲染，不阻塞 UI 线程
- 内存上限：20 条 × 最大 200KB = 4MB [推演]，在浏览器标签正常范围内

### Security（安全）
- 预热 fetch 使用与 `speakText()` 相同的 auth token 逻辑，无新增认证逻辑
- Blob 存储在内存，页面关闭后自动释放，无持久化安全风险
- 无 PII 变更

### Compatibility（兼容性）
- `Blob`、`URL.createObjectURL`：全目标浏览器支持
- 无新依赖

### Usability（易用性）
- 对用户完全透明；无新 UI 状态
- 缓存命中/miss 对调用方行为无差异（相同播放结果）

### Maintainability（可维护性）
- 预热阈值（500 字符）和缓存上限（20 条）以命名常量定义
- `TtsPrefetchCache` 集中在单文件，消费方只通过 `prewarmTts()` 和 `synthesize()` 缓存查询接触缓存
- 单测：cache hit、cache miss、cache pending（去重）、容量淘汰 各一个

### Scalability & Extensibility（可扩展性）
- 缓存 key 结构支持未来增加 voice config 字段（字符串拼接，扩展方便）
- 预热触发逻辑独立于缓存实现，可在不改 `TtsPrefetchCache` 的情况下扩展触发点（如流式句级预热）
- `capacity` 和 `maxPreheatLength` 以参数形式注入，便于测试和未来调整

---

## 十三、架构影响分析

### 受影响文件

| 文件 | 变更类型 | 风险 |
|---|---|---|
| `apps/web/src/speech/tts-prefetch-cache.ts`（新建） | 新增：LRU 缓存类 + prewarmTts 函数 | Low |
| `apps/web/src/speech/providers/remote-tts-provider.ts` | 修改：synthesize() 前查询缓存 | Low：命中路径独立，miss 路径行为不变 |
| `apps/web/src/components/chat/chat-messages-list.tsx` | 修改：消息到达 effect 中调用 prewarmTts() | Low：新增调用，不改变现有逻辑 |
| `apps/web/src/lib/browser-speech.ts` | 可选修改：导出 prewarmTts() | Low |

### 数据模型变更
- 无

### 接口合约变更
- `speakText()` 签名不变，调用方无感知
- `synthesize()` 内部行为变更（增加缓存查询），返回类型不变

### 风险摘要

| 风险 | 等级 | 缓解方式 |
|---|---|---|
| 缓存 key 碰撞（不同配置命中相同 key） | Low | key 包含完整 voice config 参数，冲突概率极低 |
| 预热增加 API 调用量（用户从不点播的消息） | Medium | 500 字符阈值 + browser-local 不预热 + 可通过条件扩展控制 |
| 缓存 Blob 内存泄漏 | Low | LRU 淘汰持有引用；页面卸载时调用 cache.clear() |
| 预热请求与正常请求竞争带宽 | Low | HTTP/2 多路复用，影响可忽略 [推演] |

**整体架构风险：Low**

---

## 十四、认知复杂度评估

**用户视角主流程步骤数**：1 步（点击 → 即时出声）
**决策点**：0 个
**复杂度评级**：低负担

预热和缓存逻辑对用户完全透明，不增加任何用户操作步骤。

---

## 十五、扩展预留建议

**架构扩展点**：
- `TtsPrefetchCache` 的 `capacity` 和 `maxPreheatLength` 以构造参数形式注入，便于测试覆盖
- 预热触发逻辑与缓存实现解耦，未来可在不改缓存的情况下加入流式句级预热

**后续迭代方向（Won't / Could 列表中的候选）**：
- **流式句级预合成** — 触发条件：对话消息普遍较长（> 200 字符），或自动播报模式首句延迟仍然明显
- **跨会话重复语句缓存** — 触发条件：用户反馈某类固定回复（如问候语）反复出现且每次等待

**配置化建议**：
- `PREWARM_MAX_TEXT_LENGTH = 500` 以常量定义，可提升为 LlmProvider 表字段或环境变量
- `PREFETCH_CACHE_CAPACITY = 20` 同上

---

## 十六、实施顺序建议

1. **先合并 tts-timeout-fallback spec**（AbortController 竞态修复，约 15 行，零风险）
2. **再实施本 spec**（预合成缓存，约 95 行，低风险）
3. **流式句级预合成**作为独立后续迭代（改动范围大，单独 Sprint）

---

## 十七、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 客户端内存缓存（Map） | IndexedDB / 服务端 Redis | 对话消息不重复，跨会话复用价值低；内存操作最快 | 2026-05-18 |
| 完整 voice config 参数为 key | 仅 text | 不同 voice/speed 合成结果不同，key 必须包含所有参数 | 2026-05-18 |
| 预热阈值 500 字符 | 无上限 / 200 / 1000 | 覆盖大多数对话消息同时防高成本合成 [推演] | 2026-05-18 |
| 20 条 LRU 上限 | 10 / 50 | 一次会话近期消息覆盖 + 内存控制平衡 [推演] | 2026-05-18 |
| 预热 fetch 不加超时 | 加超时 | 预热失败静默即可；超时机制属于正常播放路径（tts-timeout-fallback spec）| 2026-05-18 |

---

<!-- 新增分析维度在此添加，不改动上方结构 -->
