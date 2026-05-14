# 语音功能技术设计

## 1. 设计目标

本设计的核心目标是把 TeamAgentX 的语音能力抽象为独立领域，而不是继续以“录音入口 + 浏览器朗读”这样的分散功能推进。

第一阶段要解决的是架构问题：

- 统一表达 `tts`、`stt`、`realtime-chat`
- 让前端本地能力和服务端远程能力共用同一套语义
- 让后续语音大模型接入只需要新增 provider

## 2. 现状与问题

当前代码中已经具备：

- 语音消息上传与播放能力
- 浏览器本地语音识别入口
- 浏览器本地语音播报入口
- 助手级语音配置字段

但现状仍有明显问题：

- 浏览器 `speechSynthesis` 直接暴露在业务调用链中
- 配置结构偏 `voiceId / speed / volume`，不适合承载远程 TTS 或语音大模型
- 前端和服务端没有统一的语音任务语义
- 未来若接远程 TTS / STT，现有模块需要横向修改

因此本期最佳路径不是继续增强浏览器 TTS，而是先做统一抽象层。

## 3. 总体方案

### 3.1 核心原则

- 上层业务只调用统一语音服务，不感知底层 provider
- provider 可以分布在前端或服务端，但必须共享同一套领域语义
- 先支持 `tts + stt`，同时为 `realtime-chat` 预留标准接口
- provider 注册第一版使用代码内置注册

### 3.2 统一架构

建议把语音能力拆成四层：

1. `domain contract`
   定义 `SpeechProfile`、`SpeechTask`、`SpeechArtifact`、`SpeechSession`、`SpeechProvider`
2. `provider layer`
   实现 `browser-local`、`remote-tts`、未来 `voice-llm`
3. `router layer`
   按能力、策略、配置与运行环境选择 provider
4. `application layer`
   为聊天、助手配置、消息播报、录音转写提供统一入口

## 4. 领域模型

### 4.1 SpeechCapability

用于描述 provider 的能力范围：

- `tts`
- `stt`
- `realtime-chat`

每个 provider 至少声明：

- 支持的能力
- 支持的运行端：`client` 或 `server`
- 支持的输出格式和约束

### 4.2 SpeechProfile

`SpeechProfile` 是语音画像配置，不应再局限于浏览器朗读参数。

建议结构分为三组：

- `identity`
  - `provider`
  - `model`
  - `voice`
  - `fallbackProvider`
- `render`
  - `speed`
  - `volume`
  - `pitch`
  - `emotion`
  - `style`
  - `format`
  - `sampleRate`
- `advanced`
  - `temperature`
  - `prompt`
  - `vendorOptions`

设计要点：

- 通用字段优先，避免厂商 SDK 直透到业务层
- 厂商差异收口到 `vendorOptions`
- `prompt / style / emotion` 直接为未来语音大模型复用

### 4.3 SpeechTask

语音能力统一通过任务对象发起。

建议至少支持三类任务：

- `tts`
  - 输入文本和 `SpeechProfile`
- `stt`
  - 输入音频资源和可选转写参数
- `realtime-chat`
  - 输入会话配置、音频流协商参数和 `SpeechProfile`

任务对象应包含：

- `type`
- `profile`
- `input`
- `context`
- `preferences`

其中 `preferences` 可用于表达：

- 是否允许 fallback
- 是否优先本地
- 是否要求缓存

### 4.4 SpeechArtifact

所有 provider 输出都统一沉淀成 `SpeechArtifact`。

建议结果结构至少包含：

- `kind`
- `text`
- `audio`
- `durationMs`
- `mimeType`
- `provider`
- `model`
- `voice`
- `metadata`

这样消息系统、播放器和缓存逻辑无需关心结果来自本地还是远程。

### 4.5 SpeechSession

`SpeechSession` 先定义接口，不急着实现完整实时产品。

第一阶段只约定：

- 会话标识
- 当前 provider
- 输入输出协商参数
- 生命周期：`open / active / closing / closed / failed`

## 5. Provider 设计

### 5.1 Browser Local Provider

前端实现本地 provider，至少承载：

- 浏览器 `speechSynthesis` 的 TTS
- 浏览器语音识别的 STT

定位：

- 本地试听
- 本地轻量播报
- 无服务端依赖的兜底方案

