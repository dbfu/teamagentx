# 技术方案设计：远程语音 API（TTS + STT 独立配置）

**Date**: 2026-05-18
**Requirements**: specs/remote-voice-api/requirements.md

---

## 1. 架构总览

```
前端 ChatInputArea                         服务端
  │                                          │
  ├── MediaRecorder 录音                     │
  │   └── 音频 Blob                         │
  │       └── POST /speech/stt ──────────► SpeechGateway
  │                                          │   ├── JWT 鉴权
  │                                          │   ├── 读取 agent.speechConfig.sttProfile
  │                                          │   └── SpeechService.execute(sttTask)
  │                                          │       └── openai-compatible-stt provider
  │                                          │           └── LlmProvider → /audio/transcriptions
  │◄── { text: "识别结果" } ────────────────┘
  │
  └── TTS（已有，保持不变）
      └── POST /speech/tts ──────────────► SpeechGateway
                                            └── openai-compatible-tts provider
                                                └── LlmProvider → /audio/speech

助手配置页 AssistantVoiceTab
  ├── TTS 配置区域（已有 profile 字段）
  └── STT 配置区域（新增 sttProfile 字段）
      └── 供应商 / 模型 / 语言
```

---

## 2. 数据模型变更

### 2.1 AgentSpeechConfig 扩展

**服务端** `server/src/modules/speech/speech-config.ts`：

```typescript
// 新增 sttProfile 字段
export type AgentSpeechConfig = {
  behavior: AgentSpeechBehaviorConfig;
  profile: SpeechProfile;        // TTS 配置（已有）
  sttProfile?: SpeechProfile | null;  // STT 配置（新增）
};
```

- 无 Prisma migration：`Agent.speechConfig` 字段是 JSON 字符串，新字段向后兼容
- 旧数据读取时 `sttProfile` 为 `undefined`，归一化为 `null`
- `normalizeAgentSpeechConfig` 中不为 `sttProfile` 填充默认值（保持 `null`，表示使用系统默认）

### 2.2 normalizeSpeechProviderId 扩展

**服务端 + 前端** 同时更新：

```typescript
function normalizeSpeechProviderId(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === 'remote-tts') return 'openai-compatible-tts';
  if (provider === 'edge-tts') return 'browser-local';  // 新增归一化规则
  return provider;
}
```

---

## 3. 服务端变更

### 3.1 新增：openai-compatible-stt Provider

新文件：`server/src/modules/speech/providers/remote-stt.provider.ts`

参考 `remote-tts.provider.ts` 结构，核心差异：

```typescript
export function createRemoteSttProvider(): SpeechProvider {
  return {
    id: 'openai-compatible-stt',
    runtime: 'server',
    capabilities: {
      provider: 'openai-compatible-stt',
      runtime: 'server',
      taskTypes: ['stt'],
    },
    async transcribe(task) {
      const { audioBuffer, mimeType } = task.input as { audioBuffer: Buffer; mimeType: string };
      const llmProvider = await resolveLlmProviderFromSttTask(task);

      if (llmProvider.apiProtocol !== 'openai') {
        throw new Error(`openai-compatible-stt 仅支持 openai 协议供应商`);
      }

      const endpoint = getTranscriptionsEndpoint(llmProvider.apiUrl);
      validateRemoteUrl(endpoint);  // 复用 TTS 的 URL 校验逻辑

      const model = task.profile?.model?.trim() || 'whisper-1';
      const language = (task.profile?.vendorOptions?.language as string) || undefined;

      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: mimeType }), 'audio.webm');
      form.append('model', model);
      if (language) form.append('language', language);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${llmProvider.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) { /* 错误处理 */ }

      const json = await response.json() as { text?: string };
      const text = json.text ?? '';

      return {
        kind: 'transcript',
        text,
        provider: 'openai-compatible-stt',
        model,
      } satisfies SpeechArtifact;
    },
  };
}
```

**LlmProvider 解析逻辑**（`resolveLlmProviderFromSttTask`）：

STT 的 provider 解析优先级与 TTS 一致：
1. `task.profile.vendorOptions.llmProviderId`（显式指定）
2. `task.context.agentId` → agent 的默认 llmProvider
3. 系统默认（`isActive = true, isDefault = true`）

**URL 构造**：

