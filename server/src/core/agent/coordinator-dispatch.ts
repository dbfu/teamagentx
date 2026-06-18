import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LlmProvider } from '@prisma/client';
import { config } from '../../config/index.js';
import { parseFallbackLlmProviderIds, type AgentWithRelations } from './agent.service.js';
import { chatRoomService } from '../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../modules/message/message.service.js';
import { agentService } from './agent.service.js';
import { llmProviderService } from '../../modules/llm-provider/llm-provider.service.js';
import { workbenchTaskService } from '../../modules/workbench/workbench.service.js';
import { taskQueueService } from '../../modules/task-queue/task-queue.service.js';
import { coordinatorLogService } from '../../modules/coordinator-log/coordinator-log.service.js';
import {
  buildInternalCoordinatorPrompt,
  INTERNAL_COORDINATOR_AGENT_NAME,
} from './internal-coordinator-agent.js';
import { GROUP_COORDINATOR_ID } from './system-assistant.constants.js';
import {
  buildCoordinatorLayeredContext,
  coordinatorPendingDecisionLabel,
  withCoordinatorContext,
} from './agent-handler/coordinator-context.js';
import { pickLocaleText, type Locale, normalizeLocale } from './agent-handler/locale.js';
import { enqueueAgentTask } from './agent-handler/agent-dispatch.service.js';
import { startParallelBatch } from './agent-handler/parallel-batch-tracker.js';
import {
  startSerialChain,
  advanceSerialChain,
  bindSerialTask,
  clearSerialChainForTask,
  clearSerialChain,
  skipUnboundSerialAgent,
} from './agent-handler/serial-chain-tracker.js';
import type { AgentTaskOutcome } from './agent-handler/task-lifecycle.js';
import {
  globalEmit,
  globalBroadcastMessage,
  globalEmitTyping,
  globalEmitDone,
} from './agent-handler/status.js';
import { buildAIMessage } from './agent-handler/message-utils.js';
import type { Message } from '../../types/message.js';
import { debugLog } from './agent-handler/debug.js';
import {
  markTaskWithoutAssistantHandoff,
  parseTaskPromptPolicy,
} from './task-prompt-policy.js';

export interface DispatchAssignment {
  targetAgentName: string;
  content: string;
  forwardVerbatim?: boolean;
}

export interface DispatchDecision {
  decision: 'dispatch' | 'no_dispatch' | 'ask_owner' | 'cannot_dispatch';
  assignments?: DispatchAssignment[];
  /** @deprecated 兼容旧版协调器输出；新输出使用 assignments。 */
  targetAgentIds?: string[];
  /** ask_owner 的问题内容；dispatch 时仅用于兼容旧版协调器输出。 */
  content?: string;
  /** @deprecated 兼容旧版协调器输出；新输出使用 assignment.forwardVerbatim。 */
  forwardVerbatim?: boolean;
  /** 多个任务时的执行方式：parallel=同时并行（默认）；serial=按 assignments 顺序逐个执行。 */
  dispatchMode?: 'parallel' | 'serial';
  reason?: 'no_suitable_assistant' | 'system_management';
}

export interface CoordinatorDispatchOptions {
  /** 中止信号：用于在自由协作（auto）模式卡住检测自动调度途中，被用户发言打断时取消本次调度。 */
  signal?: AbortSignal;
  /** 本次调度实际派发的目标助手 id 回调（含尚未执行的排队任务），供调用方在用户介入时一并停掉。 */
  onAgentsDispatched?: (agentIds: string[]) => void;
  /** 协调器介入原因；用于对特定入口施加更严格的路由约束。 */
  routingReason?: string;
  /** 协调器未能产出或执行决策时回调，供调用方重新安排恢复。用户主动中止不触发。 */
  onFailure?: (
    reason: 'provider_unavailable' | 'llm_error' | 'empty_decision' | 'execution_error',
    error?: unknown,
  ) => void;
}

const DISPATCH_TOOL_NAME = 'dispatch_decision';

interface DispatchToolConstraints {
  maxAssignments?: number;
  forbidNoSuitableAssistant?: boolean;
  allowedDecisions?: DispatchDecision['decision'][];
  requireAssignments?: boolean;
}

type CoordinatorProviderRole = 'primary' | 'fallback';

interface CoordinatorProviderCandidate {
  provider: LlmProvider;
  role: CoordinatorProviderRole;
}

function getDispatchToolDescription(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN': '协调决策工具：输出调度决策（dispatch/no_dispatch/ask_owner/cannot_dispatch）。',
      'en-US':
        'Coordination decision tool: output a dispatch decision (dispatch/no_dispatch/ask_owner/cannot_dispatch).',
    },
    locale,
  );
}

function getDispatchToolParameters(
  locale?: string,
  constraints?: DispatchToolConstraints,
) {
  const pendingMarker = coordinatorPendingDecisionLabel(locale);
  return {
    type: 'object' as const,
    properties: {
      decision: {
        type: 'string',
        enum: constraints?.allowedDecisions ??
          ['dispatch', 'no_dispatch', 'ask_owner', 'cannot_dispatch'],
        description: pickLocaleText(
          {
            'zh-CN': '决策类型：dispatch=调度助手；no_dispatch=无需调度；ask_owner=需群主确认；cannot_dispatch=系统管理请求',
            'en-US':
              'Decision type: dispatch = dispatch an assistant; no_dispatch = no dispatch needed; ask_owner = owner confirmation needed; cannot_dispatch = system-management request',
          },
          locale,
        ),
      },
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            targetAgentName: {
              type: 'string',
              description: pickLocaleText(
                {
                  'zh-CN': '目标助手名称，必须与当前群聊成员清单完全一致',
                  'en-US':
                    'Target assistant name; it must exactly match the current chatroom member list',
                },
                locale,
              ),
            },
            content: {
              type: 'string',
              description: pickLocaleText(
                {
                  'zh-CN': '只分配给该助手的独立、可直接执行的任务，不要包含 @助手名称',
                  'en-US':
                    'A standalone actionable task assigned only to this assistant; do not include an @mention',
                },
                locale,
              ),
            },
            forwardVerbatim: {
              type: 'boolean',
              description: pickLocaleText(
                {
                  'zh-CN': `仅单助手且需原样转发用户消息时设为 true；后端将使用 [${pendingMarker}] 原文并忽略 content`,
                  'en-US':
                    `Set true only for a single assistant when the user's message must be forwarded verbatim; the backend uses the [${pendingMarker}] original text and ignores content`,
                },
                locale,
              ),
            },
          },
          required: ['targetAgentName', 'content'],
        },
        minItems: 1,
        ...(constraints?.maxAssignments
          ? { maxItems: constraints.maxAssignments }
          : {}),
        description: pickLocaleText(
          {
            'zh-CN': 'dispatch 时必填：逐助手任务列表。每个助手都有独立任务；dispatchMode=serial 时数组顺序即执行顺序',
            'en-US':
              'Required for dispatch: per-assistant task assignments. Every assistant has an independent task; for dispatchMode=serial, array order is execution order',
          },
          locale,
        ),
      },
      dispatchMode: {
        type: 'string',
        enum: ['parallel', 'serial'],
        description: pickLocaleText(
          {
            'zh-CN': '多个任务时的执行方式：parallel=同时并行（默认）；serial=按 assignments 顺序逐个执行，前一个完成后再派下一个。用户表达「依次/按顺序/逐个/轮流/先…再…」或后续任务依赖前序产出时用 serial。单个任务时忽略本字段',
            'en-US':
              'Execution mode for multiple tasks: parallel = run simultaneously (default); serial = run one by one in assignments order, dispatching the next only after the previous finishes. Use serial when requested or when later tasks depend on earlier output. Ignored for a single task',
          },
          locale,
        ),
      },
      content: {
        type: 'string',
        description: pickLocaleText(
          {
            'zh-CN': '仅 ask_owner 时使用：@群主用户名 + 问题（保留 Markdown）',
            'en-US':
              'Used only for ask_owner: @owner_username + question (preserve Markdown)',
          },
          locale,
        ),
      },
      reason: {
        type: 'string',
        enum: constraints?.forbidNoSuitableAssistant
          ? ['system_management']
          : ['no_suitable_assistant', 'system_management'],
        description: pickLocaleText(
          {
            'zh-CN': 'cannot_dispatch 时的原因',
            'en-US': 'Reason when cannot_dispatch',
          },
          locale,
        ),
      },
    },
    required: constraints?.requireAssignments
      ? ['decision', 'assignments']
      : ['decision'],
  };
}

