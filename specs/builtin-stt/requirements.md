# Requirements Document: 内置 STT 语音输入

**Generated**: 2026-05-17
**Mode**: iteration
**Depth**: full
**Status**: Draft

---

## 一、原始需求

> "现在的语音输入受限制，只有国外才能正常使用"
> "感觉这个功能还挺是实用的，而且以后不可能是用户自己去配，输入还是需要内置一下的"
>
> 上下文：当前浏览器 SpeechRecognition 依赖 Google 服务，国内不可用。
> 用户确认方向：服务端 faster-whisper 作为内置 STT provider，和 edge-tts 对齐成一套本地二进制能力。

---

## 二、竞品基准研究

### 竞品参考

| 产品 | 解决方式 | 可提取的模式 |
|---|---|---|
| 微信 | 长按录音，松开转写，结果填入输入框 | Push-to-talk，结束即转写 |
| faster-whisper（自托管） | OpenAI 兼容 `/audio/transcriptions`，CPU/GPU 均支持 | 与现有 TTS 接口模式对称 |
| Notion | 无内置 STT，依赖系统级输入法或第三方扩展 | 反例：不应依赖外部服务 |

### 用户心智模型

用户已被微信/钉钉教育：点击（或长按）麦克风按钮，说话，松开（或再次点击），文字出现。不需要任何配置，不需要理解"provider"概念。

### 行业惯例

1. Push-to-talk 是语音输入的主流交互模式（点击开始 + 点击结束，或长按）
2. 转写结果填入光标位置，不替换已有内容
3. 录音结束后一次性转写（一期），实时流式是二期能力
4. 内置 STT 不应要求用户配置 API Key

### 已知反模式

- 依赖浏览器 `SpeechRecognition`（国内 Chrome 底层走 Google 服务，不可用）
- 要求用户自行注册第三方 STT 服务
- 静默失败（录音后无任何反馈）
- 实时流式转写作为一期方案（复杂度过高，性价比低）

### 认知复杂度上限

主流产品（微信、钉钉）同功能：3 步（点击 → 说话 → 点击），0 配置。我们的设计不应超过此基线。

### 基准结论

- ✅ 与微信/钉钉点击式交互对齐
- ✅ 与现有 edge-tts 本地二进制模式对齐，降低新增技术栈成本
- ⚠️ 偏离点：录音后需等待 3-8s 转写（非实时），需在 UI 上明确表达"转写中"状态，管理用户预期

---

## 三、可行性 & 假设清单

### 隐性假设

| # | 假设 | 风险（若假设错误） | 置信度 |
|---|---|---|---|
| 1 | 服务端可以安装 Python 包（faster-whisper） | 无法安装则整个方案不可用 | Medium |
| 2 | 服务端 CPU 性能足够，single transcribe ≤ 8s | 低配机器 large 模型可能超 10s | Medium |
| 3 | 用户接受"录完等待 3-8s"的交互模式 | 若期望实时转写，体验落差大 | High |
| 4 | 录音格式（webm/mp4）faster-whisper 可处理（需 ffmpeg） | 格式不支持则需额外转码层 | Medium |
| 5 | 模型文件首次下载国内服务器可完成（~600MB） | 国内下载慢，需预置或镜像配置 | Low |
| 6 | 前端 `MediaRecorder` API 在目标浏览器可用 | 极老版本不支持；主流浏览器均已支持 | High |

### 技术可行性

- **当前栈**：Fastify 5 + TypeScript，服务端已有 edge-tts（Python 二进制进程调用）模式，路径完全对齐
- **已知阻塞点**：前端目前无 MediaRecorder → 上传 → 转写的完整链路，需新建
- **第三方依赖**：`faster-whisper`（Python，LGPL-2.1）、`ffmpeg`（可选，格式转换）
- **可行性**：✅ 清晰路径

### 依赖方

- **上游**：服务器环境（Python、faster-whisper、ffmpeg 安装）
- **下游**：前端 `chat-input-area.tsx` 输入框、语音模块 provider 注册

### 范围边界

**In scope：**
- 服务端 faster-whisper STT provider（`transcribe` 方法）
- `POST /speech/stt` HTTP 接口（接收音频，返回文本）
- 前端 MediaRecorder 录音 → 上传 → 填入输入框完整链路
- 转写失败明确提示 + 按钮状态恢复
- faster-whisper 未安装时返回 503 + 错误码 `STT_UNAVAILABLE`

