# Requirements Document: streaming-tts-session-control

**Generated**: 2026-05-18
**Mode**: iteration
**Depth**: light
**Status**: Draft

---

## 一、原始需求

> [$deep-spec](/Users/liqing/.claude/skills/deep-spec/SKILL.md) 流式 tts 完整可行方案
>
> 我要给出适合我们的最佳方案

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| ChatGPT Voice | 语音交互和当前会话绑定，结束后 transcript 归档到当前对话 | 单一会话边界、文本与语音同源、显式结束控制 |
| 通用 Streaming Response Pattern | 把流式视为一个状态机，而不是多个隐式副作用 | `streaming / complete / interrupted / failed` 明确状态 |
| Deepgram Streaming TTS 实践 | 强调低延迟和发音稳定性存在权衡，句边界不足时 prosody 变差 | 不要为了“尽早发声”牺牲整体控制和自然度 |

### 用户心智模型
用户默认期望“一条助手回复 = 一条可控制的语音回合”，并且播放、停止、完成都挂在同一条消息上，而不是内部切片各自发声。[推演]

### 行业惯例
- 语音回复必须存在单一控制入口，不能同时存在多个发声 initiator。
- 语音会话的边界必须可感知：开始、播放中、已停止、已完成。
- 若交互主体是聊天消息，语音状态应绑定消息 ID，而不是绑定内部 chunk。
- 当对 stop/interrupt 的稳定性要求高于“首句极低延迟”时，优先选择完整句或完整回复级的播放方案。

### 已知反模式
- 将文本流切片直接映射为音频切片，导致同一条回复出现重音、叠播、停不干净。
- 允许 `chat-message`、`browser-speech`、`remote-tts-provider` 同时对同一回复发起真实播放。
- 把“预热缓存请求”和“真实播放请求”混在同一生命周期里，导致控制面失真。
- 没有统一语音会话 ID，stop 只能停当前 audio element，停不掉后续续播。

### 认知复杂度上限
成熟产品在该场景下的复杂度基线约为：
- 主流程：4 步
- 决策点：2 个

我们的设计不应超过该基线，尤其不能让用户理解“消息、切片、预热、补尾、最终播报”多套概念。

### 基准结论
- ✅ 应与行业惯例对齐：**一条消息只允许一个真实播放会话**。
- ✅ 应保留文本流式展示，但语音层采用**单消息单会话控制**。
- ⚠️ 若要保留未来的“边生成边播”，也只能在统一会话内做“完整句顺播”，不能恢复为切片级独立播放。
- ❌ 风险最高的方向是继续叠加“补尾流式 + 自动整条播报 + 手动播放”三套并行路径。

---

## 三、可行性 & 假设清单

### 假设清单

| # | Assumption | Risk if Wrong | Confidence |
|---|---|---|---|
| 1 | 用户更在意“整条回复可控”而不是“首句尽早发声” | 若错误，方案会牺牲一部分即时感 | High |
| 2 | 现有 `speech/tts/stream` 接口可支撑完整回复级的单次流式播放 | 若错误，需要回退到 `/speech/tts` 整包播放 | High |
| 3 | 当前问题主要来自前端播放控制而不是 TTS 供应商音频质量 | 若错误，改完控制层后仍会有音质或断句问题 | Medium |
| 4 | `message.id` 可以作为最终语音会话的唯一用户可见锚点 | 若错误，暂停/已播状态仍可能错位 | High |
| 5 | 预热请求可以继续存在，但必须永不自动转为真实播放 | 若错误，会再次引入多 initiator 播放 | Medium |

### 技术可行性信号

- **Current stack**: Web 端已有 `chat-messages-list.tsx`、`browser-speech.ts`、`remote-tts-provider.ts`、`streaming-tts.ts` 四层可调整；服务端已有 `/speech/tts` 与 `/speech/tts/stream`。
- **Known blockers**: 当前存在多条播放入口并发、消息 ID 与流式 session 解绑、stop 只停局部不停整体。
- **Third-party dependencies**: OpenAI-compatible TTS / 浏览器音频播放能力。稳定性中高，但低延迟 streaming 的自然度存在先天权衡。
- **Feasibility verdict**: ✅ Clear path