function getCoordinatorRequiredProtocol(coordinatorAgent: AgentWithRelations): 'anthropic' | 'openai' {
  const requiredProtocol: 'anthropic' | 'openai' =
    (coordinatorAgent as any).acpTool === 'codex' ? 'openai' : 'anthropic';
  return requiredProtocol;
}

function canUseCoordinatorProvider(
  provider: LlmProvider | null | undefined,
  requiredProtocol: 'anthropic' | 'openai',
): provider is LlmProvider {
  if (!provider) return false;
  if (((provider as any).modelType || 'text') !== 'text') return false;
  return ((provider as any).apiProtocol ?? 'anthropic') === requiredProtocol;
}

export async function findCoordinatorProviders(
  coordinatorAgent: AgentWithRelations,
): Promise<CoordinatorProviderCandidate[]> {
  const requiredProtocol = getCoordinatorRequiredProtocol(coordinatorAgent);
  const candidates: CoordinatorProviderCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (provider: LlmProvider | null | undefined, role: CoordinatorProviderRole) => {
    if (!canUseCoordinatorProvider(provider, requiredProtocol)) return;
    if (seen.has(provider.id)) return;
    seen.add(provider.id);
    candidates.push({ provider, role });
  };

  addCandidate(coordinatorAgent.llmProvider, 'primary');

  const fallbackIds = parseFallbackLlmProviderIds((coordinatorAgent as any).fallbackLlmProviderIds);
  if (fallbackIds.length > 0) {
    const activeProviders = await llmProviderService.findActive('text');
    const activeProviderById = new Map(activeProviders.map((provider) => [provider.id, provider]));
    for (const providerId of fallbackIds) {
      addCandidate(activeProviderById.get(providerId), 'fallback');
    }
  }

  if (candidates.length > 0) return candidates;

  const defaultProvider = await llmProviderService.findDefault('text');
  addCandidate(defaultProvider, 'primary');
  if (candidates.length > 0) return candidates;

  const active = await llmProviderService.findActive('text');
  addCandidate(active.find((p) => ((p as any).apiProtocol ?? 'anthropic') === requiredProtocol), 'primary');
  return candidates;
}

function createCoordinatorAttemptSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
  attempt: number,
): { signal?: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  if (!parentSignal && timeoutMs <= 0) {
    return { signal: undefined, cleanup: () => {}, timedOut: () => false };
  }

  const controller = new AbortController();
  let didTimeout = false;
  let timer: NodeJS.Timeout | null = null;

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new Error('Coordinator LLM call aborted'));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error(`${label} timed out after ${timeoutMs}ms on attempt ${attempt}`));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    },
    timedOut: () => didTimeout,
  };
}

async function sleepForCoordinatorRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw signal.reason ?? new Error('Coordinator LLM retry aborted');

  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      reject(signal?.reason ?? new Error('Coordinator LLM retry aborted'));
    };
    const done = () => {
      if (signal) signal.removeEventListener('abort', abort);
      resolve();
    };

    const timer = setTimeout(done, ms);
    if (typeof timer.unref === 'function') timer.unref();

    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}

async function callCoordinatorLlmWithRetry<T>(
  label: string,
  signal: AbortSignal | undefined,
  operation: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = Number.isFinite(config.agent.coordinatorLlmTimeoutMs)
    ? Math.max(0, config.agent.coordinatorLlmTimeoutMs)
    : 60_000;
  const retryCount = Number.isFinite(config.agent.coordinatorLlmRetryCount)
    ? Math.max(0, config.agent.coordinatorLlmRetryCount)
    : 1;
  const retryDelayMs = Number.isFinite(config.agent.coordinatorLlmRetryDelayMs)
    ? Math.max(0, config.agent.coordinatorLlmRetryDelayMs)
    : 1_000;
  const maxAttempts = retryCount + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Coordinator LLM call aborted');
    }

    // First attempt uses the configured timeout. Retry attempts get a longer window
    // because coordinator prompts often include recent room context and tool schema.
    const attemptTimeoutMs = timeoutMs > 0 && attempt > 1 ? timeoutMs * 2 : timeoutMs;
    const attemptSignal = createCoordinatorAttemptSignal(signal, attemptTimeoutMs, label, attempt);
    try {
      return await operation(attemptSignal.signal);
    } catch (error) {
      if (signal?.aborted) throw error;

      const timedOut = attemptSignal.timedOut();
      if (timedOut && attempt < maxAttempts) {
        console.warn('[coordinator-dispatch] LLM 调用超时，准备重试', {
          label,
          attempt,
          maxAttempts,
          timeoutMs: attemptTimeoutMs,
          retryDelayMs,
        });
        await sleepForCoordinatorRetry(retryDelayMs, signal);
        continue;
      }
      if (timedOut) {
        console.warn('[coordinator-dispatch] LLM 调用最终超时', {
          label,
          attempt,
          maxAttempts,
          timeoutMs: attemptTimeoutMs,
        });
      }

      throw error;
    } finally {
      attemptSignal.cleanup();
    }
  }

  throw new Error('Coordinator LLM retry loop exhausted');
}