**Out of scope（本期）：**
- 实时流式转写（WebSocket）— 复杂度高
- 移动端（Flutter）语音输入 — 另立需求
- 多语言切换 UI — 默认中文
- 转写置信度显示 — 二期

**Deliberately excluded：**
- 继续依赖浏览器 `SpeechRecognition` — 国内不可用，废弃
- 用户自配远程 Whisper API Key — 违背内置原则

### 可逆性评分

| 维度 | 评分 | 原因 |
|---|---|---|
| 数据迁移成本 | Low | 无新数据库字段，临时文件用后即删 |
| API 合约变更 | Low | 纯新增接口，不改旧接口 |
| 用户行为变更 | Medium | 前端录音交互需重写 |
| 下游系统影响 | Low | gitnexus 确认语音模块 0 直接上游调用方 |

**整体可逆性：Low cost**

---

## 四、5W2H 全景分析

**What**
在 TeamAgentX 服务端内置 faster-whisper STT provider，提供 `POST /speech/stt` 接口；前端录音改为 `MediaRecorder` 采集音频 → 发送到服务端 → 转写文本填入聊天输入框。国内外均可用，无需用户配置。

**Why**
浏览器 `SpeechRecognition` 底层依赖 Google 语音识别服务，中国大陆不可访问，语音输入功能对国内用户完全失效。语音输入是高频基础能力，不应要求用户自行配置第三方 API Key。

**Who**
- 主要用户：群聊成员（在聊天室里通过语音代替打字）
- 次要用户：群主/管理员（关心功能稳定性）
- 受影响方：[推演] 服务端运维者（需安装 faster-whisper 和 ffmpeg）

**When**
- 触发时机：用户在聊天输入框点击麦克风按钮，想用语音代替键盘输入
- 使用频率：[推演] 中高频，每次聊天可能多次使用
- 时间约束：无硬截止，建议与 edge-tts 配套，完成语音能力基础闭环

**Where**
- 使用环境：Web（主）、Electron 桌面版（同 Web）
- 入口位置：`apps/web/src/components/chat/chat-input-area.tsx` 中的麦克风按钮

**How**
1. 用户点击麦克风按钮 → 前端启动 `MediaRecorder` 录音
2. 用户再次点击 / 录音达 60s → 录音结束，生成音频 Blob
3. 前端将 Blob POST 到 `/speech/stt`（multipart/form-data）
4. 服务端 faster-whisper 转写，返回 `{ text: "..." }`
5. 前端将文本填入输入框，用户可编辑后发送

**How Much**
- 转写延迟：单次录音（≤60s）在普通 CPU 上 P90 ≤ 8s（small 模型）[推演]
- 中文识别准确率：≥ 90%（small 模型）[推演]
- 音频大小上限：10MB / 60s
- 并发：[推演] 初期单实例串行，满足小团队

---

## 五、用户角色 & 使用场景

**主要用户**：群聊成员
**次要用户**：群主/管理员（不直接使用，关心稳定性）

### 场景定义

| 场景 | 触发事件 | 用户目标 | 约束条件 |
|---|---|---|---|
| 正常语音输入 | 用户想快速发消息但不想打字 | 说一句话，文字出现在输入框 | 无特殊约束，平静状态 |
| 转写失败恢复 | 网络抖动或服务端忙碌 | 知道出了什么问题，能重试 | 不能卡死，不能刷页面 |
| 服务未就绪降级 | 服务端未安装 faster-whisper | 了解功能不可用原因 | 不报 500，不影响文字输入 |

---

## 六、核心痛点 & 业务价值

| 场景 | 现在的痛点 | 实现后的价值 | 不实现的负面影响 |
|---|---|---|---|
| 正常语音输入 | 国内用户点击麦克风后等待数秒无响应，浏览器 SpeechRecognition 调用 Google 服务超时，只能放弃语音改为打字 ⚠️[推断] | 语音输入恢复正常，说 5-15 字短句比打字节省约 40-60% 时间 ⚠️[推断] | 语音输入功能对国内用户永久失效，等于产品在国内少了一个完整能力 |
| 转写失败恢复 | 失败后麦克风按钮卡住无法点击，只能刷新页面恢复，打断聊天上下文 ⚠️[推断] | 失败 5s 内提示 + 按钮自动恢复，无需刷新即可重试 | 静默失败是最差体验，用户不信任功能，即使上线也不使用 |
| 服务未就绪降级 | 接口返回 500，用户看通用网络错误，不知是永久还是暂时问题 ⚠️[推断] | 明确提示"语音转写暂不可用"，用户不重复尝试 | 部署环境不完整时给用户看 500，影响产品专业感 |