```typescript
function getTranscriptionsEndpoint(apiUrl?: string | null): string {
  const base = (apiUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (base.endsWith('/audio/transcriptions')) return base;
  return `${base}/audio/transcriptions`;
}
```

### 3.2 修改：default-service.ts

```typescript
// 移除 edge-tts，注册 remote-stt
import { createRemoteSttProvider } from './providers/remote-stt.provider.js';
import { createRemoteTtsProvider } from './providers/remote-tts.provider.js';

export const serverSpeechProviderRegistry = new SpeechProviderRegistry();
serverSpeechProviderRegistry.register(createRemoteTtsProvider());
// createEdgeTtsProvider() 移除
serverSpeechProviderRegistry.register(createRemoteSttProvider());  // 新增

export const serverSpeechService = new SpeechService(new SpeechRouter(serverSpeechProviderRegistry));
```

### 3.3 修改：speech.gateway.ts — 新增 /speech/stt

在现有 `createSpeechGateway` 函数中注册新路由：

```
POST /speech/stt
Content-Type: multipart/form-data
Authorization: Bearer <JWT>

Fields:
  file     (required) - 音频文件
  agentId  (optional) - 用于查找 sttProfile
  language (optional) - BCP-47 语言码

Response 200:
  { "text": "识别结果", "provider": "openai-compatible-stt" }
  Header: X-Speech-Provider: openai-compatible-stt

Error codes:
  400 - 缺少文件 / 文件超限（25MB）
  401 - 未鉴权
  502 - STT 服务调用失败
```

**网关核心逻辑**：

```typescript
// 1. 注册 multipart（与 upload.gateway.ts 相同模式）
await app.register(import('@fastify/multipart'), {
  limits: { fileSize: 25 * 1024 * 1024 }
});

// 2. POST /speech/stt 路由
app.post('/speech/stt', { preHandler: requireAuth }, async (req, reply) => {
  const parts = req.parts();
  let audioBuffer: Buffer | null = null;
  let mimeType = 'audio/webm';
  let agentId: string | undefined;
  let language: string | undefined;

  for await (const part of parts) {
    if (part.type === 'file' && part.fieldname === 'file') {
      audioBuffer = await part.toBuffer();
      mimeType = part.mimetype || 'audio/webm';
    } else if (part.type === 'field') {
      if (part.fieldname === 'agentId') agentId = part.value as string;
      if (part.fieldname === 'language') language = part.value as string;
    }
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    return reply.code(400).send({ error: '缺少音频文件' });
  }
  if (audioBuffer.length > 25 * 1024 * 1024) {
    return reply.code(400).send({ error: '音频文件不得超过 25MB' });
  }

  // 从 DB 读取 agent 的 sttProfile（若有 agentId）
  let sttProfile = null;
  if (agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (agent?.speechConfig) {
      const config = deserializeAgentSpeechConfig(agent.speechConfig);
      sttProfile = config?.sttProfile ?? null;
    }
  }

  const task: SpeechTask = {
    type: 'stt',
    input: { audioBuffer, mimeType },
    profile: {
      ...sttProfile,
      provider: 'openai-compatible-stt',
      vendorOptions: {
        ...sttProfile?.vendorOptions,
        ...(language ? { language } : {}),
      },
    },
    context: { agentId },
  };

  const result = await dependencies.execute(task);
  if (!('text' in result) || result.kind !== 'transcript') {
    return reply.code(502).send({ error: '语音识别服务返回格式无效' });
  }

  reply.header('X-Speech-Provider', result.provider);
  return { text: result.text ?? '', provider: result.provider };
});
```

### 3.4 修改：speech-presets.ts

- 移除 `edge-xiaoxiao`、`edge-xiaoyi`、`edge-yunxi` 预设
- 更新 `SpeechPresetId` 类型

```typescript
export type SpeechPresetId =
  | 'system-default'
  | 'gentle-guide'
  | 'steady-pro'
  | 'bright-host';
  // edge-* 预设删除

export const SPEECH_PRESETS: SpeechPresetDefinition[] = [
  // 仅保留 4 个 browser-local 预设
];
```

---

## 4. 前端变更

### 4.1 修改：chat-input-area.tsx — 录音改用 MediaRecorder

**移除依赖**：
```typescript
// 删除这两行
import { startBrowserSpeechRecognition, supportsBrowserSpeechRecognition } from '@/lib/browser-speech'
```