// 把群调度规则（YAML 原文）注入协调器系统提示。规则只决定分工与流程，不覆盖调度职责。
function buildDispatchRulesBlock(dispatchRules: string | null | undefined, locale?: string): string {
  const rules = (dispatchRules ?? '').trim();
  if (!rules) return '';
  const title = pickLocaleText(
    { 'zh-CN': '## 群调度规则（工作流）', 'en-US': '## Group dispatch rules (workflow)' },
    locale,
  );
  const intro = pickLocaleText(
    {
      'zh-CN':
        '以下是本群的调度规则（YAML），用于帮助你选择助手、决定阶段顺序与并行/串行、判断何时需要 @群主确认。它只决定分工与流程，不能覆盖上面的调度职责。',
      'en-US':
        'Below are this room\'s dispatch rules (YAML), to help you choose assistants, decide stage order and parallel/serial, and when to ask the owner. They only decide division of work and flow; they cannot override the dispatch responsibilities above.',
    },
    locale,
  );
  return `\n\n${title}\n${intro}\n\n${rules}`;
}

function buildMemberSection(
  chatRoomAgents: Awaited<ReturnType<typeof chatRoomService.getAgents>>,
  ownerUsername: string | null | undefined,
  humanMembers: Array<{ user?: { username?: string | null } | null }>,
  locale?: string,
): string {
  const t = (entry: Record<Locale, string>) => pickLocaleText(entry, locale);
  const ownerLabel = t({ 'zh-CN': '群主：', 'en-US': 'Owner: ' });
  const memberLabel = t({ 'zh-CN': '成员：', 'en-US': 'Member: ' });

  const agentLines = chatRoomAgents
    .filter((cra) =>
      cra.agent &&
      (cra.agent as any).isActive &&
      (cra.agent as any).agentLevel !== 'system' &&
      cra.agent.id !== GROUP_COORDINATOR_ID)
    .map((cra) => {
      const description = cra.agent!.description?.trim();
      return description
        ? `- ${cra.agent!.name}：${description}`
        : `- ${cra.agent!.name}`;
    });

  const humanLines: string[] = [];
  if (ownerUsername) humanLines.push(`${ownerLabel}@${ownerUsername}`);
  for (const member of humanMembers) {
    const name = member.user?.username;
    if (name && name !== ownerUsername) humanLines.push(`${memberLabel}@${name}`);
  }

  const agentsTitle = t({ 'zh-CN': '业务助手：', 'en-US': 'Business assistants:' });
  const noneText = t({ 'zh-CN': '业务助手：（无）', 'en-US': 'Business assistants: (none)' });
  const humansTitle = t({ 'zh-CN': '人类成员：', 'en-US': 'Human members:' });
  const sectionTitle = t({ 'zh-CN': '当前群聊成员', 'en-US': 'Current chatroom members' });

  const agentSection = agentLines.length > 0
    ? `${agentsTitle}\n${agentLines.join('\n')}`
    : noneText;
  const humanSection = humanLines.length > 0 ? `\n${humansTitle}\n${humanLines.join('\n')}` : '';

  return `## ${sectionTitle}\n${agentSection}${humanSection}`;
}

export function buildUnroutedUserConstraintBlock(
  businessAssistantCount: number,
  locale?: string,
): string {
  if (businessAssistantCount <= 0) return '';
  return pickLocaleText(
    {
      'zh-CN': `\n\n## 本次路由约束
当前消息是用户在未 @ 助手、且没有可用默认助手时发送的消息。
- 必须根据业务助手的名称、描述和群调度规则，选择相关度最高的一个助手处理该消息。
- 只允许 dispatch，并生成一个 assignment；禁止 no_dispatch、ask_owner、cannot_dispatch 和并行拆分。
- 即使没有完全匹配的助手，也选择职责最接近的一位。
- 使用 forwardVerbatim: true 原样转发用户请求。`,
      'en-US': `\n\n## Routing constraint for this request
This message was sent by a user without an @mention and no usable default assistant was available.
- You must select exactly one assistant with the highest relevance based on assistant names, descriptions, and group dispatch rules.
- Only dispatch is allowed, with exactly one assignment; no_dispatch, ask_owner, cannot_dispatch, and parallel splitting are forbidden.
- Choose the closest available responsibility even without a perfect match.
- Use forwardVerbatim: true to forward the user's request verbatim.`,
    },
    locale,
  );
}

/**
 * 用户显式 @ 了多个助手时的路由约束。
 * 用户的 @ 已是明确的派发意图，协调器不得用 no_dispatch / ask_owner / cannot_dispatch
 * 把请求吞掉（例如把「@A @B 你好」当成问候而不调度）。协调器此时只决定：
 * 派给被 @ 的那些助手、并行还是串行、以及每个助手的子任务内容。
 */
export function buildExplicitMentionConstraintBlock(locale?: string): string {
  return pickLocaleText(
    {
      'zh-CN': `\n\n## 本次路由约束
当前消息是用户显式 @ 了多个助手的消息，这是明确的派发意图。
- 必须 dispatch，并为每个被 @ 的助手生成一个 assignment；禁止 no_dispatch、ask_owner、cannot_dispatch。
- 只在被用户 @ 到的助手范围内调度，不要新增或漏掉助手。
- 即使消息只是问候 / 寒暄（如「你好」），也必须把它派发给被 @ 的助手，由助手自行回应。
- 按 @助手 切分用户消息，逐字提取每个助手对应的正文，禁止改写、概括、翻译、扩写或补充任何额外说明：
  · 每个被 @ 的助手，其 content = 紧跟在 @它 之后、到下一个 @助手 之前的那段原文；
  · 若多个助手连续 @ 在一起、后面只跟同一句话（如「@正方辩手 @反方辩手 你好」），则它们共享这句话，content 都填「你好」；
  · 若各助手后各自带正文（如「@甲 分析数据 @乙 写总结」），则甲的 content 填「分析数据」、乙的填「写总结」，互不混入。
- 仅决定执行方式：dispatchMode=serial（用户表达「依次/按顺序/逐个/先…再…」或后续依赖前序产出时）或 parallel（默认）。`,
      'en-US': `\n\n## Routing constraint for this request
This message explicitly @mentions multiple assistants, which is an unambiguous dispatch intent.
- You must dispatch, with one assignment per @mentioned assistant; no_dispatch, ask_owner, and cannot_dispatch are forbidden.
- Only dispatch within the set of assistants the user @mentioned; do not add or drop assistants.
- Even if the message is just a greeting / small talk (e.g. "hello"), you must still dispatch it to the @mentioned assistants and let them respond.
- Split the user's message by its @assistant mentions and extract each assistant's text verbatim; do not rewrite, summarize, translate, expand, or add any extra wording:
  · For each @mentioned assistant, its content = the text right after @it up to the next @assistant.
  · If several assistants are @mentioned consecutively followed by a single shared sentence (e.g. "@ProDebater @ConDebater hello"), they share it and both contents are "hello".
  · If each assistant is followed by its own text (e.g. "@Alice analyze the data @Bob write the summary"), Alice's content is "analyze the data" and Bob's is "write the summary", with no cross-mixing.
- Only decide the execution mode: dispatchMode=serial (when the user asks for one-by-one/sequential order or later tasks depend on earlier output) or parallel (default).`,
    },
    locale,
  );
}