---

## 七、标准用户故事 & 验收标准

### Story 1：正常语音输入

**User Story**: 作为群聊成员，我想点击麦克风按钮录音后文字自动填入输入框，以便在不方便打字时快速发送消息。

**Acceptance Criteria**:
- [ ] AC1: When 用户点击麦克风按钮，the system shall 在 500ms 内显示录音中状态（红色标记/动画）
- [ ] AC2: When 用户再次点击麦克风停止录音，the system shall 在 8s 内将转写文本填入输入框（CPU 环境，音频 ≤ 60s）
- [ ] AC3: When 转写完成，the system shall 将文本追加到输入框已有内容之后，不覆盖用户已输入的文字
- [ ] AC4: When 录音时长超过 60s，the system shall 自动停止录音并开始转写，同时显示提示"录音已达上限"
- [ ] AC5: When 转写文本为空字符串，the system shall 显示提示"未识别到语音内容"，不向输入框填入任何内容

**Out of scope**: 实时字幕显示、自动发送消息

---

### Story 2：转写失败恢复

**User Story**: 作为群聊成员，我想在语音转写失败时得到明确提示并能重试，以便不因为一次失败卡住发消息流程。

**Acceptance Criteria**:
- [ ] AC1: When `/speech/stt` 返回非 200 响应，the system shall 在输入框区域显示错误提示，且提示在 5s 后自动消失
- [ ] AC2: When 转写请求失败，the system shall 将麦克风按钮恢复为可点击状态，不需要刷新页面
- [ ] AC3: When 录音上传超过 15s 无响应，the system shall 中止请求并显示"转写超时，请重试"

**Out of scope**: 自动重试、离线缓存录音

---

### Story 3：服务未就绪降级

**User Story**: 作为群聊成员，我想在语音转写服务不可用时看到明确提示，而不是静默失败。

**Acceptance Criteria**:
- [ ] AC1: When 服务端返回 503 + 错误码 `STT_UNAVAILABLE`，the system shall 显示"语音转写暂不可用"，麦克风按钮置灰
- [ ] AC2: While 语音转写服务不可用，the system shall 不影响文字输入、图片上传等其他输入功能

**Out of scope**: 自动检测服务恢复、重新启用按钮

---

### 决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 录音结束后一次性上传转写 | 实时流式 WebSocket | 一期复杂度低，延迟可接受，与 edge-tts 模式对称 | 2026-05-17 |
| 前端 MediaRecorder 采集 | 继续用浏览器 SpeechRecognition | SpeechRecognition 国内不可用，废弃 | 2026-05-17 |
| 服务端 faster-whisper 内置 | 要求用户配 Whisper API Key | 内置是核心诉求，用户不应自行配置 | 2026-05-17 |
| 音频上限 60s / 10MB | 无上限 / 30s | 30s 过短，60s 覆盖绝大多数语音输入场景，防止服务端过载 | 2026-05-17 |
| 默认模型 `small` | `tiny`（太不准）/ `large`（太慢）| 在准确率和速度之间的最优平衡，CPU 可接受 | 2026-05-17 |

---

## 八、5Why 根因挖掘

**表层需求**: 语音输入在国内不可用，需要换成内置 STT 方案

**Why 1**: 为什么语音输入在国内不可用？
> 因为：浏览器 `SpeechRecognition` API 底层走 Google 语音识别服务，国内无法访问

**Why 2**: 为什么这是严重问题？
> 因为：用户期望通过语音代替键盘输入，这是不方便打字场景的核心手段；功能完全失效等于这个能力不存在

**Why 3**: 为什么语音输入对 TeamAgentX 重要？
> 因为：多助手群聊的核心价值是"低成本高效沟通"；如果输入本身有摩擦，就削弱了产品的流畅感

**Why 4**: 为什么要内置而不让用户自配？
> 因为：让用户注册第三方 STT 服务、配置 API Key，是普通用户不可接受的门槛；基础输入能力必须开箱即用

**Why 5**: 为什么开箱即用是关键约束？
> 因为：TeamAgentX 的目标用户愿意自行部署服务器，但不愿意为每个基础能力额外配置外部依赖；内置能力是产品信任感的基础

