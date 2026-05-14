# 语音功能接口与消息契约草案

## 1. 目标

本草案定义统一语音抽象层需要的接口边界，而不是只定义音频上传接口。

重点是：

- 统一前端本地 provider 和服务端远程 provider 的调用语义
- 明确消息附件接口继续保留
- 为未来语音大模型预留请求结构

## 2. 契约分层

建议把接口分成两层：

### 2.1 消息附件契约

用于“录音上传、音频消息展示、历史消息回放”。

### 2.2 语音服务契约

用于“发起 TTS / STT / realtime-chat 任务”。

不要再把这两层混成一个“语音功能接口”。

## 3. 消息附件契约

### 3.1 `POST /upload/audio`

该接口继续保留，职责不变：

- 上传用户录音文件
- 上传助手生成的音频文件

建议响应继续保持：

```json
{
  "success": true,
  "data": {
    "type": "audio",
    "filename": "recording.webm",
    "mimeType": "audio/webm",
    "size": 483920,
    "url": "/uploads/audio/8f2d-recording.webm",
    "durationMs": 8420,
    "transcript": null
  }
}
```

### 3.2 消息附件对象

Socket 与历史消息中的音频附件结构继续统一：

```json
{
  "id": "att-1",
  "type": "audio",
  "url": "/uploads/audio/8f2d-recording.webm",
  "filename": "recording.webm",
  "mimeType": "audio/webm",
  "size": 483920,
  "durationMs": 8420,
  "transcript": "大家好，我先说一下这个想法。"
}
```

## 4. 语音服务统一请求结构

### 4.1 TTS 请求

建议服务端和前端本地 provider 都围绕统一请求对象工作：

```json
{
  "type": "tts",
  "profile": {
    "provider": "remote-tts",
    "model": "tts-model-x",
    "voice": "assistant-female-1",
    "fallbackProvider": "browser-local",
    "speed": 1,
    "volume": 1,
    "pitch": 1,
    "emotion": "calm",
    "style": "conversational",
    "format": "mp3",
    "sampleRate": 24000,
    "temperature": 0.4,
    "prompt": "语气自然，有陪伴感",
    "vendorOptions": null
  },
  "input": {
    "text": "你好，我来帮你梳理一下这个问题。"
  },
  "context": {
    "chatRoomId": "room-1",
    "agentId": "agent-1",
    "source": "assistant-auto-speak"
  },
  "preferences": {
    "preferLocal": false,
    "allowFallback": true,
    "cacheKey": "message:123"
  }
}
```

### 4.2 STT 请求

```json
{
  "type": "stt",
  "profile": {
    "provider": "browser-local",
    "fallbackProvider": "remote-stt"
  },
  "input": {
    "audioUrl": "/uploads/audio/8f2d-recording.webm",
    "mimeType": "audio/webm",
    "language": "zh-CN"
  },
  "context": {
    "chatRoomId": "room-1",
    "source": "user-recording"
  },
  "preferences": {
    "preferLocal": true,
    "allowFallback": true
  }
}
```

### 4.3 Realtime Chat 请求

第一阶段先定义语义，不要求完整接口实现：

```json
{
  "type": "realtime-chat",
  "profile": {
    "provider": "voice-llm",
    "model": "realtime-model-x",
    "voice": "assistant-female-1",
    "style": "natural"
  },
  "input": {
    "mode": "session-open",
    "sampleRate": 24000,
    "format": "pcm16"
  },
  "context": {
    "chatRoomId": "room-1",
    "agentId": "agent-1",
    "source": "system"
  }
}
```

## 5. 语音服务统一结果结构

### 5.1 TTS 结果

```json
{
  "kind": "audio",
  "text": "你好，我来帮你梳理一下这个问题。",
  "audioUrl": "/uploads/audio/generated-123.mp3",
  "mimeType": "audio/mpeg",
  "durationMs": 4360,
  "provider": "remote-tts",
  "model": "tts-model-x",
  "voice": "assistant-female-1",
  "metadata": {
    "cached": true
  }
}
```

### 5.2 STT 结果

```json
{
  "kind": "transcript",
  "text": "大家好，我先说一下这个想法。",
  "provider": "browser-local",
  "metadata": {
    "confidence": 0.91
  }
}
```

## 6. 助手配置契约

建议把当前语音配置拆成行为配置和画像配置。

### 6.1 保存助手语音配置

```json
{
  "speechConfig": {
    "behavior": {
      "enabled": true,
      "outputMode": "auto_final_only",
      "autoPlay": false
    },
    "profile": {
      "provider": "remote-tts",
      "voice": "assistant-female-1",
      "fallbackProvider": "browser-local",
      "speed": 1,
      "volume": 1,
      "pitch": 1,
      "emotion": "calm",
      "style": "conversational",
      "prompt": "语气自然，有陪伴感",
      "vendorOptions": null
    }
  }
}
```

### 6.2 兼容旧字段

过渡期可继续接受：

```json
{
  "voiceConfig": {
    "enabled": true,
    "outputMode": "manual",
    "voiceId": null,
    "speed": 1,
    "volume": 1,
    "autoPlay": false
  }
}
```

但内部应尽量映射为新的 `speechConfig.profile`。

## 7. 错误语义建议

建议统一使用语音域错误，而不是让每个 provider 自己散着报错。

可先约定：

- `SPEECH_PROVIDER_NOT_AVAILABLE`
- `SPEECH_TASK_NOT_SUPPORTED`
- `SPEECH_FALLBACK_EXHAUSTED`
- `SPEECH_AUDIO_UPLOAD_FAILED`
- `SPEECH_SYNTHESIS_FAILED`
- `SPEECH_TRANSCRIPTION_FAILED`
- `SPEECH_SESSION_FAILED`

## 8. 前后端并行边界

为了并行推进，建议边界如下：

- 前端先实现 `browser-local provider`
- 服务端先实现统一 `speech service` 契约与 `remote-tts` 接口占位
- 现有音频附件接口维持稳定
- 助手配置接口先兼容旧字段，再补新字段

## 9. 第一阶段不做的接口

第一阶段不建议上来做完整的：

- provider 管理 API
- 实时语音会话全量控制 API
- 音频流转发网关

先把统一请求/结果语义稳定下来更重要。