async function callAnthropicCoordinator(
  provider: LlmProvider,
  systemPrompt: string,
  memberSection: string,
  userContent: string,
  locale?: string,
  constraints?: DispatchToolConstraints,
  signal?: AbortSignal,
): Promise<DispatchDecision | null> {
  const client = new Anthropic({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: Anthropic.Messages.Tool = {
    name: DISPATCH_TOOL_NAME,
    description: getDispatchToolDescription(locale),
    input_schema: getDispatchToolParameters(locale, constraints) as Anthropic.Messages.Tool['input_schema'],
  };

  const request: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: provider.model,
    max_tokens: 512,
    temperature: 0,
    system: [
      { type: 'text', text: systemPrompt },
      { type: 'text', text: memberSection, cache_control: { type: 'ephemeral' } },
    ] as Anthropic.Messages.TextBlockParam[],
    messages: [{ role: 'user', content: userContent }],
    tools: [tool],
  };

  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      ...request,
      tool_choice: { type: 'any' },
    }, { signal });
  } catch (error) {
    if (!isAnthropicToolChoiceCompatibilityError(error)) {
      throw error;
    }
    console.warn('[coordinator-dispatch] 当前 Anthropic 兼容模型不支持强制 tool_choice，降级为自动工具选择', {
      providerId: provider.id,
      providerName: (provider as any).name,
      model: provider.model,
    });
    response = await client.messages.create(request, { signal });
  }

  const toolUse = response.content.find(
    (c): c is Anthropic.Messages.ToolUseBlock =>
      c.type === 'tool_use' && c.name === DISPATCH_TOOL_NAME,
  );
  return toolUse ? (toolUse.input as DispatchDecision) : null;
}

export function isAnthropicToolChoiceCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error);
  const normalized = message.toLowerCase();
  return normalized.includes('tool_choice') &&
    (
      normalized.includes('thinking mode') ||
      normalized.includes('does not support') ||
      normalized.includes('required or object')
    );
}

async function callOpenAICoordinator(
  provider: LlmProvider,
  systemPrompt: string,
  memberSection: string,
  userContent: string,
  locale?: string,
  constraints?: DispatchToolConstraints,
  signal?: AbortSignal,
): Promise<DispatchDecision | null> {
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: (provider as any).apiUrl || undefined,
  });

  const tool: OpenAI.Chat.Completions.ChatCompletionTool = {
    type: 'function',
    function: {
      name: DISPATCH_TOOL_NAME,
      description: getDispatchToolDescription(locale),
      parameters: getDispatchToolParameters(locale, constraints),
    },
  };

  const response = await client.chat.completions.create({
    model: provider.model,
    max_tokens: 512,
    temperature: 0,
    messages: [
      { role: 'system', content: `${systemPrompt}\n\n${memberSection}` },
      { role: 'user', content: userContent },
    ],
    tools: [tool],
    tool_choice: { type: 'function', function: { name: DISPATCH_TOOL_NAME } },
  }, { signal });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (response.choices[0]?.message?.tool_calls?.[0] as any)?.function?.arguments as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DispatchDecision;
  } catch {
    console.error('[coordinator-dispatch] JSON parse failed:', raw);
    return null;
  }
}

/**
 * 仅当群内确实没有进行中的任务（无 pending/executing 队列任务）时，
 * 才把该群「已派发 / 执行中」的工作台任务流转为 waiting_review（待确认）。
 * 与非协调模式（processor.ts finally 中的逻辑）保持一致，避免协调器在助手执行途中
 * 因中间消息触发 no_dispatch / ask_owner 而提前将任务标记为待确认。
 */
async function syncWorkbenchOnRoomIdle(chatRoomId: string): Promise<void> {
  try {
    const activeTasks = await taskQueueService.getActiveTasks(chatRoomId);
    if (activeTasks.length > 0) {
      debugLog('workbenchSyncSkippedRoomBusy', {
        chatRoomId,
        activeTaskCount: activeTasks.length,
      });
      return;
    }
    await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, true);
  } catch (error) {
    console.error('[workbench] 同步派发任务状态失败:', error);
  }
}

// 归一化助手标识 token：去首尾空白、去掉前导 @、小写，便于按名称匹配。
function normalizeAgentToken(token: string): string {
  return token.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * 把协调器返回的目标助手 token 解析为「真实 agentId」。
 *
 * 背景：让 LLM 逐字复现 36 位 UUID 极不可靠，实际线上出现过模型把多个助手的 UUID 片段
 * 拼接成不存在的 ID（如把「运维」前半段 + 「UI设计」后半段拼出 d489d615-...-eb6d06e），
 * 导致 findById 查不到、dispatch 静默失败（表现为「又不调度了」）。
 *
 * 现在提示词要求 LLM 回传助手「名称」，这里按 名称 / 真实 ID 双路解析：
 *   1) token 精确等于群内某活跃助手的真实 ID（兼容模型偶尔给出正确 UUID）
 *   2) token 归一化后等于群内某活跃助手的名称（主路径）
 *   3) 兜底原样透传：可能是系统级助手 ID（不在群成员清单内），交由后续 findById/级别校验
 */
