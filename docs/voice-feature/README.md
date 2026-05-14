# 语音功能设计

本目录用于沉淀 TeamAgentX 语音能力的需求、设计与实施计划。

当前方案已从“先做语音消息一期”升级为“统一语音抽象层优先”。目标不是只补一个本地 TTS 或录音入口，而是先把语音能力从业务里抽出来，方便后续接入：

- 浏览器本地 TTS / STT
- 服务端远程 TTS / STT
- 未来语音大模型与实时语音会话

## 当前结论

- 语音能力必须成为独立 domain，不再散落在页面组件和浏览器 API 调用里。
- 第一阶段仍然保留现有可工作的语音消息链路，但要把它们收编进统一抽象。
- `browser-local` 与 `remote-*` provider 共存，上层业务只调用统一语义。
- 先定义完整语音能力边界：`tts`、`stt`、`realtime-chat`，但第一阶段只落稳定的 `tts + stt`。
- provider 注册机制第一版使用代码内置注册，不做动态配置平台。

## 文档列表

- [requirements.md](/Users/liqing/qing/code/team/teamagentx/docs/voice-feature/requirements.md)
  语音抽象层的产品目标、范围、约束与验收标准。
- [design.md](/Users/liqing/qing/code/team/teamagentx/docs/voice-feature/design.md)
  统一语音架构设计，覆盖 domain model、provider、router、前后端职责与阶段方案。
- [data-model.md](/Users/liqing/qing/code/team/teamagentx/docs/voice-feature/data-model.md)
  `SpeechProfile`、`SpeechTask`、`SpeechArtifact` 及数据库持久化策略。
- [api-contracts.md](/Users/liqing/qing/code/team/teamagentx/docs/voice-feature/api-contracts.md)
  语音抽象层的服务接口、消息契约与 provider 调用边界。
- [tasks.md](/Users/liqing/qing/code/team/teamagentx/docs/voice-feature/tasks.md)
  分阶段实施计划与任务拆解。

## 与旧方案的关系

- 旧方案关于 `audio attachment`、录音发送、音频播放的内容继续有效。
- 旧方案里“助手语音配置”将升级为更通用的 `speechProfile`，不再局限于浏览器朗读参数。
- 旧方案中“本地 TTS 后续再接”的思路调整为：先完成抽象，再把本地和远程能力都纳入同一套语义。