**Root Insight**: 语音输入是产品基础能力完整性的一部分，国内可用性失效等于直接缺失。内置方案是恢复完整性的唯一路径，与"用户自配"不等价。

**设计启示**: 方向正确，无偏离。需注意：部署文档必须明确 faster-whisper + ffmpeg 安装步骤，否则"内置"对运维者仍是黑盒。

---

## 九、Kano 需求分类

### Basic（用户默认期望，不做就扣分）

- 点麦克风能录音，说完文字出现在输入框 — 微信/钉钉已建立用户默认预期
- 转写失败给明确提示 — 行业惯例：任何输入失败都必须有反馈，不能静默

### Performance（做得越好越满意）

- 转写延迟（越短越好，3s 是心理舒适线）— 改进轴：模型大小 / GPU 加速
- 中文识别准确率 — 改进轴：模型版本升级
- 录音时长上限 — 改进轴：服务端资源

### Excitement（超预期，做了加分）

- 实时字幕（边说边显示）— 成熟产品有，但复杂度高；移至 Won't
- 转写完成后自动识别 @mention — 竞品未见；YAGNI，移至 Won't

### Indifferent（用户不关心）

- 多语言切换 UI — 用户不会主动设置，默认中文即可；移至 Won't

### Kano-MoSCoW 对齐检查

| 需求 | Kano | MoSCoW | 对齐 |
|---|---|---|---|
| 内置 STT 链路 | Basic | Must | ✅ |
| 转写失败提示 | Basic | Must | ✅ |
| 转写延迟 ≤ 8s | Performance | Should | ✅ |
| 实时流式转写 | Excitement | Won't | ✅ |
| 多语言切换 UI | Indifferent | Won't | ✅ |

---

## 十、MoSCoW 优先级

### Must（必须做）

| # | 需求 | 证据 |
|---|---|---|
| M1 | 服务端 faster-whisper STT provider（`transcribe` 方法实现） | 用户明确：国内 SpeechRecognition 不可用，需内置方案 |
| M2 | `POST /speech/stt` HTTP 接口（接收音频，返回文本） | 行业惯例：与现有 `/speech/tts` 模式对称；前端唯一调用路径 |
| M3 | 前端 MediaRecorder 录音 → 上传 → 填入输入框完整链路 | 用户明确诉求：语音输入需在国内可用 |
| M4 | 录音中状态 UI + 失败明确提示（不静默失败） | Story 2 AC：失败需在 5s 内提示，按钮需恢复可点击 |
| M5 | faster-whisper 未安装时返回 503 + `STT_UNAVAILABLE` 错误码 | Story 3 AC：前端据此禁用麦克风而非展示 500 |

### Should（应该做）

| # | 需求 | 为何不是 Must |
|---|---|---|
| S1 | 音频大小上限 10MB 服务端强制校验 | 有超时保护，但显式校验更健壮 |
| S2 | 前端首次收到 `STT_UNAVAILABLE` 后持久禁用麦克风按钮 | 可首次失败后切状态，不必预检 |
| S3 | 部署文档：faster-whisper + ffmpeg 安装步骤 | 功能上线必要，但不阻塞代码实现 |

### Could（可做可不做）

| # | 需求 | 延迟原因 |
|---|---|---|
| C1 | 录音波形动画（实时振幅可视化） | 纯视觉增强，不影响核心功能 |
| C2 | 转写完成后光标定位到文本末尾 | 细节优化，不影响验收 |

### Won't（本期不做）

| # | 需求 | 原因 |
|---|---|---|
| W1 | 实时流式转写（WebSocket） | YAGNI：一期延迟可接受，无用户诉求 |
| W2 | 移动端（Flutter）语音输入 | 另立需求，运行时不同 |
| W3 | 多语言切换 UI | YAGNI：无当前场景需要非中文 |
| W4 | 用户配置 Whisper 模型（tiny/small/large） | YAGNI：默认 small 满足需求，无需用户感知 |
| W5 | 转写置信度显示 | YAGNI：用户原始需求无提及 |
| W6 | @mention 自动识别 | YAGNI：完全是推测性功能 |
| W7 | 远程 Whisper API（用户配置） | 与内置方向冲突，废弃 |

---

## 十一、功能详细需求定义

### 功能 1：服务端 faster-whisper STT Provider

**描述**: 服务端调用本地 faster-whisper 二进制对音频文件进行语音转写，输出转写文本。