async function resolveTargetAgentIds(chatRoomId: string, tokens: string[]): Promise<string[]> {
  const roomAgents = await chatRoomService.getAgents(chatRoomId);
  const active = roomAgents
    .map((cra) => cra.agent)
    .filter((a): a is NonNullable<typeof a> =>
      !!a && (a as any).isActive && a.id !== GROUP_COORDINATOR_ID);

  const idSet = new Set(active.map((a) => a.id));
  const nameToId = new Map(active.map((a) => [normalizeAgentToken(a.name), a.id]));

  const resolved: string[] = [];
  for (const token of tokens) {
    if (!token || !token.trim()) continue;
    if (idSet.has(token)) {
      resolved.push(token);
      continue;
    }
    const byName = nameToId.get(normalizeAgentToken(token));
    if (byName) {
      resolved.push(byName);
      continue;
    }
    // 兜底透传（系统级助手 id 或正确但不在群清单内的 id）
    resolved.push(token);
  }
  return resolved;
}

export function buildDispatchPlanContent(
  assignments: Array<{
    agent: NonNullable<Awaited<ReturnType<typeof agentService.findById>>>;
    content: string;
  }>,
  dispatchMode: 'parallel' | 'serial',
  locale?: string,
): string {
  // 单个任务不再展示标题和前缀，直接输出 @助手 内容
  if (assignments.length === 1) {
    const { agent, content } = assignments[0];
    return `@${agent.name} ${content}`;
  }
  const lines = assignments.map(({ agent, content }, index) => {
    const prefix = dispatchMode === 'serial'
      ? `${index + 1}.`
      : '-';
    return `${prefix} @${agent.name} ${content}`;
  });
  const title = dispatchMode === 'serial'
    ? pickLocaleText({ 'zh-CN': '串行任务', 'en-US': 'Serial tasks' }, locale)
    : pickLocaleText({ 'zh-CN': '并行任务', 'en-US': 'Parallel tasks' }, locale);
  return `**${title}**\n${lines.join('\n')}`;
}