### Dependency Identification

- **Other teams/services**: 后端 speech gateway、前端聊天消息页
- **External stakeholders**: 使用自动语音播报的终端用户
- **Upstream dependencies**: `agent:stream` / `agent:done` socket 事件、`/speech/tts/stream`
- **Downstream dependents**: 消息播放按钮、已播状态、自动播报策略、DevTools 网络观察

### Scope Boundary Declaration

**In scope:**
- 将流式 TTS 收敛为“单消息单真实播放会话”
- 统一自动播报、停止、已播状态的控制源
- 明确预热请求与真实播放请求的职责边界
- 消除重音、叠播、停止失效等核心问题

**Out of scope (this iteration):**
- 真正的音频片段物理拼接成单个文件 — reason: 复杂度高且对当前核心问题帮助有限
- 句级“边生成边播”优化 — reason: 当前优先级低于控制稳定性
- 新增独立语音模式页面 — reason: 本期目标是修复聊天内语音播报体验

**Deliberately excluded:**
- token 级或半句级 TTS 起播 — reason: 明显违背当前产品对自然度和可控性的要求
- 多供应商并行 fallback 播放 — reason: 会放大多 initiator 风险

### Reversibility Score

| Dimension | Score | Reason |
|---|---|---|
| Data migration cost | Low | 不涉及持久化 schema 变更 |
| API contract changes | Low | 可复用现有 `/speech/tts/stream` |
| User-facing behavior change | Medium | 用户会感知到“语音在回复完成后开始播” |
| Downstream system impact | Medium | 影响聊天页自动播报、已播状态、停止逻辑 |

**Overall reversibility**: Medium cost

---

## 四、5W2H 全景分析

**What** — 做什么
> 为聊天消息中的自动语音播报提供一个完整可控的流式 TTS 方案：文本仍可流式显示，但语音只在整条回复完成后以单一会话播放，并与该消息绑定。

**Why** — 为什么做
> 当前实现已出现重音、叠播、切片失控、停止失效等问题，说明“切片即播放单元”不适合 TeamAgentX 当前的聊天产品形态。需要优先恢复一致性、可控性和用户信任。

**Who** — 谁来用
> 主要用户: 在聊天页开启自动语音播报的普通用户  
> 次要用户: 依赖语音快速消费回复的重度用户  
> 受影响方: 前端开发、语音服务维护者、产品团队

**When** — 什么时候用
> 触发时机: 助手完成一条消息回复且该助手启用了自动播报  
> 使用频率: 高频  
> 时间约束: 播放必须晚于 `agent:done`，且停止操作需在用户点击后立即生效

**Where** — 在哪里用
> 使用环境: Web 聊天页 [推演]，后续可映射到桌面端 Web 容器  
> 入口位置: 消息列表自动播报逻辑、消息气泡播放按钮

**How** — 怎么做
> 核心操作路径: 文本流式展示 → `agent:done` 到达 → 读取最终完整文本 → 建立该消息唯一语音会话 → 使用 `/speech/tts/stream` 播放 → 用户可停止/结束 → 标记已播  
> 技术实现方向: 保留流式文本，移除流式阶段真实起播，统一由最终消息驱动单会话播放

**How Much** — 做到什么程度
> 规模/量级: 单房间内可能并发多个助手回复，但任一条消息只能存在一个真实语音会话  
> 质量标准: 不允许出现双重播放、重音叠加、停止后续播、同一消息多 initiator  
> 验收底线: 对任意一条自动播报消息，Network 中最多出现一个真实播放链路，用户点击停止后 300ms 内停止继续出声 [推演]

---

## 五、用户角色 & 使用场景

### 主要用户角色
| 字段 | 内容 |
|---|---|
| 角色名称 | 团队协作用户 |
| 使用频率 | 高频（每天） |
| 技术熟练度 | 普通用户 |
| 核心目标 | 在继续聊天或处理其他事务时，用语音快速消费助手回复 |
| 最大痛点 | 当前语音会重叠、断裂、停不下来，导致不敢再开自动播报 |