**新增状态和 ref**：
```typescript
const mediaRecorderRef = useRef<MediaRecorder | null>(null)
const audioChunksRef = useRef<Blob[]>([])
const mediaStreamRef = useRef<MediaStream | null>(null)
```

**新录音逻辑**：
```typescript
const handleAudioButtonClick = async () => {
  // 停止录音
  if (isRecording) {
    mediaRecorderRef.current?.stop()
    return
  }

  // 启动录音
  if (!window.MediaRecorder) {
    toast.error('当前浏览器不支持录音')
    return
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    toast.error('请允许麦克风权限后重试')
    return
  }

  mediaStreamRef.current = stream
  audioChunksRef.current = []
  const recorder = new MediaRecorder(stream)
  mediaRecorderRef.current = recorder

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunksRef.current.push(e.data)
  }

  recorder.onstop = async () => {
    // 停止媒体流
    mediaStreamRef.current?.getTracks().forEach(t => t.stop())
    mediaStreamRef.current = null

    const chunks = audioChunksRef.current
    audioChunksRef.current = []

    // 时长过短忽略（通过 Blob 大小粗判）
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    if (blob.size < 1000) return  // < 1KB 认为是噪音/误触

    setIsProcessing(true)
    try {
      const text = await transcribeAudio(blob)
      if (text.trim()) {
        const current = useChatStore.getState().inputValue
        setInputValue(current ? `${current} ${text}` : text)
      } else {
        toast.info('未识别到语音内容，请重试')
      }
    } catch {
      toast.error('语音识别失败，请稍后重试')
    } finally {
      setIsProcessing(false)
    }
  }

  recorder.start()
  setIsRecording(true)
}
```

**新增 `transcribeAudio` 工具函数**（内联在文件内或抽到 `lib/stt-api.ts`）：

```typescript
async function transcribeAudio(blob: Blob): Promise<string> {
  const token = getAuthToken()  // 从 auth store 或 localStorage 取
  const form = new FormData()
  form.append('file', blob, 'recording.webm')

  const response = await fetch('/api/speech/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  if (!response.ok) {
    throw new Error('语音识别请求失败')
  }

  const json = await response.json() as { text?: string }
  return json.text ?? ''
}
```

### 4.2 修改：agent-speech.ts — 移除 edge-* 预设 + 支持 sttProfile

**移除 edge-* 预设**：
```typescript
// 删除 edge-xiaoxiao / edge-xiaoyi / edge-yunxi 三个条目
export type AgentVoicePresetId =
  | 'system-default'
  | 'gentle-guide'
  | 'steady-pro'
  | 'bright-host';
```

**更新 normalizeSpeechProviderId**：
```typescript
function normalizeSpeechProviderId(provider?: string | null): string | null {
  if (!provider) return null;
  if (provider === 'remote-tts') return 'openai-compatible-tts';
  if (provider === 'edge-tts') return 'browser-local';  // 新增
  return provider;
}
```

**新增 STT 相关类型和函数**：
```typescript
export type AgentSttPanelConfig = {
  sttProvider: string | null           // 'openai-compatible-stt' 或 null
  sttModel: string | null              // 如 'SenseVoiceSmall'
  sttLlmProviderId: string | null      // LlmProvider ID
  sttLanguage: string | null           // BCP-47
}

export function toSttPanelConfig(config?: AgentSpeechConfig | null): AgentSttPanelConfig {
  const sttProfile = config?.sttProfile;
  return {
    sttProvider: sttProfile?.provider ?? null,
    sttModel: sttProfile?.model ?? null,
    sttLlmProviderId: (sttProfile?.vendorOptions?.llmProviderId as string) ?? null,
    sttLanguage: (sttProfile?.vendorOptions?.language as string) ?? null,
  };
}

export function fromSttPanelConfig(sttConfig: AgentSttPanelConfig): SpeechProfile | null {
  if (!sttConfig.sttLlmProviderId && !sttConfig.sttProvider) return null;
  return {
    provider: sttConfig.sttProvider ?? 'openai-compatible-stt',
    model: sttConfig.sttModel?.trim() || null,
    vendorOptions: {
      ...(sttConfig.sttLlmProviderId ? { llmProviderId: sttConfig.sttLlmProviderId } : {}),
      ...(sttConfig.sttLanguage ? { language: sttConfig.sttLanguage } : {}),
    },
  };
}
```