async function executeDecision(
  chatRoomId: string,
  triggerMessage: Message,
  decision: DispatchDecision,
  coordinatorAgent: AgentWithRelations,
  options?: CoordinatorDispatchOptions,
  locale?: string,
): Promise<void> {
  // 被用户发言打断：放弃执行本次调度决策（不派发、不改工作台状态）。
  if (options?.signal?.aborted) {
    debugLog('coordinatorDispatchAborted', { chatRoomId, phase: 'beforeExecute' });
    return;
  }
  debugLog('coordinatorStructuredDecision', {
    chatRoomId,
    decision: decision.decision,
    assignments: decision.assignments,
    targetAgentIds: decision.targetAgentIds,
    reason: decision.reason,
    forwardVerbatim: decision.forwardVerbatim,
  });

  // 记录调度日志的辅助函数
  const writeLog = async (success: boolean = true, errorMessage?: string) => {
    try {
      await coordinatorLogService.create({
        chatRoomId,
        triggerMessageId: triggerMessage.id,
        decision: decision.decision,
        targetAgentIds: decision.targetAgentIds,
        content: decision.content,
        forwardVerbatim: decision.forwardVerbatim,
        reason: decision.reason,
        sourceAgentId: triggerMessage.agentId ?? undefined,
        sourceIsHuman: triggerMessage.isHuman,
        sourceContent: triggerMessage.content.slice(0, 500),
        success,
        errorMessage,
      });
    } catch (error) {
      console.error('[coordinator-dispatch] 写入调度日志失败:', error);
    }
  };

  switch (decision.decision) {
    case 'no_dispatch':
      // 群调度助手本次未调度助手 ≠ 群内已空闲：
      // 助手在执行过程中产生的中间消息（进度/阶段产物）也会触发协调，此时协调器通常给出
      // no_dispatch。若直接标记 waiting_review，会让任务在真正完成前就跳到「待确认」，
      // 表现为「不进入执行中、执行完成后才进待确认」。因此只有群内确实没有进行中的任务
      // （无 pending/executing 队列任务）时，才把派发任务流转为 waiting_review。
      await syncWorkbenchOnRoomIdle(chatRoomId);
      await writeLog();
      return;

    case 'cannot_dispatch':
      // 系统管理请求，不是工作任务，不更新工作台状态
      await writeLog();
      return;

    case 'ask_owner': {
      const content = decision.content?.trim();
      if (!content) return;
      const msg = await buildAIMessage(
        content,
        triggerMessage.id,
        INTERNAL_COORDINATOR_AGENT_NAME,
        GROUP_COORDINATOR_ID,
        chatRoomId,
        coordinatorAgent.avatar,
        coordinatorAgent.avatarColor,
      );
      await messageService.create({
        id: msg.id,
        type: 'REPLY',
        content: msg.content,
        time: msg.time,
        agentId: GROUP_COORDINATOR_ID,
        chatRoomId,
        replyMessageId: triggerMessage.id,
        isHuman: false,
      });
      if (globalEmit) await globalEmit(msg, chatRoomId);
      // 等待用户确认 → 同样仅在群内确实空闲时才流转为 waiting_review，避免助手仍在执行时
      // 因转发其问题而提前把任务标记为待确认。
      await syncWorkbenchOnRoomIdle(chatRoomId);
      await writeLog();
      return;
    }

    case 'dispatch': {
      let structuredAssignments = (decision.assignments ?? [])
        .filter((assignment) => assignment.targetAgentName?.trim())
        .map((assignment) => ({
          targetAgentName: assignment.targetAgentName.trim(),
          content: assignment.content?.trim() || triggerMessage.content,
          forwardVerbatim: assignment.forwardVerbatim,
        }));
      if (
        options?.routingReason === 'humanUnroutedMessage' &&
        structuredAssignments.length > 1
      ) {
        console.warn(
          '[coordinator-dispatch] unrouted user decision returned multiple assignments; using the highest-ranked first assignment',
        );
        structuredAssignments = structuredAssignments.slice(0, 1);
      }
      const legacyContent = decision.forwardVerbatim
        ? triggerMessage.content
        : (decision.content?.trim() || triggerMessage.content);
      let requestedAssignments = structuredAssignments.length > 0
        ? structuredAssignments
        : (decision.targetAgentIds ?? [])
            .filter((token) => token?.trim())
            .map((token) => ({
              targetAgentName: token.trim(),
              content: legacyContent,
              forwardVerbatim: decision.forwardVerbatim,
            }));
      if (
        options?.routingReason === 'humanUnroutedMessage' &&
        requestedAssignments.length > 1
      ) {
        requestedAssignments = requestedAssignments.slice(0, 1);
      }
      if (requestedAssignments.length === 0) {
        console.warn('[coordinator-dispatch] dispatch decision missing assignments');
        return;
      }

      // 协调器现按「名称」回传目标助手，这里容错解析为真实 agentId，
      // 规避 LLM 编造 / 拼接 UUID 导致 findById 查不到、dispatch 静默失败的问题。
      const ids = await resolveTargetAgentIds(
        chatRoomId,
        requestedAssignments.map((assignment) => assignment.targetAgentName),
      );

      // 先解析所有有效目标及其独立任务，同一助手只保留第一项，避免重复入队。
      const resolvedAssignments: Array<{
        agent: NonNullable<Awaited<ReturnType<typeof agentService.findById>>>;
        content: string;
      }> = [];
      const seenAgentIds = new Set<string>();
      for (let index = 0; index < ids.length; index += 1) {
        const agentId = ids[index]!;
        const agent = await agentService.findById(agentId);
        if (!agent || !(agent as any).isActive) {
          console.warn(`[coordinator-dispatch] agent ${agentId} not found or inactive`);
          continue;
        }
        if ((agent as any).agentLevel !== 'system') {
          const isMember = await chatRoomService.isAgentMember(chatRoomId, agentId);
          if (!isMember) {
            console.warn(`[coordinator-dispatch] agent ${agent.name} not in room ${chatRoomId}`);
            continue;
          }
        }
        if (seenAgentIds.has(agent.id)) {
          console.warn(`[coordinator-dispatch] duplicate assignment for agent ${agent.name}`);
          continue;
        }
        seenAgentIds.add(agent.id);
        const requested = requestedAssignments[index]!;
        const useVerbatim =
          requestedAssignments.length === 1 &&
          triggerMessage.isHuman &&
          requested.forwardVerbatim;
        resolvedAssignments.push({
          agent,
          content: useVerbatim ? triggerMessage.content : requested.content,
        });
      }

      if (resolvedAssignments.length === 0) return;

      // 提前回报本次将要派发的目标助手 id：即便在「广播 / enqueue」过程中被用户打断，
      // 调用方（卡住检测 watchdog）也能凭此把这些助手的执行/排队任务一并停掉。
      options?.onAgentsDispatched?.(resolvedAssignments.map(({ agent }) => agent.id));

      // 必须在「广播调度消息 / enqueue 助手」之前，先把工作台任务从 dispatched 推进到 in_progress。
      // 否则被调度的助手可能在该流转之前就执行完并产出消息，触发协调器再次裁决得到 no_dispatch，
      // 而此时群内已空闲（助手任务已出队），no_dispatch 会把 dispatched 直接刷成 waiting_review，
      // 跳过「执行中」，表现为任务一直停留在「已派发」后直接进「待确认」。
      try {
        await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, false);
      } catch (error) {
        console.error('[workbench] 同步派发任务状态失败:', error);
      }

      // 串行模式（协调器判定用户要「按顺序/依次/逐个」执行）：本次只派队首助手，
      // 其余按 targetAgents 顺序登记到串行链，由 handler 在每个助手完成后逐个推进。
      const serialMode = decision.dispatchMode === 'serial' && resolvedAssignments.length > 1;
      const dispatchMode = serialMode ? 'serial' : 'parallel';
      const suppressAssistantHandoff = resolvedAssignments.length > 1;
      const assignmentsToEnqueue = serialMode
        ? resolvedAssignments.slice(0, 1)
        : resolvedAssignments;

      // 群里展示完整任务计划；实际入队仍按并行/串行策略执行。
      const visibleContent = buildDispatchPlanContent(
        resolvedAssignments,
        dispatchMode,
        locale,
      );
      const dispatchMsg = await buildAIMessage(
        visibleContent,
        triggerMessage.id,
        INTERNAL_COORDINATOR_AGENT_NAME,
        GROUP_COORDINATOR_ID,
        chatRoomId,
        coordinatorAgent.avatar,
        coordinatorAgent.avatarColor,
      );
      await messageService.create({
        id: dispatchMsg.id,
        type: 'REPLY',
        content: dispatchMsg.content,
        time: dispatchMsg.time,
        agentId: GROUP_COORDINATOR_ID,
        chatRoomId,
        replyMessageId: triggerMessage.id,
        isHuman: false,
      });
      // 只同步 UI，不触发 receivedMessage；否则汇总消息中的多个 @ 会造成重复入队。
      if (globalBroadcastMessage) await globalBroadcastMessage(dispatchMsg, chatRoomId);

      const anchorMessageId = dispatchMsg.id;
      const dispatchedIds: string[] = [];
      for (const assignment of assignmentsToEnqueue) {
        const executionContent = suppressAssistantHandoff
          ? markTaskWithoutAssistantHandoff(assignment.content)
          : assignment.content;
        const agentTriggerMessage: Message = {
          ...dispatchMsg,
          id: anchorMessageId,
          content: `@${assignment.agent.name} ${executionContent}`,
        };
        await enqueueAgentTask(chatRoomId, agentTriggerMessage, assignment.agent, null, {
          onTaskEnqueued: serialMode
            ? (task) => {
                startSerialChain(
                  chatRoomId,
                  resolvedAssignments.map(({ agent, content }) => ({
                    agentId: agent.id,
                    content: markTaskWithoutAssistantHandoff(content),
                  })),
                  { triggerMessageId: anchorMessageId },
                  task.id,
                );
              }
            : undefined,
          onTaskEnqueueFailed: serialMode
            ? (task) => {
                clearSerialChainForTask(chatRoomId, assignment.agent.id, task.id);
              }
            : undefined,
        });
        dispatchedIds.push(assignment.agent.id);
      }

      if (!serialMode && dispatchedIds.length > 1) {
        startParallelBatch(chatRoomId, dispatchedIds);
      }
      // 调度日志记录解析后的真实 agentId，而非协调器回传的名称 token。
      // 串行模式记录整条链的有序名单（含尚未派发的后继助手），便于审计完整计划。
      decision.targetAgentIds = serialMode
        ? resolvedAssignments.map(({ agent }) => agent.id)
        : dispatchedIds;
      decision.content = visibleContent;
      decision.forwardVerbatim = resolvedAssignments.length === 1 &&
        requestedAssignments[0]?.forwardVerbatim === true;
      await writeLog();
      return;
    }
  }
}

/**
 * 以群调度助手身份，向单个目标助手派发一条调度消息（构建 + 入库 + 仅 UI 广播 + 入队）。
 * 与 executeDecision 的 dispatch 分支同样的可见消息结构，供串行链推进复用。
 */