### 次要用户角色
| 字段 | 内容 |
|---|---|
| 角色名称 | 产品验收人员 |
| 使用频率 | 中频（每周） |
| 技术熟练度 | 技术专家 |
| 核心目标 | 验证语音播报行为与消息生命周期一致 |
| 最大痛点 | 难以判断当前到底是哪条消息在播、哪个请求是真播放 |

### 受影响方（不直接使用，但受影响）
- 前端开发: 需要维护更清晰的播放状态机
- 后端语音服务维护者: 需要明确 `/speech/tts` 与 `/speech/tts/stream` 的使用边界

### 场景定义
| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 自动播报完整回复 | 助手回复完成且自动播报开启 | 听到一条完整、自然、可停止的语音 | 必须与当前消息一一对应，不得叠播 |
| 中途停止当前播报 | 用户发现内容不再需要或播报过长 | 立即停止当前消息的语音 | 停止后不得被后续 chunk 或补尾逻辑重新拉起 |
| 顺序处理多条新回复 | 多条助手消息连续产生 | 按消息顺序稳定播放，不跳播、不重播 | 同一时间仅一个真实播放会话 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 自动播报完整回复 | 同一条回复可能被多个 initiator 重复播放，形成多层重音。⚠️ 基于当前代码与用户反馈推断 [推演] | 用户重新获得“一条消息一条语音”的稳定预期 | 自动播报功能持续失去可信度，用户倾向关闭 |
| 中途停止当前播报 | 点击停止后，后续补尾或新切片仍可能续播。⚠️ 基于当前代码与用户反馈推断 [推演] | 停止语义清晰，可立即恢复安静环境 | 用户对控制失去信任，认为功能“不可控” |
| 顺序处理多条新回复 | 流式逻辑和最终消息逻辑并存，容易造成顺序错乱或重复播放。⚠️ 基于当前代码与用户反馈推断 [推演] | 自动播报链路更简单，便于后续调试和监控 | 继续迭代会放大技术债，后续每次修补都更危险 |

---

## 七、标准用户故事 & 验收标准

### Story 1
**User Story**: 作为团队协作用户，我想要在助手回复完成后听到一条完整语音，以便不用盯着屏幕也能消费回复内容。

**Acceptance Criteria**:
- [ ] AC1: When an assistant message reaches `agent:done` and auto-play is enabled, the system shall start at most one real TTS playback session for that message.
- [ ] AC2: When the system starts auto-play for a message, the playback state shall bind to that message ID until playback finishes, fails, or is stopped.
- [ ] AC3: When the message has already been played successfully, the system shall not auto-play the same message again after room rerender, visibility change, or store refresh.

**Out of scope for this story**: 在回复尚未完成时提前起播

### Story 2
**User Story**: 作为团队协作用户，我想要在语音播放中点击停止后立刻安静下来，以便重新掌控当前会话节奏。

**Acceptance Criteria**:
- [ ] AC1: When the user clicks stop on the currently playing message, the system shall stop audible playback within 300ms. [推演]
- [ ] AC2: After the user stops a message playback, the system shall suppress any remaining auto-play continuation for the same message response.
- [ ] AC3: While a message is in stopped state, the system shall not restart playback for that message unless the user explicitly triggers manual play.

**Out of scope for this story**: 停止后从断点继续播放

### Story 3
**User Story**: 作为产品验收人员，我想要明确区分预热请求和真实播放请求，以便快速判断自动播报链路是否正确。

**Acceptance Criteria**:
- [ ] AC1: When the system issues a prewarm request, that request shall not create audible playback by itself.
- [ ] AC2: When the system issues a real playback request, the request initiator and playback state shall map to one message session.
- [ ] AC3: When debug logs are enabled, the system shall emit session start, stop, finish, and suppress events with message ID and agent ID.

**Out of scope for this story**: 新增完整的可视化调试面板

### Decision Log