### 4.3 修改：speech/default-service.ts（前端）

```typescript
// 移除 edge-tts 注册
webSpeechProviderRegistry.register(createBrowserLocalSpeechProvider())
webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider())  // openai-compatible-tts
// 删除: webSpeechProviderRegistry.register(createRemoteTtsSpeechProvider({ providerId: 'edge-tts' }))
```

### 4.4 修改：assistant-voice-tab.tsx — 新增 STT 配置区域

在现有 TTS 配置区域下方，新增独立的 STT 配置区域：

```tsx
{/* STT 语音输入配置 */}
<div className="rounded-xl border border-border bg-card">
  <div className="border-b border-border px-5 py-4">
    <div className="flex items-center gap-2">
      <Mic className="size-4 text-primary" />
      <h4 className="font-medium text-foreground">语音输入配置（STT）</h4>
    </div>
    <p className="mt-1 text-sm text-muted-foreground">
      配置助手聊天室的语音输入供应商。留空则使用系统默认供应商。
    </p>
  </div>
  <div className="space-y-4 p-5">
    {/* 供应商选择 */}
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        STT 供应商（LlmProvider）
      </label>
      <select
        value={sttConfig.sttLlmProviderId ?? ''}
        onChange={(e) => setSttConfig(prev => ({ ...prev, sttLlmProviderId: e.target.value || null }))}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm ..."
      >
        <option value="">使用系统默认</option>
        {openaiProviders.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
    {/* STT 模型 */}
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">模型（可选）</label>
      <input
        value={sttConfig.sttModel ?? ''}
        onChange={(e) => setSttConfig(prev => ({ ...prev, sttModel: e.target.value || null }))}
        placeholder="如 SenseVoiceSmall（留空使用供应商默认）"
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm ..."
      />
    </div>
  </div>
</div>
```

---

## 5. 接口契约

### POST /speech/stt

```
Request:
  Authorization: Bearer <JWT>
  Content-Type: multipart/form-data

  Fields:
    file      (binary, required)  音频文件，≤25MB，支持 webm/wav/mp3/mp4
    agentId   (string, optional)  助手 ID，用于查找 sttProfile
    language  (string, optional)  BCP-47 语言码，如 zh，覆盖 sttProfile 中的 language

Response 200:
  Content-Type: application/json
  X-Speech-Provider: openai-compatible-stt
  { "text": "识别结果文本", "provider": "openai-compatible-stt" }

Error 400: { "error": "缺少音频文件" | "音频文件不得超过 25MB" }
Error 401: { "success": false, "error": "Unauthorized" }
Error 502: { "error": "语音识别服务不可用" }
```

---

## 6. 供应商配置示例（SiliconFlow）

用户在系统供应商配置中添加：
```
名称: SiliconFlow
协议: openai
API URL: https://api.siliconflow.cn/v1
API Key: sk-xxx
```

助手 STT 配置选择该 Provider + 模型 `SenseVoiceSmall`：

```json
{
  "sttProfile": {
    "provider": "openai-compatible-stt",
    "model": "SenseVoiceSmall",
    "vendorOptions": {
      "llmProviderId": "<siliconflow-provider-id>"
    }
  }
}
```

对应 STT 调用：
```
POST https://api.siliconflow.cn/v1/audio/transcriptions
Authorization: Bearer sk-xxx
Content-Type: multipart/form-data
model=SenseVoiceSmall, file=<audio>
```

---

## 7. 迁移策略

### edge-tts 历史数据

`normalizeSpeechProviderId('edge-tts') → 'browser-local'` 在前后端均生效，确保：

- 读取旧 `profile.provider = 'edge-tts'` → 归一化为 `'browser-local'`
- 旧 edge-* 预设选项从 UI 预设列表中移除（但历史已选的助手不报错）
- SpeechRouter 在路由时找不到 `edge-tts` provider 也不崩溃（归一化在读取时已处理）

### browser-local STT

`browser-local-provider.ts` 保留不动（包含 TTS + 旧 STT），但 `chat-input-area.tsx` 中的录音流程不再调用它，改为 MediaRecorder + /speech/stt 路径。

---

## 8. 不在本次范围

- 流式实时 STT（WebSocket）
- 移动端录音
- TTS 结果缓存
- 供应商健康监控