async function dispatchCoordinatorMessageToAgent(
  chatRoomId: string,
  replyToMessageId: string,
  agent: NonNullable<Awaited<ReturnType<typeof agentService.findById>>>,
  dispatchContent: string,
  coordinatorAgent: AgentWithRelations,
  options?: {
    silent?: boolean;
    historyAnchorMessageId?: string;
    onTaskEnqueued?: (taskId: string) => void;
    onTaskEnqueueFailed?: (taskId: string) => void;
  },
): Promise<void> {
  const taskPromptPolicy = parseTaskPromptPolicy(dispatchContent);
  const visibleContent = `@${agent.name} ${taskPromptPolicy.content}`;
  const dispatchMsg = await buildAIMessage(
    visibleContent,
    replyToMessageId,
    INTERNAL_COORDINATOR_AGENT_NAME,
    GROUP_COORDINATOR_ID,
    chatRoomId,
    coordinatorAgent.avatar,
    coordinatorAgent.avatarColor,
  );
  // silent（串行链推进）：不入库、不广播，仅作为助手任务触发源；群里只显示助手回复。
  if (!options?.silent) {
    await messageService.create({
      id: dispatchMsg.id,
      type: 'REPLY',
      content: dispatchMsg.content,
      time: dispatchMsg.time,
      agentId: GROUP_COORDINATOR_ID,
      chatRoomId,
      replyMessageId: replyToMessageId,
      isHuman: false,
    });
    // 仅 UI 同步，不触发 receivedMessage：否则这条 "@助手 ..." 会重入 handler 把目标助手再入队一次。
    if (globalBroadcastMessage) await globalBroadcastMessage(dispatchMsg, chatRoomId);
  }
  // silent 时把触发源 id 锚定到串行链的锚点消息（原始用户消息）上，
  // 让本步的「xxx 执行中」继续显示在最开始那条消息下面；
  // 历史边界则用「上一个助手的回复」（含其本身），保证本助手能看到前驱产出。
  const taskTriggerMessage: Message = options?.silent
    ? {
        ...dispatchMsg,
        id: replyToMessageId,
        content: `@${agent.name} ${dispatchContent}`,
      }
    : {
        ...dispatchMsg,
        content: `@${agent.name} ${dispatchContent}`,
      };
  await enqueueAgentTask(chatRoomId, taskTriggerMessage, agent, null, {
    historyAnchorMessageId: options?.historyAnchorMessageId,
    historyInclusive: options?.silent ? true : undefined,
    onTaskEnqueued: options?.onTaskEnqueued
      ? (task) => options.onTaskEnqueued?.(task.id)
      : undefined,
    onTaskEnqueueFailed: options?.onTaskEnqueueFailed
      ? (task) => options.onTaskEnqueueFailed?.(task.id)
      : undefined,
  });
}

export type SerialChainAdvanceStatus =
  | 'advanced'                 // 已派发下一个助手
  | 'completed'                // 整条链完成，可由调用方触发收尾 join
  | 'completed_user_intervened' // 整条链完成，但用户已接管：静默收口
  | 'terminated'               // 当前任务失败/取消或后续派发失败，链已终止
  | 'none';                    // 完成的助手不属于当前串行链队首 → 走正常流程

/**
 * 串行链推进：队首助手完成后，派发链上的下一个助手；队尾完成则返回 completed 让调用方收尾。
 * 跳过已停用 / 已退群的后继助手（递归推进到下一个有效助手）。
 */
export async function tryAdvanceSerialChain(
  chatRoomId: string,
  completedAgentId: string,
  completedTaskId: string,
  completedMessageId: string,
  outcome: AgentTaskOutcome = 'completed',
): Promise<SerialChainAdvanceStatus> {
  if (outcome !== 'completed') {
    return clearSerialChainForTask(chatRoomId, completedAgentId, completedTaskId)
      ? 'terminated'
      : 'none';
  }

  let advance = advanceSerialChain(chatRoomId, completedAgentId, completedTaskId);
  if (advance.kind === 'none') return 'none';

  try {
    while (advance.kind === 'next') {
      const nextAgentId = advance.nextAgentId;
      const nextAgent = await agentService.findById(nextAgentId);
      const isUsable =
        nextAgent &&
        (nextAgent as any).isActive &&
        ((nextAgent as any).agentLevel === 'system' ||
          (await chatRoomService.isAgentMember(chatRoomId, nextAgentId)));
      if (!isUsable) {
        debugLog('serialChainSkipUnusableAgent', { chatRoomId, agentId: nextAgentId });
        advance = skipUnboundSerialAgent(chatRoomId, nextAgentId);
        continue;
      }

      const coordinatorAgent = await agentService.findById(GROUP_COORDINATOR_ID);
      if (!coordinatorAgent) {
        clearSerialChain(chatRoomId);
        return 'terminated';
      }

      await dispatchCoordinatorMessageToAgent(
        chatRoomId,
        advance.context.triggerMessageId,
        nextAgent!,
        advance.context.dispatchContent,
        coordinatorAgent as AgentWithRelations,
        {
          silent: true,
          historyAnchorMessageId: completedMessageId,
          onTaskEnqueued: (taskId) => {
            if (!bindSerialTask(chatRoomId, nextAgentId, taskId)) {
              throw new Error('Failed to bind serial chain task');
            }
          },
          onTaskEnqueueFailed: (taskId) => {
            clearSerialChainForTask(chatRoomId, nextAgentId, taskId);
          },
        },
      );
      debugLog('serialChainAdvanced', {
        chatRoomId,
        completedAgentId,
        nextAgentId,
      });
      return 'advanced';
    }

    return advance.kind === 'last'
      ? 'completed'
      : advance.kind === 'last_user_intervened'
        ? 'completed_user_intervened'
        : 'none';
  } catch (error) {
    clearSerialChain(chatRoomId);
    console.error('[coordinator-dispatch] 串行链后续任务派发失败:', error);
    return 'terminated';
  }
}

