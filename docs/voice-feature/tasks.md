# 语音功能开发计划

## 1. 目标

本计划围绕“统一语音抽象层”推进，而不是单独再做一轮语音消息功能。

核心要求：

- 抽象先行
- 兼容现有能力
- 为远程 provider 和语音大模型留清晰扩展位

## 2. 里程碑

### M1：定义统一语音领域模型

- [ ] 定义 `SpeechProfile`
- [ ] 定义 `SpeechTask`
- [ ] 定义 `SpeechArtifact`
- [ ] 定义 `SpeechCapability`
- [ ] 定义 `SpeechSession`
- [ ] 明确行为配置与画像配置的拆分

交付结果：

- 前后端有统一语音语义
- 现有能力可以开始向统一接口迁移

### M2：搭建 provider 框架

- [ ] 建立 provider 接口
- [ ] 建立代码内置 `registry`
- [ ] 建立 `router`
- [ ] 建立统一 `speech service`

交付结果：

- 语音调用从“直连实现”变成“走 provider”

### M3：收编现有前端本地能力

- [ ] 把浏览器 TTS 封装成 `browser-local` TTS provider
- [ ] 把浏览器语音识别封装成 `browser-local` STT provider
- [ ] 让试听、自动播报、录音转写入口改走统一语义

交付结果：

- 现有本地能力不再直接暴露给业务层

### M4：升级助手语音配置

- [ ] 设计 `speechConfig = behavior + profile`
- [ ] 兼容现有 `voiceConfig`
- [ ] 更新前端配置 UI
- [ ] 明确 `voiceConfig -> speechProfile` 映射

交付结果：

- 助手配置可支撑远程 provider 与未来语音大模型

### M5：接入第一个远程 provider

- [ ] 确定远程 TTS provider 适配方式
- [ ] 实现服务端 `remote-tts` provider
- [ ] 定义缓存与失败 fallback 的最小策略
- [ ] 让助手自动播报支持优先走远程

交付结果：

- 助手语音质量不再完全受限于浏览器本地 TTS

### M6：为语音大模型预留会话接口

- [ ] 保留 `realtime-chat` 任务语义
- [ ] 定义 `SpeechSession` 生命周期
- [ ] 明确第一版不做完整产品态

交付结果：

- 后续语音大模型接入不需要重做 domain

## 3. 任务拆分

### 3.1 服务端

- [ ] 新增 `server/src/modules/speech/domain/`
- [ ] 新增 `server/src/modules/speech/providers/`
- [ ] 新增 `speech.registry.ts`
- [ ] 新增 `speech.router.ts`
- [ ] 新增 `speech.service.ts`
- [ ] 设计远程 provider 统一输出 `SpeechArtifact`
- [ ] 评估是否需要补 `speechConfig` 持久化字段

### 3.2 Web / Electron 前端

- [ ] 新增 `apps/web/src/speech/domain/`
- [ ] 新增 `apps/web/src/speech/providers/`
- [ ] 新增前端 `speech-router`
- [ ] 新增前端 `speech-service`
- [ ] 将现有浏览器语音 API 封装进 provider
- [ ] 迁移试听与自动播报逻辑

### 3.3 配置与产品层

- [ ] 拆分“什么时候播”和“怎么说”的配置
- [ ] 更新助手配置页面
- [ ] 明确远程优先、本地兜底的产品策略

## 4. 依赖关系

- M1 是所有后续工作的前提
- M2 完成后，M3 与 M4 可并行
- M5 依赖 M2 与 M4
- M6 可在 M1 后先定义接口，不阻塞 M5

## 5. 风险清单

- 前后端共享语义时，类型定义位置需要控制好，避免重复维护
- `voiceConfig` 历史兼容若处理粗糙，容易出现配置语义混乱
- 若过早把 provider 平台化，会拉高第一阶段复杂度
- 若远程 provider 没有缓存策略，助手自动播报可能产生额外延迟和成本

## 6. 验证计划

- [ ] 浏览器本地试听仍可用
- [ ] 浏览器本地语音输入仍可用
- [ ] 语音消息上传、展示、播放无回归
- [ ] 助手自动播报可以通过统一语音入口触发
- [ ] 旧 `voiceConfig` 仍可被读取并映射
- [ ] 新增 provider 时不需要改动消息结构

## 7. 明确先不做

- [ ] 不做 provider 动态管理后台
- [ ] 不做多家远程 provider 一次性并行接入
- [ ] 不做完整实时语音通话产品
- [ ] 不做移动端完整语音抽象实现
