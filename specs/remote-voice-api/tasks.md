# Implementation Plan: 远程语音 API（TTS + STT 独立配置）

> STT 供应商配置本期通过数据库/系统默认解析，不开放前端 UI 配置。

---

## 服务端

- [ ] 1. 新增 `openai-compatible-stt` provider
  - 新建 `server/src/modules/speech/providers/remote-stt.provider.ts`
  - 参考 `remote-tts.provider.ts` 结构，实现 `transcribe()` 方法
  - 调用 `${baseUrl}/audio/transcriptions`（multipart/form-data）
  - 复用 `validateRemoteUrl` + `isPrivateOrReservedHost` URL 安全校验
  - LlmProvider 解析优先级：`vendorOptions.llmProviderId` → `agentId` → 系统默认
  - 返回 `SpeechArtifact { kind: 'transcript', text, provider: 'openai-compatible-stt' }`
  - _Requirement: M1_

- [ ] 2. 注册 STT provider，移除 edge-tts
  - 修改 `server/src/modules/speech/default-service.ts`
  - 移除 `createEdgeTtsProvider()` 注册
  - 新增 `createRemoteSttProvider()` 注册
  - _Requirement: M1, M6_

- [ ] 3. 新增 `POST /speech/stt` 网关
  - 修改 `server/src/gateway/speech.gateway.ts`
  - 注册 `@fastify/multipart`（参考 `upload.gateway.ts` 的注册方式）
  - 实现 `POST /speech/stt` 路由：JWT 鉴权 → 解析音频文件 → 读取 agentId/language 字段
  - 若有 agentId：从 DB 读取 agent.speechConfig.sttProfile 作为 task.profile
  - 文件大小校验 ≤ 25MB，无文件返回 400
  - 调用 `serverSpeechService.execute(sttTask)` → 返回 `{ text, provider }`
  - _Requirement: M2_

- [ ] 4. AgentSpeechConfig 扩展 sttProfile 字段
  - 修改 `server/src/modules/speech/speech-config.ts`
  - `AgentSpeechConfig` 新增 `sttProfile?: SpeechProfile | null`
  - `normalizeAgentSpeechConfig` 中不为 sttProfile 填默认值（保持 null）
  - `normalizeSpeechProviderId` 新增归一化规则：`'edge-tts' → 'browser-local'`
  - `deserializeAgentSpeechConfig` 旧数据无 sttProfile 时反序列化为 null（不报错）
  - _Requirement: M4, M7_

- [ ] 5. 移除 edge-tts 内置预设
  - 修改 `server/src/modules/speech/speech-presets.ts`
  - 删除 `edge-xiaoxiao`、`edge-xiaoyi`、`edge-yunxi` 三个预设
  - 更新 `SpeechPresetId` 类型（仅保留 4 个 browser-local 预设）
  - _Requirement: M6_

---

## 前端

- [ ] 6. 录音改为 MediaRecorder + /speech/stt
  - 修改 `apps/web/src/components/chat/chat-input-area.tsx`
  - 移除 `startBrowserSpeechRecognition` / `supportsBrowserSpeechRecognition` 依赖
  - 新增 `MediaRecorder` 录音逻辑（`getUserMedia` → `MediaRecorder.start/stop`）
  - 新增内联 `transcribeAudio(blob)` 函数：POST FormData 到 `/api/speech/stt`，携带 JWT
  - `MediaRecorder.onstop` 中：收集 chunks → 调 transcribeAudio → 填入输入框
  - 浏览器不支持 `MediaRecorder` 时：按钮禁用，hover 提示"当前浏览器不支持录音"
  - _Requirement: M3_

- [ ] 7. 前端 normalizeSpeechProviderId + 移除 edge-* 预设
  - 修改 `apps/web/src/lib/agent-speech.ts`
  - `normalizeSpeechProviderId` 新增 `'edge-tts' → 'browser-local'`
  - 删除 `edge-xiaoxiao`、`edge-xiaoyi`、`edge-yunxi` 三个预设
  - 更新 `AgentVoicePresetId` 类型（仅保留 4 个 browser-local 预设）
  - _Requirement: M6, M7_

- [ ] 8. 前端 speech default-service 移除 edge-tts provider 注册
  - 修改 `apps/web/src/speech/default-service.ts`
  - 删除 `createRemoteTtsSpeechProvider({ providerId: 'edge-tts' })` 注册
  - _Requirement: M6_

---

## 验证

- [ ] 9. 本地测试验证
  - 配置 SiliconFlow 或 Groq 作为系统默认 LlmProvider
  - 验证录音 → POST /speech/stt → 识别文字填入输入框完整流程
  - 验证旧 edge-tts 配置的助手 TTS 仍可正常 fallback 到 browser-local
  - 验证 /speech/tts 无回归（旧 TTS 流程不受影响）