**输入**:

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| audioBuffer | Buffer | 是 | 非空 | 音频文件内容 |
| mimeType | string | 否 | `audio/webm` 等 | 用于判断是否需要格式转换 |
| language | string | 否 | 默认 `zh` | 目标语言 |
| model | string | 否 | 默认 `config.speech.whisperModel` | Whisper 模型名 |

**处理逻辑**:
1. 将音频 Buffer 写入 `tmpdir` 临时文件
2. 调用 faster-whisper 二进制，参数：`--model {model} --language {language} --output_format txt {tmpFile}`
3. 读取输出文本，trim 空白
4. 清理临时文件（成功或失败均清理）
5. 返回 `SpeechArtifact { kind: 'transcript', text, provider: 'faster-whisper' }`

**输出**:

| 情况 | 内容 | 格式 |
|---|---|---|
| 成功 | `{ kind: 'transcript', text: string, provider: 'faster-whisper' }` | SpeechArtifact |
| 二进制未安装 | throw Error（含 'faster-whisper 未安装' 关键词） | Error |
| 转写失败 | throw Error（含原始错误） | Error |

**边界情况**:

| 场景 | 系统行为 |
|---|---|
| 音频内容为静音/无声 | 返回 `text: ''`，不报错 |
| 二进制 ENOENT | 抛出含"faster-whisper 未安装"的明确提示错误 |
| 转写超时（> 30s） | 杀子进程，抛出超时错误 |
| 临时文件清理失败 | 静默忽略（不影响主流程） |

**依赖**: `config.speech.whisperBinary`、`config.speech.whisperModel`

---

### 功能 2：`POST /speech/stt` 接口

**描述**: 接收前端上传的音频文件，调用 faster-whisper provider 转写，返回文本。

**输入（multipart/form-data）**:

