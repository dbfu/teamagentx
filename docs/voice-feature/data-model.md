# 语音功能数据模型草案

## 1. 目标

本草案定义统一语音抽象层需要的核心数据模型，要求：

- 兼容当前语音消息附件结构
- 支持前端本地 provider 与服务端远程 provider 共用同一套语义
- 支持以后接入远程 TTS / STT / 语音大模型
- 避免为早期能力过度拆库表

## 2. 现有数据继续保留

### 2.1 Attachment

现有 `Attachment` 的音频扩展仍然成立：

- `type = audio`
- `durationMs`
- `transcript`
- `waveform`

原因：

- 音频消息本质仍然是消息附件
- 这层模型服务的是“消息存档与展示”
- 不应该拿 provider 级模型去替代消息附件模型

## 3. 新增领域模型

### 3.1 SpeechProfile

`SpeechProfile` 是语音画像配置，服务于“怎么说”和“优先走谁”。

建议结构：

```ts
interface SpeechProfile {
  provider?: string | null
  model?: string | null
  voice?: string | null
  fallbackProvider?: string | null

  speed?: number | null
  volume?: number | null
  pitch?: number | null
  emotion?: string | null
  style?: string | null
  format?: string | null
  sampleRate?: number | null

  temperature?: number | null
  prompt?: string | null
  vendorOptions?: Record<string, unknown> | null
}
```

说明：

- 前三项是 provider 识别与路由关键字段
- `emotion / style / prompt` 直接为未来语音大模型准备
- `vendorOptions` 用来装厂商特定字段

### 3.2 SpeechCapability

用于描述 provider 支持什么。

```ts
type SpeechTaskType = 'tts' | 'stt' | 'realtime-chat'

interface SpeechCapability {
  provider: string
  runtime: 'client' | 'server'
  taskTypes: SpeechTaskType[]
  formats?: string[]
  sampleRates?: number[]
}
```

### 3.3 SpeechTask

统一语音执行请求：

```ts
interface SpeechTask<TInput = unknown> {
  type: 'tts' | 'stt' | 'realtime-chat'
  profile?: SpeechProfile | null
  input: TInput
  context?: {
    chatRoomId?: string
    agentId?: string
    messageId?: string
    source?: 'assistant-auto-speak' | 'assistant-preview' | 'user-recording' | 'system'
  }
  preferences?: {
    preferLocal?: boolean
    allowFallback?: boolean
    cacheKey?: string | null
  }
}
```

### 3.4 SpeechArtifact

统一执行结果：

```ts
interface SpeechArtifact {
  kind: 'audio' | 'transcript' | 'session'
  text?: string | null
  audioUrl?: string | null
  mimeType?: string | null
  durationMs?: number | null

  provider: string
  model?: string | null
  voice?: string | null
  metadata?: Record<string, unknown> | null
}
```

### 3.5 SpeechSession

先定义，不急着完整落地：

```ts
interface SpeechSession {
  id: string
  provider: string
  status: 'open' | 'active' | 'closing' | 'closed' | 'failed'
  profile?: SpeechProfile | null
  metadata?: Record<string, unknown> | null
}
```

## 4. 数据库存储策略

### 4.1 助手配置

当前推荐不把 `SpeechProfile` 拆成很多列，而是先用 JSON 字符串存储。

原因：

- 第一阶段字段仍在演进
- provider 差异很大
- 过早拆列会增加迁移成本

建议方向：

- 长期新增 `speechProfile String?`
- 过渡期兼容现有 `voiceConfig`

### 4.2 运行结果

`SpeechArtifact` 不建议整体落库成独立表作为第一阶段前置要求。

第一阶段更适合：

- 对消息相关结果仍然落在 `Attachment`
- provider 返回的运行元数据按需附着在消息、执行记录或缓存层

如果后续需要统一审计，可再引入独立 `SpeechExecution`。

## 5. voiceConfig 到 SpeechProfile 的兼容映射

现有 `voiceConfig` 示例：

```json
{
  "enabled": true,
  "outputMode": "manual",
  "voiceId": null,
  "speed": 1,
  "volume": 1,
  "autoPlay": false
}
```

建议映射规则：

- `voiceId -> voice`
- `speed -> speed`
- `volume -> volume`
- 本地浏览器能力默认映射 `provider = browser-local`
- `enabled / outputMode / autoPlay` 继续保留为业务行为配置，不直接塞进 `SpeechProfile`

这里的关键区分是：

- `SpeechProfile` 解决“怎么合成/识别”
- `enabled / outputMode / autoPlay` 解决“什么时候播、怎么播”

不建议把这两类配置混在一个对象里继续无限膨胀。

## 6. 建议的配置归属

建议将语音相关配置拆成两类：

### 6.1 行为配置

继续挂在助手侧，例如：

```ts
interface AgentSpeechBehaviorConfig {
  enabled: boolean
  outputMode: 'off' | 'manual' | 'auto_final_only'
  autoPlay: boolean
}
```

### 6.2 画像配置

单独使用：

```ts
interface AgentSpeechConfig {
  behavior: AgentSpeechBehaviorConfig
  profile: SpeechProfile
}
```

这样可以避免未来把“业务触发策略”和“模型渲染参数”搅在一起。

## 7. 历史兼容策略

- 历史音频消息继续按 `Attachment` 解析
- 旧助手只存 `voiceConfig` 时，通过适配层生成默认 `SpeechProfile`
- 如果未来引入 `speechProfile` 字段，读取时优先新字段，缺失时回退旧字段

## 8. 第二阶段可扩展项

后续可继续补充而不破坏当前模型：

- `SpeechExecution`
- `SpeechCacheEntry`
- `SpeechProviderStatus`
- `SpeechResourceDescriptor`

这些都不应成为第一阶段抽象落地的阻塞项。
