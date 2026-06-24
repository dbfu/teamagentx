import type {
  AgentExecResult,
  IAgentExecutor,
  TokenUsage,
  ToolCallEmitCallback,
} from '../executor.interface.js';

export class HandoffAuditTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`handoff audit timed out after ${timeoutMs}ms`);
    this.name = 'HandoffAuditTimeoutError';
  }
}

export interface HandoffAuditBaseEligibility {
  enabled: boolean;
  agentTriggerMode?: string | null;
  agentLevel?: string | null;
  agentId: string;
  coordinatorAgentId: string;
  suppressAssistantHandoff: boolean;
  isLeaf: boolean;
  isQuickChatRoom: boolean;
}

export interface HandoffAuditEligibility extends HandoffAuditBaseEligibility {
  hasFinalMessage: boolean;
  finalMessageMentionsUser: boolean;
  pendingMentionCount: number;
}

export function shouldDeferHandoffOutput(input: HandoffAuditBaseEligibility): boolean {
  const smartMode = input.agentTriggerMode === 'auto' || input.agentTriggerMode === 'coordinator';
  return input.enabled &&
    smartMode &&
    input.agentLevel !== 'system' &&
    input.agentId !== input.coordinatorAgentId &&
    !input.suppressAssistantHandoff &&
    !input.isLeaf &&
    !input.isQuickChatRoom;
}

export function shouldRunHandoffAudit(input: HandoffAuditEligibility): boolean {
  return shouldDeferHandoffOutput(input) &&
    input.hasFinalMessage &&
    !input.finalMessageMentionsUser &&
    input.pendingMentionCount === 0;
}

export function buildHandoffAuditPrompt(locale?: string): string {
  if (locale === 'en-US') {
    return `[System handoff audit — do not repeat your answer]
Your previous answer has been generated but has not been delivered yet. Perform exactly one final handoff check now:
- Re-check the user's overall objective, the group rules, the current workflow stage, and member responsibilities.
- If another assistant must continue, validate, review, deploy, or otherwise own the next stage, call mention_agents now with a concrete task for each target.
- If the whole task is genuinely complete or now requires the user, do not call mention_agents.
Do not repeat the result, do not continue the work, do not call any other tool, and do not mention a user. Your text response is discarded; only mention_agents registrations are retained.`;
  }

  return `[系统交接复核——不要重复正文]
你上一条回复已经生成，但尚未发送。现在只做一次最终交接检查：
- 重新检查用户的整体目标、群规则、当前流程阶段和群内成员职责。
- 如果仍需其他助手继续、验证、评审、部署或承担明确的下一阶段，立即调用 mention_agents，并为每个目标填写具体任务。
- 如果整个任务确实已经完成，或现在需要用户介入，则不要调用 mention_agents。
不要重复结果，不要继续执行工作，不要调用其他工具，也不要 @用户。你的文本回复会被丢弃，系统只保留 mention_agents 的登记结果。`;
}

export interface DeferredHandoffOutput {
  content: string;
  replyMessageId?: string;
}

export function createHandoffOutputBuffer(
  publish: (content: string, replyMessageId?: string) => Promise<void>,
) {
  const outputs: DeferredHandoffOutput[] = [];
  return {
    enqueue(content: string, replyMessageId?: string) {
      outputs.push({ content, replyMessageId });
    },
    get size() {
      return outputs.length;
    },
    get latestContent() {
      return outputs.at(-1)?.content;
    },
    async flush() {
      while (outputs.length > 0) {
        const output = outputs[0]!;
        await publish(output.content, output.replyMessageId);
        outputs.shift();
      }
    },
  };
}

function addTokenUsage(left?: TokenUsage, right?: TokenUsage): TokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    cacheReadTokens: (left.cacheReadTokens ?? 0) + (right.cacheReadTokens ?? 0),
    cacheCreationTokens: (left.cacheCreationTokens ?? 0) + (right.cacheCreationTokens ?? 0),
  };
}

export function mergeHandoffAuditResult(
  primary: AgentExecResult,
  audit: AgentExecResult,
): AgentExecResult {
  return {
    actions: primary.actions,
    model: primary.model ?? audit.model,
    tokenUsage: addTokenUsage(primary.tokenUsage, audit.tokenUsage),
  };
}

export async function runSilentHandoffAudit(options: {
  executor: IAgentExecutor;
  prompt: string;
  originalMessageId: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onToolCall?: ToolCallEmitCallback;
}): Promise<AgentExecResult> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    forwardAbort();
  } else {
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 0;
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new HandoffAuditTimeoutError(timeoutMs)), timeoutMs)
    : null;

  try {
    return await options.executor.exec(
      options.prompt,
      async () => undefined,
      options.originalMessageId,
      undefined,
      () => undefined,
      options.onToolCall,
      () => undefined,
      controller.signal,
      undefined,
      () => undefined,
      { suppressFailureMessage: true },
    );
  } catch (error) {
    if (controller.signal.reason instanceof HandoffAuditTimeoutError) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}