| 字段 | 类型 | 必填 | 取值范围 | 说明 |
|---|---|---|---|---|
| audio | File | 是 | Content-Type: audio/* | 录音文件 |
| language | string | 否 | 默认 `zh` | 转写语言 |

请求头：`Authorization: Bearer <token>`（必填）

**处理逻辑**:
1. 验证 JWT token，失败返回 401
2. 校验 `audio` 字段存在，否则返回 400
3. 校验文件 Content-Type 以 `audio/` 开头，否则返回 400
4. 校验文件大小 ≤ 10MB，否则返回 400
5. 读取文件 Buffer，构造 `SpeechTask { type: 'stt', input: { audioBuffer, mimeType, language } }`
6. 调用 `serverSpeechService.execute(task)`
7. 返回转写结果

**输出**:

| 情况 | HTTP 状态 | Body |
|---|---|---|
| 成功 | 200 | `{ success: true, text: string }` |
| 未鉴权 | 401 | `{ success: false, error: 'Unauthorized' }` |
| 参数错误 | 400 | `{ success: false, error: string }` |
| faster-whisper 未安装 | 503 | `{ success: false, error: 'STT_UNAVAILABLE', message: string }` |
| 转写超时 | 504 | `{ success: false, error: '转写超时，请重试' }` |
| 其他失败 | 500 | `{ success: false, error: string }` |

**边界情况**:

| 场景 | 系统行为 |
|---|---|
| audio 字段缺失 | 400，`'音频文件不能为空'` |
| 文件类型非 audio/* | 400，`'不支持的文件类型'` |
| 文件 > 10MB | 400，`'文件大小超出限制（最大 10MB）'` |
| faster-whisper 未安装 | 503 + 错误码 `STT_UNAVAILABLE`（前端据此禁用麦克风） |
| 转写超时 | 504，`'转写超时，请重试'` |

**依赖**: 功能 1（faster-whisper provider）、`authService.getUserFromToken`

---

### 功能 3：前端 MediaRecorder 录音链路

**描述**: 前端麦克风按钮管理录音生命周期，录音结束后上传音频并将转写文本填入输入框。

**输入（用户操作）**:

| 操作 | 触发条件 |
|---|---|
| 开始录音 | 点击麦克风按钮（当前状态为未录音） |
| 结束录音 | 再次点击麦克风按钮，或录音达 60s |

**处理逻辑**:
1. 点击麦克风 → 请求 `navigator.mediaDevices.getUserMedia({ audio: true })`
2. 获取权限成功 → 创建 `MediaRecorder`，开始录音，按钮显示录音中状态
3. 点击停止 / 达 60s → 停止 `MediaRecorder`，合并 chunks 为 Blob
4. 构造 `FormData`，`append('audio', blob, 'recording.webm')`
5. `POST /speech/stt`，15s 超时
6. 成功 → 文本追加到输入框现有内容末尾（有内容则加空格）；恢复按钮
7. 失败 → 显示错误提示，5s 后自动消失；恢复按钮为可点击

**输出（UI 状态）**:

| 状态 | UI 表现 |
|---|---|
| 未录音 | 麦克风按钮正常可点击 |
| 录音中 | 按钮变红/波形动画，显示录音时长 |
| 上传转写中 | 按钮 loading 状态，不可点击 |
| 成功 | 文字填入输入框，按钮恢复正常 |
| 失败 | 错误 toast（5s 消失），按钮恢复正常 |
| STT_UNAVAILABLE | 按钮置灰，持久提示"语音转写暂不可用" |

**边界情况**:

| 场景 | 系统行为 |
|---|---|
| 用户拒绝麦克风权限 | 显示"请允许麦克风权限后重试"，不进入录音状态 |
| 录音中切换聊天室 | 自动停止录音并取消上传，不填入任何内容 |
| 转写结果为空字符串 | 显示"未识别到语音内容"，不修改输入框 |
| 服务返回 503 STT_UNAVAILABLE | 按钮持久置灰，提示"语音转写暂不可用" |
| 上传超时（15s） | 中止请求，显示"转写超时，请重试" |
| 录音达 60s 自动停止 | 停止录音，进入上传转写流程，toast"录音已达上限" |

**依赖**: `POST /speech/stt`（功能 2）、`chat-input-area.tsx` 输入框状态

---

## 十二、非功能需求

**性能**:
- 转写延迟：单次录音（≤60s）P90 ≤ 8s（CPU，small 模型）；P90 ≤ 3s（GPU）[推演]
- 并发：初期单实例串行，满足小团队（≤10 并发用户）
- 音频上传大小：单次 ≤ 10MB
- 超载行为：请求超时 15s 返回 504

**安全**:
- 鉴权：与 `POST /speech/tts` 一致，需要 `Authorization: Bearer <token>`
- 授权：已登录用户均可调用，无额外权限控制
- 数据敏感性：音频属于用户私有数据，转写完成后临时文件立即删除，不持久化
- 攻击面：接收 multipart 上传，需校验文件类型（仅接受 audio/*）、大小上限（10MB）；路径使用 `tmpdir` 防止路径穿越
- 审计：转写请求记录到服务端日志（不含音频内容本身）

**兼容性**:
- 浏览器：支持 `MediaRecorder` 的主流浏览器（Chrome 47+、Firefox 25+、Safari 14.1+）
- 音频格式：接受 `audio/webm`、`audio/mp4`、`audio/ogg`；faster-whisper 需 ffmpeg 处理格式转换
- API 向后兼容：纯新增接口，不影响现有接口
- faster-whisper 版本：`>=1.0.0`

**易用性**:
- 新用户无需任何学习即可完成核心流程（麦克风图标是通用认知）
- 错误恢复：所有失败路径在 5s 内给出明确文字提示，按钮自动恢复，无需刷新
- 无障碍：麦克风按钮需有 `aria-label`，录音状态需有 `aria-live` 区域
- 移动端：本期仅支持 Electron 桌面版（同 Web）

**可维护性**:
- 测试覆盖：provider 核心逻辑需有 unit test（参照 `edge-tts.provider.test.ts` 模式）
- 文档：部署文档需说明 faster-whisper + ffmpeg 安装步骤
- 可观测性：转写成功/失败记录到服务端日志，包含耗时、音频时长（不含音频内容）
- 部署：无状态，可随服务重启；模型文件首次自动下载，需在部署文档说明

**可扩展性**:
- `SpeechProvider.transcribe` 接口已存在，未来新增远程 STT provider 无需改动网关和服务层
- Whisper 模型通过 `config.speech.whisperModel` 环境变量配置，无需改代码
- [推演] 6 个月内用户规模不大，串行处理足够；若并发增加可考虑 worker pool

---

## 十三、架构影响分析

### 受影响模块（基于 gitnexus 扫描）

| 模块 | 路径 | 影响类型 | 风险级别 |
|---|---|---|---|
| Speech 默认服务 | `server/src/modules/speech/default-service.ts` | 直接修改（注册新 provider） | LOW |
| Speech Gateway | `server/src/gateway/speech.gateway.ts` | 新增路由（`POST /speech/stt`） | LOW（新增不破坏） |
| Speech Provider 接口 | `server/src/modules/speech/domain/provider.ts` | 无变更（`transcribe` 已定义） | 无影响 |
| Config | `server/src/config/index.ts` | 新增 `speech.whisperBinary` / `speech.whisperModel` | LOW |
| Chat Input Area | `apps/web/src/components/chat/chat-input-area.tsx` | 行为变更（录音逻辑重写） | LOW（独立组件） |
| Browser Speech | `apps/web/src/lib/browser-speech.ts` | STT 入口废弃，TTS 部分不变 | LOW |

### 数据模型变更

- 无新表，无 schema 变更，无迁移
- 音频文件临时落盘（tmpdir），转写完成后清理，与 edge-tts 模式完全一致

### 接口合约变更

- **新增**：`POST /speech/stt`（multipart/form-data → `{ success: true, text: string }`）
- **不变**：`POST /speech/tts` 及所有现有接口
- **废弃**：无（前端 SpeechRecognition 调用在组件内部，不是公共接口）

### 风险汇总

| 风险 | 级别 | 缓解 |
|---|---|---|
| 破坏现有调用 | Low | gitnexus 确认 0 直接上游调用方 |
| 数据迁移失败 | Low | 无数据迁移 |
| faster-whisper 未安装 | Medium | 接口返回 STT_UNAVAILABLE，前端降级处理 |
| 回滚复杂度 | Low | 删除新文件 + 注销注册即可还原 |

**整体架构风险：LOW**

---

## 十四、认知复杂度评估

**主流程步骤数**: 3 步（点击麦克风 → 说话 → 点击停止）
**决策点数量**: 1 个（什么时候停止录音）
**新概念数量**: 0 个（麦克风 = 录音，是通用认知）
**复杂度评级**: 低负担

**基准对比**:

| 产品 | 同功能步骤数 |
|---|---|
| 微信语音输入 | 3步（长按 → 说话 → 松开）|
| 我们的设计 | 3步（点击 → 说话 → 点击）|

**结论**: 与行业主流持平，无认知负担问题。

---

## 十五、扩展预留建议

**架构扩展点**:
- `SpeechProvider.transcribe` 接口已存在，未来新增远程 STT（讯飞、阿里等）只需实现该方法并注册，无需改动网关和服务层
- `SpeechRouter` 支持按 provider ID 路由，未来可通过 profile 选择不同 STT provider

**后续迭代方向（Won't 列表候选）**:
- 实时流式转写 — 触发条件：用户明确反馈"等待 3-8s 不可接受"时
- 移动端语音输入 — 触发条件：Flutter 端有明确用户需求时
- 多语言切换 — 触发条件：有非中文用户规模化使用时
- 转写置信度 — 触发条件：用户反馈"不知道转写是否准确"时

**配置化建议**:
- `SPEECH_WHISPER_BINARY`：faster-whisper 二进制路径（环境变量，不硬编码）
- `SPEECH_WHISPER_MODEL`：模型名（默认 `small`，通过环境变量可改，不需要 UI）

---

## 十六、决策日志

| 决策 | 备选方案 | 选择理由 | 决策时间 |
|---|---|---|---|
| 录音结束后一次性上传转写 | 实时流式 WebSocket | 一期复杂度低，延迟可接受，与 edge-tts 模式对称 | 2026-05-17 |
| 前端 MediaRecorder 采集 | 继续用浏览器 SpeechRecognition | SpeechRecognition 国内不可用，废弃 | 2026-05-17 |
| 服务端 faster-whisper 内置 | 要求用户配 Whisper API Key | 内置是核心诉求，用户不应自行配置 | 2026-05-17 |
| 音频上限 60s / 10MB | 无上限 / 30s | 30s 过短；60s 覆盖绝大多数语音输入场景 | 2026-05-17 |
| 默认模型 `small` | `tiny`（准确率低）/ `large`（CPU 太慢）| 准确率与速度最优平衡，CPU 环境可接受 | 2026-05-17 |
| 失败返回 503 + STT_UNAVAILABLE | 统一返回 500 | 前端需要区分"服务不可用"和"转写失败"，才能正确禁用按钮 | 2026-05-17 |

---

## 预留扩展位

<!-- 新增分析维度在此添加，不改动上方结构 -->