| Decision | Alternatives Considered | Why This Choice |
|---|---|---|
| 采用“完成后整条播放”的单消息单会话方案 | token 级切片播放、句级边播边合并、物理音频拼接 | 与当前聊天产品心智最一致，控制面最稳定，改动面最小 |
| 保留 `/speech/tts/stream` 作为最终整条播放接口 | 改为 `/speech/tts` 整包播放 | 仍可边下载边播放完整回复，保留一定响应性 |
| 预热请求保留但永不触发真实播放 | 彻底移除预热 | 可保留后续优化空间，同时把职责边界明确化 |

---

## 八、5Why 根因挖掘

本次为 `light` 模式，未展开完整 5Why。

结论摘要：
- 表面问题是“多层重音、停不掉”
- 更深层问题是“把文本流粒度误当作语音控制粒度”
- 真正需要修复的是**会话边界和控制所有权**，而不是继续优化切片算法

---

## 九、Kano 需求分类

本次为 `light` 模式，未展开完整 Kano 分类。

结论摘要：
- “一条消息只播一次”属于 Basic
- “点击停止后不再续播”属于 Basic
- “更早开始播报”属于 Performance，但优先级低于 Basic 稳定性

---

## 十、MoSCoW 优先级

### Must (必须做)
| # | Requirement | Evidence (benchmark/pain point) |
|---|---|---|
| M1 | 每条助手消息只允许一个真实语音播放会话 | 用户心智与竞品惯例：一条回复应对应一个语音回合 |
| M2 | 自动播报只能在回复完成后启动，禁止流式阶段真实起播 | 当前已出现重音、叠播、会话失控 |
| M3 | 用户点击停止后，必须抑制同一回复的后续自动续播 | 当前痛点：停止失效 |
| M4 | 预热请求与真实播放请求必须职责分离 | 当前网络链路可观察性差，容易再次回归到双播放 |

### Should (应该做)
| # | Requirement | Why Not Must |
|---|---|---|
| S1 | 为真实播放请求附带可调试的会话标识 | 对验收和排障很有价值，但非核心用户功能 |
| S2 | 在开发日志中输出 session lifecycle 事件 | 有助于稳定迭代，但用户不可见 |

### Could (可做可不做)
| # | Requirement | Deferral Reason |
|---|---|---|
| C1 | 在未来支持“完整句顺播”模式 | 需要更复杂的句边界与 stop 语义设计 |
| C2 | 提供“停止后从断点继续” | 不是当前主要痛点 |

### Won't (本期不做)
| # | Requirement | Decision Reason |
|---|---|---|
| W1 | 物理拼接多个音频片段为一个文件 | 成本高，不能解决当前最核心的控制问题 |
| W2 | token 级边生成边播 | 明显不适合当前产品 |
| W3 | 多供应商并行 fallback 播放 | 会进一步复杂化会话控制 |

### YAGNI Flags

Items detected as speculative / future-proofing (not required now):
- 断点续播 → Moved to Won't. Reason: no current requirement justifies this.
- 物理音频拼接 → Moved to Won't. Reason: no current requirement justifies this.

---

## 十一、功能详细需求定义

### 功能 1: 单消息单语音会话调度

**功能描述**
> 系统为每条满足自动播报条件的助手消息建立唯一语音会话，并只允许这一条会话发声。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| messageId | string | 是 | 非空 UUID/字符串 | 当前助手消息 ID |
| agentId | string | 是 | 非空字符串 | 当前助手 ID |
| content | string | 是 | 非空文本 | 最终完整回复文本 |
| autoPlayEnabled | boolean | 是 | true/false | 是否启用自动播报 |
| outputMode | string | 是 | `auto_final_only` | 当前方案仅支持完成后整条播报 |

**处理逻辑**
1. 系统监听消息完成事件。
2. 当消息满足自动播报条件时，系统检查该消息是否已有真实播放会话。
3. 若无会话，系统以该消息为唯一锚点启动一次 `/speech/tts/stream` 播放。
4. 播放开始后，系统将“当前播放中”状态绑定到该消息 ID。
5. 播放完成、失败或停止后，系统释放该会话。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 启动唯一语音会话并更新播放状态 | session state update |
| 失败 | 记录错误并不重复发起第二条真实播放 | error event |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 不启动自动播报 |
| 超出取值范围 | 非 `auto_final_only` 时不走该功能 |
| 并发请求 | 同一 `messageId` 下最多保留一个真实播放会话 |
| 网络超时 | 结束当前会话并记录失败，不自动复制第二次真实播放 |
| 权限不足 | 不发起请求并记录失败 |