export async function runCoordinatorDispatch(
  chatRoomId: string,
  message: Message,
  coordinatorAgent: AgentWithRelations,
  options?: CoordinatorDispatchOptions,
): Promise<void> {
  const signal = options?.signal;
  const providerCandidates = await findCoordinatorProviders(coordinatorAgent);
  if (providerCandidates.length === 0) {
    console.warn('[coordinator-dispatch] 找不到 LLM Provider，跳过协调');
    options?.onFailure?.('provider_unavailable');
    return;
  }

  const chatRoom = await chatRoomService.findById(chatRoomId);
  if (!chatRoom) return;

  // 提示词语言跟随群主的界面语言（房间维度统一），保证注入上下文与提示词同语种。
  const locale: Locale = normalizeLocale((chatRoom.owner as any)?.preferredLanguage);

  const chatRoomMembers = await chatRoomService.getAgents(chatRoomId);
  const businessAssistantCount = chatRoomMembers.filter((cra) =>
    cra.agent &&
    (cra.agent as any).isActive &&
    (cra.agent as any).agentLevel !== 'system' &&
    cra.agent.id !== GROUP_COORDINATOR_ID).length;
  const humanMembers = chatRoom.chatRoomAgents.filter((cra: any) => cra.user);
  const memberSection = buildMemberSection(chatRoomMembers, chatRoom.owner?.username, humanMembers, locale);

  const contextBlock = await buildCoordinatorLayeredContext(chatRoomId, message.id, locale);
  const userContent = withCoordinatorContext(message.content, contextBlock, {
    isHuman: message.isHuman,
    name: message.isHuman ? message.user : message.agentName,
  }, locale);

  const isUnroutedUserMessage =
    options?.routingReason === 'humanUnroutedMessage' && message.isHuman;
  // 用户显式 @ 多个助手：明确派发意图，协调器只决定并行/串行 + 子任务，不得 no_dispatch。
  const isExplicitMultiMention =
    options?.routingReason === 'humanMultiMention' && message.isHuman;
  let toolConstraints: DispatchToolConstraints | undefined;
  if (isUnroutedUserMessage && businessAssistantCount > 0) {
    toolConstraints = {
      maxAssignments: 1,
      forbidNoSuitableAssistant: true,
      allowedDecisions: ['dispatch'],
      requireAssignments: true,
    };
  } else if (isExplicitMultiMention && businessAssistantCount > 0) {
    toolConstraints = {
      forbidNoSuitableAssistant: true,
      allowedDecisions: ['dispatch'],
      requireAssignments: true,
    };
  }
  const systemPrompt = buildInternalCoordinatorPrompt(locale)
    + buildDispatchRulesBlock((chatRoom as any).dispatchRules, locale)
    + (isUnroutedUserMessage
      ? buildUnroutedUserConstraintBlock(businessAssistantCount, locale)
      : isExplicitMultiMention && businessAssistantCount > 0
        ? buildExplicitMentionConstraintBlock(locale)
        : '');
  if (globalEmitTyping) {
    globalEmitTyping(
      { messageId: message.id, agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, status: 'executing' },
      chatRoomId,
    );
  }

  let decision: DispatchDecision | null;
  let lastLlmError: unknown;
  let sawEmptyDecision = false;
  try {
    decision = null;
    for (let index = 0; index < providerCandidates.length; index += 1) {
      const { provider, role } = providerCandidates[index];
      const protocol = ((provider as any).apiProtocol ?? 'anthropic') as 'anthropic' | 'openai';
      const providerLabel = `${provider.name} (${provider.model})`;
      try {
        const providerDecision = await callCoordinatorLlmWithRetry(
          `coordinator-${protocol}-${role}`,
          signal,
          (attemptSignal) => protocol === 'openai'
            ? callOpenAICoordinator(
                provider,
                systemPrompt,
                memberSection,
                userContent,
                locale,
                toolConstraints,
                attemptSignal,
              )
            : callAnthropicCoordinator(
                provider,
                systemPrompt,
                memberSection,
                userContent,
                locale,
                toolConstraints,
                attemptSignal,
              ),
        );

        if (providerDecision) {
          decision = providerDecision;
          debugLog('coordinatorModelDecision', {
            chatRoomId,
            triggerMessageId: message.id,
            role,
            providerId: provider.id,
            providerName: provider.name,
            model: provider.model,
          });
          break;
        }

        sawEmptyDecision = true;
        console.error('[coordinator-dispatch] 结构化调用未返回决策', {
          chatRoomId,
          triggerMessageId: message.id,
          provider: providerLabel,
          role,
          willSwitch: index < providerCandidates.length - 1,
        });
        debugLog('coordinatorModelEmptyDecision', {
          chatRoomId,
          triggerMessageId: message.id,
          role,
          providerId: provider.id,
          providerName: provider.name,
          model: provider.model,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        lastLlmError = error;
        const willSwitch = index < providerCandidates.length - 1;
        console.error('[coordinator-dispatch] LLM 调用失败:', {
          provider: providerLabel,
          role,
          willSwitch,
          error,
        });
        debugLog('coordinatorModelAttemptFailed', {
          chatRoomId,
          triggerMessageId: message.id,
          role,
          providerId: provider.id,
          providerName: provider.name,
          model: provider.model,
          willSwitch,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    // 被用户发言打断（abort）属预期路径，不当作错误。
    if (signal?.aborted) {
      debugLog('coordinatorDispatchAborted', { chatRoomId, phase: 'llm' });
      if (globalEmitDone) {
        globalEmitDone(
          { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
          chatRoomId,
        );
      }
      return;
    }
    console.error('[coordinator-dispatch] LLM 调用失败:', error);
    options?.onFailure?.('llm_error', error);
    if (globalEmitDone) {
      globalEmitDone(
        { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
        chatRoomId,
      );
    }
    return;
  }

  if (!decision) {
    if (lastLlmError) {
      console.error('[coordinator-dispatch] 所有群调度助手模型调用失败，跳过协调:', lastLlmError);
      options?.onFailure?.('llm_error', lastLlmError);
    } else {
      console.error('[coordinator-dispatch] 所有群调度助手模型均未返回结构化决策，跳过');
      options?.onFailure?.(sawEmptyDecision ? 'empty_decision' : 'llm_error');
    }
    if (globalEmitDone) {
      globalEmitDone(
        { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
        chatRoomId,
      );
    }
    return;
  }

  console.log('[coordinator-dispatch] 调度决策:', JSON.stringify(decision, null, 2));

  try {
    console.log('[coordinator-dispatch] executeDecision start', {
      chatRoomId,
      triggerMessageId: message.id,
      decision: decision.decision,
    });
    await executeDecision(chatRoomId, message, decision, coordinatorAgent, options, locale);
    console.log('[coordinator-dispatch] executeDecision success', {
      chatRoomId,
      triggerMessageId: message.id,
      decision: decision.decision,
    });
  } catch (error) {
    console.error('[coordinator-dispatch] executeDecision failed before agent:done', {
      chatRoomId,
      triggerMessageId: message.id,
      decision: decision.decision,
      error,
    });
    options?.onFailure?.('execution_error', error);
    throw error;
  } finally {
    console.log('[coordinator-dispatch] executeDecision finally', {
      chatRoomId,
      triggerMessageId: message.id,
      decision: decision.decision,
      willEmitDone: !!globalEmitDone,
    });
  }

  if (globalEmitDone) {
    console.log('[coordinator-dispatch] emitDone', {
      chatRoomId,
      triggerMessageId: message.id,
      agentId: GROUP_COORDINATOR_ID,
      agentName: INTERNAL_COORDINATOR_AGENT_NAME,
    });
    globalEmitDone(
      { agentId: GROUP_COORDINATOR_ID, agentName: INTERNAL_COORDINATOR_AGENT_NAME, triggerMessageId: message.id },
      chatRoomId,
    );
  }
}
