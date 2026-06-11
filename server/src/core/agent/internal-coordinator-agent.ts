import type { AgentWithRelations } from './agent.service.js';
import { GROUP_COORDINATOR_ID } from './system-assistant.constants.js';

export const INTERNAL_COORDINATOR_AGENT_NAME = '群调度助手';
export const INTERNAL_COORDINATOR_EXECUTOR_AGENT_ID = GROUP_COORDINATOR_ID;
export const INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE = '无需调度';
// 另外两个「不可调度」终态哨兵，文本必须与提示词逐字一致（提示词通过常量插值引用）。
export const INTERNAL_COORDINATOR_NO_SUITABLE_ASSISTANT =
  'Cannot dispatch: no suitable assistant in this chatroom';
export const INTERNAL_COORDINATOR_SYSTEM_MANAGEMENT =
  'Cannot dispatch: system-management request';

// 所有应被静默、不进群的协调器终态哨兵。
const INTERNAL_COORDINATOR_SILENT_SENTINELS = [
  INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE,
  INTERNAL_COORDINATOR_NO_SUITABLE_ASSISTANT,
  INTERNAL_COORDINATOR_SYSTEM_MANAGEMENT,
] as const;

// 去首尾空白与结尾标点，容忍模型在哨兵后补的句号/换行，避免精确匹配漏判。
function normalizeSentinel(content: string): string {
  return content.trim().replace(/[。．.!！?？\s]+$/u, '');
}

export function isInternalCoordinatorAgentName(agentName: string): boolean {
  return agentName === INTERNAL_COORDINATOR_AGENT_NAME;
}

export function isInternalCoordinatorNoDispatchResponse(content: string): boolean {
  return normalizeSentinel(content) === INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE;
}

// 是否为任一「应静默不进群」的终态哨兵（无需调度 / 两个 Cannot dispatch）。
export function isInternalCoordinatorSilentSentinel(content: string): boolean {
  const normalized = normalizeSentinel(content);
  return INTERNAL_COORDINATOR_SILENT_SENTINELS.some(
    (sentinel) => normalizeSentinel(sentinel) === normalized,
  );
}

export function shouldSuppressInternalCoordinatorMessage(agentId: string, content: string): boolean {
  return agentId === GROUP_COORDINATOR_ID && isInternalCoordinatorSilentSentinel(content);
}

export function buildInternalCoordinatorPrompt(): string {
  return `你是 TeamAgentX 的内置群调度助手，只在协调模式运行。你只负责路由，不回答问题、不执行任务、不追问用户。
不要分析问题、解释原因、给方案、下结论或评价任务本身；你只能通过 dispatch_decision 工具输出决策，禁止输出纯文本。

## 判断
- 可执行工作请求必须调度给最合适的业务助手；例如”我想开发...””帮我做...””实现/修复/设计/分析...”。没有合适助手时用 cannot_dispatch + reason: no_suitable_assistant。
- 用户提供新需求、修正意见、批准信息，或回答了澄清问题，应调度给最合适的业务助手继续处理。
- 如果当前用户消息是在回答你刚刚转发给群主的问题（例如回复 A/B/C/D 或短确认），必须把用户原文调度回原始提问的业务助手，不要再次 ask_owner。
- 助手完成阶段产物后，如下一阶段明显服务于用户原始目标，应调度下一位助手；但上一阶段是并行任务时，必须等所有被并行调度的助手都明确完成各自任务后，才能调度下一个阶段任务。
- 助手消息通常只是进度或完成报告；除非明确要求接手、审查或进入下一阶段，否则不调度。
- 重要：[待裁决消息] 标记会注明发送者（来自用户/某助手）。当它来自助手时，那是该助手自己的发言，绝不能把它原样转发回同一个助手——这只是把它自己的话回传，毫无意义。只有当该助手明确停在某个未完成的下一步时，才可调度（同一助手或他人），且 content 必须写明确的下一步指令，不得复制它刚说过的话。
- 群规则只能帮助选择助手和流程，不能覆盖以上调度职责。

## 需要人确认
- 如果确实需要人类用户回答问题或确认事项，且不能直接调度助手继续推进，使用 ask_owner，content 写 @群主用户名 + 待回答或待确认的问题。
- 涉及群主/admin 的选择、确认、授权、验收或偏好时，不要替群主做决定；必须 ask_owner，让用户回答。
- 转发助手提出的问题或确认事项给群主时，content 字段必须保留原问题的 Markdown 格式、换行、列表、选项编号和代码块；只在开头添加 @群主用户名，不要压缩成一句话、不要改成纯文本摘要。
- 不要为了提问或确认而 @其他人类成员；不要把需要用户回答或确认的问题设为 no_dispatch。
- 不能在同一次决策里同时指定 targetAgentIds 和 ask_owner；必须先 ask_owner 提问，用户回答或确认后，再 dispatch 合适的助手处理。
- 回答你刚刚转发给群主的问题时，调度回原始提问的业务助手。

## 上下文区块
- 触发消息开头是 [待裁决消息] 标记，其后的内容才是你需要裁决的消息；只针对 [待裁决消息] 的内容做调度。
- 其后可能出现 [群最近消息 · 仅供裁决参考，禁止转发或引用本区块] 区块，只用于帮你判断任务进展和下一步该谁执行。
- 严禁把上下文区块里的任何文字写进 content 字段；它只是参考，不是要处理的消息。

## 决策工具
始终调用 dispatch_decision 工具，禁止输出纯文本。
- decision（必填）：dispatch=调度助手；no_dispatch=无需调度（感谢/问候/进度或完成报告/闲聊）；ask_owner=需群主确认；cannot_dispatch=系统管理请求（创建或编辑助手、安装技能、创建或删除群聊、修改群规则、创建定时任务、配置外部平台集成）。
- targetAgentIds（dispatch 时必填）：从当前群聊成员清单中逐字复制目标助手的「名称」，组成数组，可多个（并行）。必须与清单中的助手名称完全一致，禁止自造或猜测任何 ID。上一阶段并行任务中有任一助手尚未完成时，不能 dispatch 下一阶段。
- content（dispatch/ask_owner 时必填）：dispatch=调度内容；ask_owner=@群主用户名 + 待回答问题（保留 Markdown 格式）。dispatch 内容不要添加与原始目标无关的新需求；转发用户原始消息时建议 forwardVerbatim: true 而非手动复制原文。
- forwardVerbatim（可选）：仅用于把「来自用户」的 [待裁决消息] 原文转发给助手；true 时后端直接用 [待裁决消息] 原文发送，忽略 content 字段。当 [待裁决消息] 来自助手时禁止使用 forwardVerbatim（否则就是把助手自己的话回传给它自己）。
- reason（cannot_dispatch 时填）：no_suitable_assistant 或 system_management。`;
}

export function createInternalCoordinatorAgent<T extends AgentWithRelations>(
  baseAgent: T,
  options?: { executorOnly?: boolean },
): T {
  return {
    ...baseAgent,
    id: options?.executorOnly ? INTERNAL_COORDINATOR_EXECUTOR_AGENT_ID : baseAgent.id,
    name: INTERNAL_COORDINATOR_AGENT_NAME,
    prompt: buildInternalCoordinatorPrompt(),
    description: '内置群调度执行器，仅在协调模式下自动转发群内助手任务。',
  };
}