**与其他功能的依赖关系**
- 依赖: 助手消息完成事件、TTS 接口
- 被依赖: 已播状态、停止控制、手动重播

### 功能 2: 停止后续播抑制

**功能描述**
> 当用户停止当前消息的自动播报后，系统应把该响应剩余部分标记为已抑制，除非用户显式手动重播。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| messageId | string | 是 | 非空字符串 | 当前播放中的消息 ID |
| sessionKey | string | 是 | 非空字符串 | 当前语音会话标识 |
| stopSource | string | 是 | `user-click` | 停止来源 |

**处理逻辑**
1. 用户点击当前播放中的消息停止按钮。
2. 系统立即终止当前 audio playback。
3. 系统将该 `messageId/sessionKey` 标记为 suppressed。
4. 在该回复生命周期内，系统拒绝任何自动续播请求。
5. 若用户手动点击播放，则创建新的人工播放会话。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 当前播放停止，后续自动续播被禁止 | session stop result |
| 失败 | 返回停止失败事件并记录日志 | error event |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 忽略停止请求 |
| 超出取值范围 | 无效 sessionKey 时不报错重播 |
| 并发请求 | 多次 stop 视为幂等 |
| 网络超时 | 本地必须先停声，再处理远端清理 |
| 权限不足 | 无特殊权限要求，遵循当前页面能力 |

**与其他功能的依赖关系**
- 依赖: 当前播放状态
- 被依赖: 自动播报恢复逻辑、手动播放逻辑

### 功能 3: 预热与真实播放职责分离

**功能描述**
> 系统允许保留预热请求以优化未来体验，但预热请求不得触发任何可听见的播放。

**输入**
| 字段 | 类型 | 必填 | 取值范围/格式 | 说明 |
|---|---|---|---|---|
| requestType | string | 是 | `prewarm` / `playback` | 请求类型 |
| messageId | string | 否 | 非空字符串 | playback 时必须有 |
| text | string | 是 | 非空文本 | 待合成文本 |

**处理逻辑**
1. 系统区分预热请求与真实播放请求。
2. `prewarm` 只允许写入缓存或准备资源。
3. `playback` 才允许创建 audio element 或 MediaSource 播放。
4. 日志与调试信息应能区分两者。

**输出**
| 情况 | 输出内容 | 格式 |
|---|---|---|
| 成功 | 请求被正确归类并按职责执行 | request result |
| 失败 | 返回分类或执行错误 | error event |

**边界情况**
| 场景 | 系统行为 |
|---|---|
| 输入为空 | 拒绝发起请求 |
| 超出取值范围 | 未知 requestType 直接失败 |
| 并发请求 | 预热不应抢占真实播放控制权 |
| 网络超时 | 预热超时不影响当前真实播放 |
| 权限不足 | 拒绝请求并记录日志 |

**与其他功能的依赖关系**
- 依赖: 缓存层、TTS 接口
- 被依赖: 调试可观测性、后续性能优化

---

## 十二、非功能需求

### Performance (性能)
- Response time: `agent:done` 到真实播放启动的前端调度延迟应控制在 300ms 内；实际出声时间取决于 TTS 返回首包时间。[推演]
- Throughput: 单房间可连续处理多条消息，但同一时刻仅允许一条真实自动播放会话。
- Data volume: 单条回复默认按现有消息长度上限处理，无需引入新分页机制。
- Degradation behavior: 当 `/speech/tts/stream` 不可用时，系统可回退为不自动播报，但不得触发重复播放。

### Security (安全)
- Authentication: 继续沿用现有 `auth_token`。
- Authorization: 仅当前已加入房间且有消息访问权的用户可发起对应 TTS 请求。
- Data sensitivity: 回复内容可能包含业务敏感信息，应按现有消息权限控制处理。
- Attack surface: 需避免通过重复请求放大 XSS/注入面；文本仍走现有消息清洗与 TTS 输入路径。
- Audit trail: 需记录播放开始、停止、失败、抑制等关键事件，至少包含 messageId 与 agentId。