限制：

- 音色与自然度不可控
- 运行能力依赖浏览器和系统
- 不适合作为长期主播报方案

### 5.2 Remote TTS Provider

服务端实现远程 provider，用于助手正式播报。

定位：

- 更高自然度
- 跨端一致音色
- 未来接语音大模型前的主力播报方案

职责：

- 调供应商 TTS
- 生成音频资源
- 输出统一 `SpeechArtifact`
- 为缓存策略提供 provider metadata

### 5.3 Future Voice LLM Provider

未来语音大模型 provider 也挂在同一套 provider 接口下。

第一阶段不要求实现，但接口必须预留：

- 实时会话能力声明
- 音频输入输出协商参数
- 会话级状态管理

## 6. Router 与策略层

`SpeechRouter` 负责决定某个任务应该落到哪个 provider。

第一版策略建议：

- 助手自动播报：优先 `remote-tts`
- 助手本地试听：优先 `browser-local`
- 用户本地录音转写：优先 `browser-local`
- 未来正式转写：按配置切到远程 STT

Router 决策应参考：

- `SpeechTask.type`
- `SpeechProfile.provider`
- `SpeechProfile.fallbackProvider`
- 当前运行环境
- provider capability

## 7. 前后端职责边界

### 7.1 前端职责

- 承载 `browser-local` provider
- 发起本地 TTS / STT 任务
- 播放 `SpeechArtifact.audio`
- 在助手配置界面编辑 `SpeechProfile`

### 7.2 服务端职责

- 承载 `remote-*` provider
- 提供远程 TTS / STT 统一服务入口
- 负责语音资源缓存、落盘、鉴权和审计
- 为消息系统提供标准化音频产物

### 7.3 共享职责

前后端应共享同一套语义模型：

- `SpeechProfile`
- `SpeechTask`
- `SpeechArtifact`
- `SpeechCapability`

这样可以避免前端一套、服务端一套的双重抽象。

## 8. 与现有语音消息方案的关系

旧方案里的以下内容继续保留：

- `Attachment.type = audio`
- 音频上传接口
- 音频消息卡片
- 录音发送入口
- 转写文本字段

变化点在于：

- 助手语音配置从 `voiceConfig` 升级为 `speechProfile`
- 浏览器 TTS / STT 不再被业务层直接调用，而是被封装为 provider
- 服务端远程 TTS / STT 不再作为零散接口追加，而是落在统一语音服务下

## 9. 模块建议

建议新增统一语音模块，而不是继续把语音代码分散在聊天组件里。

服务端建议结构：

- `server/src/modules/speech/domain/`
- `server/src/modules/speech/providers/`
- `server/src/modules/speech/speech.registry.ts`
- `server/src/modules/speech/speech.router.ts`
- `server/src/modules/speech/speech.service.ts`

前端建议结构：

- `apps/web/src/speech/domain/`
- `apps/web/src/speech/providers/`
- `apps/web/src/speech/speech-router.ts`
- `apps/web/src/speech/speech-service.ts`

## 10. 兼容与迁移

### 10.1 voiceConfig 兼容

现有 `voiceConfig` 不能直接废弃，建议通过兼容映射过渡：

- 读取时：把旧 `voiceConfig` 映射成 `SpeechProfile`
- 保存时：新入口优先写 `speechProfile`
- 过渡期允许继续兼容旧字段

### 10.2 数据兼容

- 现有音频附件结构保持不变
- 原有浏览器语音播报链路先迁移到 `browser-local` provider 内部
- 旧业务入口先调用适配层，再逐步改成统一语音服务

## 11. 分阶段实施建议

### 阶段 1：抽象先行

- 定义 domain contract
- 定义 provider 接口
- 建立 router / registry
- 不急着改变现有用户行为

### 阶段 2：收编现有能力

- 把浏览器本地 TTS / STT 包装成 `browser-local`
- 让语音消息、助手播报、试听入口改走统一服务

### 阶段 3：接第一个远程 provider

- 增加 `remote-tts`
- 为助手正式播报提供更自然的主链路
- 明确 fallback 规则

### 阶段 4：扩展语音大模型

- 增加 `realtime-chat` provider
- 引入 `SpeechSession`
- 再做实时语音产品态