### Compatibility (兼容性)
- Browser/platform targets: 现有 Web 支持范围内的现代浏览器；桌面端 Electron WebView 继承该能力。
- API versioning: 不要求新增接口版本，优先复用现有 `/speech/tts/stream`。
- Data format compatibility: 不新增新的音频持久化格式要求。
- Third-party integration constraints: 兼容当前 openai-compatible TTS provider。

### Usability (易用性)
- Learnability: 新用户应无需训练即可理解“一条消息一个播放按钮，一次只播一条”。
- Error recovery: 播放失败后，用户仍可手动再次触发播放。
- Accessibility: 无特殊要求，遵循系统默认标准。
- Mobile/responsive: 无特殊要求，遵循系统默认标准。

### Maintainability (可维护性)
- Code coverage expectation: 语音会话调度与停止抑制至少应有单元测试覆盖关键分支。
- Documentation requirements: 需在聊天语音逻辑处保留简短注释，解释“为何完成后整条播放”。
- Observability: 应提供 initiator 区分、session lifecycle 日志。
- Deployment: 无需停机发布；出现回归时可快速回退到“关闭自动播报”策略。

### Scalability & Extensibility (可扩展性)
- Growth assumptions: 未来 6-12 个月可能重新尝试句级顺播，但不应改变“单消息单会话”主原则。[推演]
- Extension points: 可在统一 session controller 之上增加 `final-only` / `sentence-streaming` 模式枚举。
- Configuration vs code: 输出模式可配置；会话控制原则应写死，不建议由配置绕过。
- Multi-tenancy: 无特殊要求，遵循系统默认标准。

---

## 十三、架构影响分析 [Iteration Mode]

本次为 `light` 模式，未展开完整架构影响章节。

基于代码扫描的最小结论：
- 主要影响前端聊天消息列表与语音 provider 路由层
- 风险等级：LOW
- 关键收敛点：
  - [apps/web/src/components/chat/chat-messages-list.tsx](/Users/liqing/qing/code/team/teamagentx/apps/web/src/components/chat/chat-messages-list.tsx)
  - [apps/web/src/lib/browser-speech.ts](/Users/liqing/qing/code/team/teamagentx/apps/web/src/lib/browser-speech.ts)
  - [apps/web/src/speech/providers/remote-tts-provider.ts](/Users/liqing/qing/code/team/teamagentx/apps/web/src/speech/providers/remote-tts-provider.ts)

---

## 十四、认知复杂度评估

**主流程步骤数**: 4 步  
**决策点数量**: 2 个  
**复杂度评级**: Low  
**基准对比**: 主流产品同功能约为 4 步

简化原则：
- 用户只需要理解“消息完成后会自动播”“点停就停”
- 开发只需要理解“预热不是播放”“一条消息只有一个会话”

---

## 十五、扩展预留建议

**架构扩展点**:
- 在统一 session controller 之上预留 `outputMode` 枚举，以支持未来的 `sentence-streaming`
- 为真实播放请求附加显式 `sessionId/requestKind`

**后续迭代方向** (Won't 列表中的候选):
- 完整句顺播 — 触发条件: 当前 final-only 稳定运行且用户明确要求更早出声
- 停止后断点续播 — 触发条件: 有明确用户场景证明需要

**配置化建议**:
- 自动播报开关、输出模式、语速可配置
- “单消息单真实播放会话”不建议配置化

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 自动播报改为完成后整条播放 | 切片级流式播报、句级顺播、物理音频拼接 | 最符合当前产品心智，最能消除重音/叠播/停不掉 | 2026-05-18 |
| 保留 `/speech/tts/stream` 作为最终整条播放接口 | 使用 `/speech/tts` 整包返回后再播 | 仍可边下边播完整回复，复用现有接口 | 2026-05-18 |
| 预热与真实播放必须职责分离 | 保留当前混合模式 | 便于调试、降低重复播放风险 | 2026-05-18 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
