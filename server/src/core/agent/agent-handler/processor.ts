import type { ToolCall } from '../executor.interface.js';
import type { AgentExecResult, IAgentExecutor } from '../executor.interface.js';
import { coerceThinkingText } from '../executor.interface.js';
import type { LlmProvider } from '@prisma/client';
import { taskQueueService, type HistoryMessage } from '../../../modules/task-queue/task-queue.service.js';
import { executionRecordService, type ExecutionEvent } from '../../../modules/execution-record/execution-record.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import { stopTypingLoop } from '../../../modules/bridge/typing-loop.js';
import { messageService } from '../../../modules/message/message.service.js';
import { roomMessageIndexService } from '../../../modules/message/room-message-index.service.js';
import { todoService } from '../../../modules/todo/todo.service.js';
import { config } from '../../../config/index.js';
import { agentService } from '../agent.service.js';
import { parseFallbackLlmProviderIds } from '../agent.service.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import { workbenchTaskService } from '../../../modules/workbench/workbench.service.js';
import {
  processingMap,
  abortControllers,
  abortLocales,
  discardExecutionResultKeys,
  taskExecutionStartedAt,
  streamEventsCache,
  injectedRoomRulesCache,
  bridgeInfoCache,
} from './cache.js';
import { getSystemMessage } from './system-messages.js';
import {
  globalEmit,
  globalEmitTyping,
  globalEmitDone,
  globalEmitStream,
  globalEmitToolCall,
  globalEmitThinking,
  globalEmitStatus,
  globalEmitTodoCreated,
  globalBroadcastTaskQueue,
  broadcastAgentStatus,
  broadcastAgentTaskQueue,
} from './status.js';
import { getExecutor } from './executor-manager.js';
import { buildAgentDispatchPlan } from '../dispatch-rules/agent-dispatch-plan.js';
import { buildAIMessage } from './message-utils.js';
import { debugLog } from './debug.js';
import { notifySourceAgentOnFailure } from './task-failure-notification.js';
import { shouldSuppressInternalCoordinatorMessage } from '../internal-coordinator-agent.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import {
  createNoActivityMonitor,
  NoActivityTimeoutError,
  sleepForNoActivityRetry,
  type NoActivityMonitor,
} from './no-activity-timeout.js';
import {
  notifyAgentTaskSettled,
  type AgentTaskOutcome,
} from './task-lifecycle.js';
import type { Message } from '../../../types/message.js';

function normalizeExecutionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function resolveFallbackLlmProviders(
  fallbackLlmProviderIdsJson: string | null | undefined,
  primaryProviderId?: string | null,
): Promise<LlmProvider[]> {
  const fallbackIds = parseFallbackLlmProviderIds(fallbackLlmProviderIdsJson);
  if (fallbackIds.length === 0) return [];

  const activeProviders = await llmProviderService.findActive('text');
  const activeProviderById = new Map(activeProviders.map((provider) => [provider.id, provider]));
  const providers: LlmProvider[] = [];
  for (const providerId of fallbackIds) {
    if (providerId === primaryProviderId) continue;
    const provider = activeProviderById.get(providerId);
    if (provider) providers.push(provider);
  }
  return providers;
}

function addUniqueModel(models: string[], model: unknown): void {
  if (typeof model !== 'string') return;
  const trimmed = model.trim();
  if (!trimmed || models.includes(trimmed)) return;
  models.push(trimmed);
}

function collectExecutionModels(
  events: ExecutionEvent[],
  finalModel?: string | null,
): string | null {
  const models: string[] = [];

  for (const event of events) {
    if (event.type !== 'model' || event.data.type === 'switch') continue;
    addUniqueModel(models, event.data.model);
  }
  addUniqueModel(models, finalModel);

  return models.length > 0 ? models.join(' / ') : null;
}

// 处理队列中的任务
export async function processQueue(chatRoomId: string, agentId: string) {
  const key = `${chatRoomId}_${agentId}`;

  // 如果已经在处理中，直接返回（新任务会在当前处理循环中被处理）
  if (processingMap.get(key)) {
    debugLog('processQueueSkipped', {chatRoomId, agentId, reason: 'alreadyProcessing'});
    return;
  }

  processingMap.set(key, true);
  recoveryService.setProcessingState(chatRoomId, true);

  // Broadcast status change (agent started executing)
  broadcastAgentStatus(chatRoomId);

  try {
    // 循环处理队列中的所有任务
    while (true) {
      const task = await taskQueueService.peek(chatRoomId, agentId);
      if (!task) break;

      // 标记任务为 executing 状态
      await taskQueueService.updateStatus(task.id, 'executing');
      const startedAt = Date.now();
      taskExecutionStartedAt.set(task.id, startedAt);

      // 群内有 agent 任务真正开始执行 → 该群「已派发」的工作台任务流转为「执行中」。
      // 这是所有调度路径（协调器结构化派发、手动/自由模式、用户直接 @、外部平台触发）
      // 的必经之处，把流转挂在这里可以不依赖协调器决策时序，保证只要助手开始干活，
      // 工作台任务就一定能进入 in_progress。函数幂等：已是 in_progress 的任务不会重复更新。
      try {
        await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, false);
      } catch (error) {
        console.error('[workbench] 同步派发任务状态失败:', error);
      }

      // 发送 typing 事件（让前端初始化流式面板）
      if (globalEmitTyping) {
        globalEmitTyping(
          { messageId: task.messageId, agentId: task.agentId, agentName: task.agentName, status: 'executing', startedAt },
          chatRoomId,
        );
      }

      debugLog('taskStart', {
        chatRoomId,
        agentId,
        agentName: task.agentName,
        taskId: task.id,
        messageContent: task.messageContent,
        hasHistory: !!task.history,
      });

      let taskOutcome: AgentTaskOutcome = 'failed';
      let taskFinalMessage: Message | undefined;
      try {
        // 创建 AbortController 用于中断执行
        let abortController = new AbortController();
        abortControllers.set(key, abortController);
        const resetAbortController = () => {
          abortController = new AbortController();
          abortControllers.set(key, abortController);
        };

        // 获取执行器；sessionDir 只在显式指定运行目录时传入。
        const executor = await getExecutor(chatRoomId, task.agentName, task.sessionDir ?? undefined);
        if (executor) {
          // 使用入队时保存的历史消息，如果没有则获取当前历史
          let history: HistoryMessage[] | undefined = taskQueueService.parseHistory(task);

          // 只有当任务没有保存历史且配置了群历史访问时，才构建增量消息索引。
          if (!history && executor.injectGroupHistory) {
            history = await roomMessageIndexService.buildMessageIndex(
              chatRoomId,
              task.messageId,
              executor.lastInjectedMessageId,
            );
          }

          debugLog('taskHistory', {
            chatRoomId,
            agentId,
            agentName: task.agentName,
            historyCount: history?.length ?? 0,
            history: history?.map(h => ({sender: h.senderName, content: h.content})),
          });

          // 获取 agent 完整信息（包含 avatar 和 avatarColor）
          const agentInfo = await agentService.findById(task.agentId);

          // 群规则提醒（折中策略，省 token）：
          // - 仅当群规则相对该助手上次注入发生变化时，才内联完整规则正文（写入会话历史，
          //   resume 旧会话也能带着走，未开启群历史访问的助手同样能拿到最新规则）。
          // - 其余棒只追加一句很短的提醒，做长对话里的轻量强化，避免规则被「读着读着忘了」。
          // - 规则被清空时，注入一次「忽略旧规则」的提醒。
          // 提醒只进模型输入、不写库。
          const roomForReminder = await chatRoomService.findById(chatRoomId);
          const roomRulesForReminder = roomForReminder?.rules?.trim() || '';
          const ruleReminderKey = `${chatRoomId}_${task.agentName}`;
          const lastInjectedRoomRules = injectedRoomRulesCache.get(ruleReminderKey) ?? '';
          const roomRulesChanged = roomRulesForReminder !== lastInjectedRoomRules;
          let ruleReminder = '';
          if (roomRulesForReminder) {
            ruleReminder = roomRulesChanged
              ? `\n\n---\n[群规则提醒] 以下是本群当前生效的群规则，请在回复前严格遵守（如与你印象中的旧规则不一致，以下方为准）：\n${roomRulesForReminder}`
              : '\n\n---\n[群规则提醒] 本群设有群规则，请持续严格遵守。';
          } else if (roomRulesChanged) {
            // 规则刚被清空：提醒一次忽略旧规则。
            ruleReminder = '\n\n---\n[群规则提醒] 本群当前未设置群规则，请忽略此前可能记住的任何旧群规则。';
          }

          // 调度方案（任务流转/交接）：从群调度规则中抽取本助手相关的环节与「下一棒」，
          // 每棒执行时注入到 query（紧跟任务，注意力更集中），仅业务助手有内容。
          // 没有配置群调度规则时直接跳过，不做解析、不注入。
          let dispatchPlanReminder = '';
          const dispatchRulesYaml = (roomForReminder as any)?.dispatchRules?.trim();
          if (dispatchRulesYaml) {
            const dispatchPlanText = buildAgentDispatchPlan(
              dispatchRulesYaml,
              task.agentName,
              (roomForReminder?.owner as any)?.preferredLanguage,
            );
            if (dispatchPlanText) {
              dispatchPlanReminder = `\n\n---\n${dispatchPlanText}`;
            }
          }
          // 注意：注入记录在本棒成功执行后才提交（见下方 exec 之后），
          // 避免规则变更棒中途中断/报错时丢失「下一棒补注全文」的机会。

          // 收集生成的消息 ID，用于后续回填 executionRecordId
          const generatedMessageIds: string[] = [];

          // 收集执行事件（用于保存到 ExecutionRecord）
          const executionEvents: ExecutionEvent[] = [];
          // 记录最近一次「仅记录」的中间文本段内容，用于去重：
          // Codex 在工具调用后直接结束（无收尾消息）时，最终回答会与已记录的中间段相同，
          // 避免在执行详情里出现两个一模一样的输出节点。
          let lastRecordedSegmentContent: string | null = null;
          let activeNoActivityMonitor: NoActivityMonitor | null = null;
          const markExecutionActivity = () => {
            activeNoActivityMonitor?.markActivity();
          };

          // 创建 emit 回调，在 tool 调用时直接广播消息
          const emitCallback = async (content: string, replyMessageId?: string) => {
            if (content && content.trim()) {
              markExecutionActivity();
            }
            const shouldSuppressGroupMessage = shouldSuppressInternalCoordinatorMessage(
              task.agentId,
              content,
            );

            // 合并连续的 output 事件
            const lastEvent = executionEvents[executionEvents.length - 1];
            if (lastEvent && lastEvent.type === 'output') {
              // 在同一个 output 事件内累加内容
              lastEvent.data.content = (lastEvent.data.content || '') + content;
            } else if (
              content.trim() &&
              content.trim() === lastRecordedSegmentContent?.trim()
            ) {
              // 与刚记录的中间段完全相同：不再重复写入执行详情，但下面仍照常发群消息
            } else {
              // 创建新的 output 事件
              executionEvents.push({
                type: 'output',
                timestamp: Date.now(),
                data: { content, type: 'message' },
              });
            }

            if (shouldSuppressGroupMessage) {
              debugLog('internalCoordinatorNoDispatchSuppressed', {
                chatRoomId,
                agentId: task.agentId,
                agentName: task.agentName,
                triggerMessageId: task.messageId,
              });
              return;
            }

            const aiMessage = await buildAIMessage(
              content,
              replyMessageId || null,
              task.agentName,
              task.agentId,
              chatRoomId,
              agentInfo?.avatar,
              agentInfo?.avatarColor,
            );
            aiMessage.taskQueueId = task.id;

            debugLog('emitCallbackStart', {
              chatRoomId,
              agentId: task.agentId,
              agentName: task.agentName,
              messageId: aiMessage.id,
              content: aiMessage.content,
            });

            // 保存消息到数据库（等待保存完成）
            try {
              await messageService.create({
                id: aiMessage.id,
                type: 'REPLY',
                content: aiMessage.content,
                time: aiMessage.time,
                agentId: task.agentId,
                chatRoomId,
                replyMessageId: aiMessage.replyMessageId || null,
                isHuman: false,
              });
              debugLog('messageSaved', {
                chatRoomId,
                messageId: aiMessage.id,
                agentId: task.agentId,
                agentName: task.agentName,
              });
              // 收集生成的消息 ID，用于后续回填 executionRecordId
              generatedMessageIds.push(aiMessage.id);
              taskFinalMessage = aiMessage;
            } catch (err) {
              console.error('Failed to save message:', err);
              debugLog('messageSaveFailed', {
                chatRoomId,
                messageId: aiMessage.id,
                error: String(err),
              });
              return; // 保存失败就不广播
            }

            // 广播消息（消息已保存到数据库）
            if (globalEmit) {
              await globalEmit(aiMessage, chatRoomId);
              debugLog('messageEmitted', {
                chatRoomId,
                messageId: aiMessage.id,
                agentId: task.agentId,
                agentName: task.agentName,
              });
            }

            try {
              const todo = await todoService.createFromMentionedUser({
                chatRoomId,
                messageId: aiMessage.id,
                messageTime: aiMessage.time,
                triggerAgentId: task.agentId,
                triggerAgentName: task.agentName,
                content,
              });

              if (todo?.ownerUserId && globalEmitTodoCreated) {
                globalEmitTodoCreated(todo, todo.ownerUserId);
                debugLog('todoCreated', {
                  chatRoomId,
                  messageId: aiMessage.id,
                  todoId: todo.id,
                  ownerUserId: todo.ownerUserId,
                });
              }
            } catch (todoError) {
              console.error('Failed to check/create todo:', todoError);
            }

            // 更新恢复服务状态（Agent 发送了消息）
            recoveryService.updateRoomState(chatRoomId, task.agentName);
          };

          // 仅记录回调：把工具调用之前的中间文本段写入执行详情，但不发群消息、不广播。
          // 用于在执行详情里完整保留 agent 在多次工具调用之间产生的每一段文字。
          const recordCallback = (content: string) => {
            if (!content || !content.trim()) return;
            markExecutionActivity();
            executionEvents.push({
              type: 'output',
              timestamp: Date.now(),
              data: { content, type: 'message' },
            });
            lastRecordedSegmentContent = content;
          };

          // 流式内容回调
          const streamCallback = (content: string) => {
            if (content && content.trim()) {
              markExecutionActivity();
            }
            // 缓存流式事件（按 messageId_agentId 存储）
            const cacheKey = `${chatRoomId}_${task.messageId}_${task.agentId}`;
            let events = streamEventsCache.get(cacheKey) || [];
            const lastEvent = events[events.length - 1];

            if (lastEvent?.type === 'output') {
              // 在同一个 output 事件内累加内容
              lastEvent.content = (lastEvent.content || '') + content;
            } else {
              // 创建新的 output 事件
              const now = Date.now();
              events = events.map(e => ({ ...e, endTime: e.endTime ?? now }));
              events.push({
                id: `output-${now}`,
                type: 'output',
                content,
                timestamp: now,
              });
            }
            streamEventsCache.set(cacheKey, events);

            if (globalEmitStream) {
              globalEmitStream(
                { messageId: task.messageId, agentId: task.agentId, agentName: task.agentName, content },
                chatRoomId,
              );
            }
          };

          // 思考过程回调
          const thinkingCallback = (rawThinking: string) => {
            // 兜底：确保思考内容为字符串，避免对象被拼接成 "[object Object]"
            const thinking = coerceThinkingText(rawThinking);
            // 无有效思考文本时直接跳过，避免在执行记录里留下空的「思考」节点
            if (!thinking) return;
            markExecutionActivity();
            // 合并连续的 thinking 事件
            const lastExecEvent = executionEvents[executionEvents.length - 1];
            if (lastExecEvent && lastExecEvent.type === 'thinking') {
              // 在同一个 thinking 事件内累加内容
              lastExecEvent.data.content = (lastExecEvent.data.content || '') + thinking;
            } else {
              // 创建新的 thinking 事件
              executionEvents.push({
                type: 'thinking',
                timestamp: Date.now(),
                data: { content: thinking },
              });
            }

            // 缓存思考事件（按 messageId_agentId 存储）
            const cacheKey = `${chatRoomId}_${task.messageId}_${task.agentId}`;
            let events = streamEventsCache.get(cacheKey) || [];
            const lastCachedEvent = events[events.length - 1];

            if (lastCachedEvent?.type === 'thinking') {
              // 在同一个 thinking 事件内累加内容
              lastCachedEvent.content = (lastCachedEvent.content || '') + thinking;
            } else {
              // 创建新的思考事件
              const now = Date.now();
              events = events.map(e => ({ ...e, endTime: e.endTime ?? now }));
              events.push({
                id: `thinking-${now}`,
                type: 'thinking',
                content: thinking,
                timestamp: now,
              });
            }
            streamEventsCache.set(cacheKey, events);

            if (globalEmitThinking) {
              globalEmitThinking(
                { messageId: task.messageId, agentId: task.agentId, agentName: task.agentName, thinking },
                chatRoomId,
              );
            }
          };

          // 工具调用回调
          const toolCallCallback = (toolCall: ToolCall) => {
            markExecutionActivity();
            // 合并相同 toolCallId 的工具调用事件
            const execEventIndex = executionEvents.findIndex(
              e => e.type === 'tool_call' && e.data.toolCallId === toolCall.toolCallId
            );

            if (execEventIndex >= 0) {
              // 更新现有工具调用
              const existing = executionEvents[execEventIndex];
              existing.data.name = toolCall.name || existing.data.name;
              existing.data.input = toolCall.input || existing.data.input;
              existing.data.output = toolCall.output ?? existing.data.output;
              existing.data.status = toolCall.status || existing.data.status;
            } else {
              // 创建新的工具调用事件
              executionEvents.push({
                type: 'tool_call',
                timestamp: Date.now(),
                data: {
                  name: toolCall.name,
                  input: toolCall.input,
                  output: toolCall.output,
                  status: toolCall.status,
                  toolCallId: toolCall.toolCallId,
                },
              });
            }

            // 缓存工具调用事件（按 messageId_agentId 存储）
            const cacheKey = `${chatRoomId}_${task.messageId}_${task.agentId}`;
            let events = streamEventsCache.get(cacheKey) || [];

            // 查找是否已存在该工具调用
            const cachedEventIndex = events.findIndex(
              e => e.type === 'tool_call' && e.toolCall?.toolCallId === toolCall.toolCallId
            );

            const now = Date.now();
            if (cachedEventIndex >= 0) {
              // 更新现有工具调用
              events[cachedEventIndex] = {
                ...events[cachedEventIndex],
                toolCall,
                status: toolCall.status,
                endTime: (toolCall.status === 'completed' || toolCall.status === 'error') ? now : undefined,
              };
            } else {
              // 创建新的工具调用事件
              events = events.map(e => ({ ...e, endTime: e.endTime ?? now }));
              events.push({
                id: `tool-${toolCall.toolCallId || toolCall.name}`,
                type: 'tool_call',
                toolCall,
                status: toolCall.status,
                timestamp: now,
              });
            }
            streamEventsCache.set(cacheKey, events);

            if (globalEmitToolCall) {
              globalEmitToolCall(
                { messageId: task.messageId, agentId: task.agentId, agentName: task.agentName, toolCall },
                chatRoomId,
              );
            }
          };

          // 解析 attachments
          const attachments = taskQueueService.parseAttachments(task);

          // 获取 Bridge 信息，构建提示词注入
          const bridgeInfo = bridgeInfoCache.get(task.id);
          const bridgeContextSection = bridgeInfo?.platform === 'feishu' && bridgeInfo.externalId
            ? `\n\n当前飞书群聊Id: ${bridgeInfo.externalId}\n注意：用户消息来自飞书群聊，"当前群聊"指的是飞书群聊。你可以使用 lark-cli (飞书 CLI) 来完成用户在飞书群聊中的任务，如发送消息、搜索聊天记录、管理群成员等。`
            : '';

          // 执行任务，消息在 tool 调用时实时广播
          const startTime = Date.now();
          let execResult;
          let executionError: Error | null = null;
          let wasAborted = false;
          const primaryProviderId = executor.getDebugInfo().llmProvider?.id ?? null;
          const fallbackLlmProviders = await resolveFallbackLlmProviders(
            (agentInfo as { fallbackLlmProviderIds?: string | null } | null)?.fallbackLlmProviderIds,
            primaryProviderId,
          );
          const shouldUseModelFallback = fallbackLlmProviders.length > 0;
          let executionDebugExecutor = executor;

          const configuredNoActivityTimeoutMs = Number.isFinite(config.agent.executionNoActivityTimeoutMs)
            ? config.agent.executionNoActivityTimeoutMs
            : 0;
          const configuredNoActivityRetryCount = Number.isFinite(config.agent.executionNoActivityRetryCount)
            ? config.agent.executionNoActivityRetryCount
            : 0;
          const configuredNoActivityRetryDelayMs = Number.isFinite(config.agent.executionNoActivityRetryDelayMs)
            ? config.agent.executionNoActivityRetryDelayMs
            : 0;
          const noActivityTimeoutMs = task.agentId === GROUP_COORDINATOR_ID
            ? 0
            : Math.max(0, configuredNoActivityTimeoutMs);
          const noActivityRetryCount = task.agentId === GROUP_COORDINATOR_ID
            ? 0
            : Math.max(0, configuredNoActivityRetryCount);
          const noActivityRetryDelayMs = Math.max(0, configuredNoActivityRetryDelayMs);

          const runExecutor = async (
            candidateExecutor: IAgentExecutor,
            providerLabel: string,
            attempt: number,
            noActivityAttempt: number,
          ): Promise<AgentExecResult> => {
            const monitor = createNoActivityMonitor(
              noActivityTimeoutMs,
              (error) => abortController.abort(error),
              `${task.agentName} ${providerLabel} attempt ${attempt}.${noActivityAttempt}`,
            );
            activeNoActivityMonitor = monitor;
            monitor.start();
            try {
              return await candidateExecutor.exec(
                task.messageContent + ruleReminder + dispatchPlanReminder + bridgeContextSection,
                emitCallback,
                task.messageId,
                history,
                streamCallback,
                toolCallCallback,
                thinkingCallback,
                abortController.signal,
                attachments,  // 传递图片附件
                recordCallback,  // 记录工具调用前的中间文本段到执行详情
                shouldUseModelFallback ? { suppressFailureMessage: true } : undefined,
              );
            } catch (error) {
              if (monitor.didTimeout()) {
                throw monitor.getError();
              }
              throw error;
            } finally {
              monitor.stop();
              if (activeNoActivityMonitor === monitor) {
                activeNoActivityMonitor = null;
              }
            }
          };

          const runExecutorWithNoActivityRetry = async (
            candidateExecutor: IAgentExecutor,
            providerLabel: string,
            attempt: number,
          ): Promise<AgentExecResult> => {
            const maxNoActivityAttempts = noActivityRetryCount + 1;
            for (let noActivityAttempt = 1; noActivityAttempt <= maxNoActivityAttempts; noActivityAttempt += 1) {
              try {
                return await runExecutor(candidateExecutor, providerLabel, attempt, noActivityAttempt);
              } catch (error) {
                if (!(error instanceof NoActivityTimeoutError) || noActivityAttempt >= maxNoActivityAttempts) {
                  throw error;
                }

                executionEvents.push({
                  type: 'model',
                  timestamp: Date.now(),
                  data: {
                    type: 'retry',
                    providerName: providerLabel,
                    attempt,
                    error: `no_activity_timeout after ${noActivityTimeoutMs}ms (silent attempt ${noActivityAttempt})`,
                  },
                });
                console.warn('[processor] 助手执行长期无活动，准备重试当前 attempt', {
                  chatRoomId,
                  agentId: task.agentId,
                  agentName: task.agentName,
                  provider: providerLabel,
                  attempt,
                  noActivityAttempt,
                  timeoutMs: noActivityTimeoutMs,
                  retryDelayMs: noActivityRetryDelayMs,
                });

                resetAbortController();
                await sleepForNoActivityRetry(noActivityRetryDelayMs, abortController.signal);
              }
            }

            throw new NoActivityTimeoutError(`${task.agentName} no-activity retry loop exhausted`);
          };

          const runWithModelFallback = async (): Promise<AgentExecResult> => {
            const candidates: Array<{
              provider: LlmProvider | null;
              executor: IAgentExecutor;
            }> = [{ provider: null, executor }];

            for (const provider of shouldUseModelFallback ? fallbackLlmProviders : []) {
              const fallbackExecutor = await getExecutor(
                chatRoomId,
                task.agentName,
                task.sessionDir ?? undefined,
                provider,
              );
              if (fallbackExecutor) {
                candidates.push({ provider, executor: fallbackExecutor });
              }
            }

            let lastError: unknown;
            for (let index = 0; index < candidates.length; index += 1) {
              const candidate = candidates[index];
              const provider = candidate.provider ?? candidate.executor.getDebugInfo().llmProvider ?? null;
              const role = index === 0 ? 'primary' : 'fallback';
              const providerLabel = provider
                ? `${provider.name} (${provider.model})`
                : role === 'primary' ? 'primary' : 'fallback';
              const pushModelEvent = (
                status: 'in_progress' | 'completed' | 'error',
                attempt: number,
                extra: Record<string, unknown> = {},
              ) => {
                executionEvents.push({
                  type: 'model',
                  timestamp: Date.now(),
                  data: {
                    role,
                    attempt,
                    providerId: provider?.id ?? null,
                    providerName: provider?.name ?? providerLabel,
                    model: provider?.model,
                    status,
                    ...extra,
                  },
                });
              };

              try {
                pushModelEvent('in_progress', 1);
                const result = await runExecutorWithNoActivityRetry(candidate.executor, providerLabel, 1);
                pushModelEvent('completed', 1, { model: result.model ?? provider?.model });
                executionDebugExecutor = candidate.executor;
                return result;
              } catch (firstError) {
                if (firstError instanceof Error && firstError.name === 'AbortError') throw firstError;
                lastError = firstError;
                pushModelEvent('error', 1, {
                  error: firstError instanceof Error ? firstError.message : String(firstError),
                });
                if (!shouldUseModelFallback) {
                  throw firstError;
                }
                debugLog('agentModelAttemptFailed', {
                  chatRoomId,
                  agentId: task.agentId,
                  agentName: task.agentName,
                  provider: providerLabel,
                  attempt: 1,
                  error: firstError instanceof Error ? firstError.message : String(firstError),
                });
              }

              try {
                pushModelEvent('in_progress', 2);
                const result = await runExecutorWithNoActivityRetry(candidate.executor, providerLabel, 2);
                pushModelEvent('completed', 2, { model: result.model ?? provider?.model });
                executionDebugExecutor = candidate.executor;
                return result;
              } catch (secondError) {
                if (secondError instanceof Error && secondError.name === 'AbortError') throw secondError;
                const sameError = normalizeExecutionError(secondError) === normalizeExecutionError(lastError);
                const willSwitch = sameError && index < candidates.length - 1;
                pushModelEvent('error', 2, {
                  sameError,
                  willSwitch,
                  error: secondError instanceof Error ? secondError.message : String(secondError),
                });
                debugLog('agentModelAttemptFailed', {
                  chatRoomId,
                  agentId: task.agentId,
                  agentName: task.agentName,
                  provider: providerLabel,
                  attempt: 2,
                  sameError,
                  error: secondError instanceof Error ? secondError.message : String(secondError),
                });
                lastError = secondError;
                if (!willSwitch) {
                  throw secondError;
                }
                const nextProvider = candidates[index + 1]?.provider;
                executionEvents.push({
                  type: 'model',
                  timestamp: Date.now(),
                  data: {
                    type: 'switch',
                    from: providerLabel,
                    to: nextProvider ? `${nextProvider.name} (${nextProvider.model})` : 'unknown',
                  },
                });
                debugLog('agentModelFallbackSwitch', {
                  chatRoomId,
                  agentId: task.agentId,
                  agentName: task.agentName,
                  from: providerLabel,
                  to: nextProvider ? `${nextProvider.name} (${nextProvider.model})` : 'unknown',
                });
              }
            }

            throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '未知错误'));
          };

          try {
            execResult = await runWithModelFallback();
          } catch (error) {
            // 检查是否是中止错误
            if (error instanceof Error && error.name === 'AbortError') {
              wasAborted = true;
              console.log(`Task aborted for agent ${task.agentName}`);
              executionError = new Error('执行已被用户中断');
            } else {
              executionError = error instanceof Error ? error : new Error(String(error));
              console.error(
                `Task execution failed for agent ${task.agentName}:`,
                error,
              );
              if (shouldUseModelFallback) {
                try {
                  await emitCallback(`${task.agentName} 执行出错: ${executionError.message}`, task.messageId);
                } catch (emitError) {
                  console.error('[processor] 发送最终失败消息时出错:', emitError);
                }
              }
            }
          }

          // 群规则注入记录：仅在本棒成功执行（未中断、未报错）后提交，
          // 确保「规则变更棒」真正把全文喂给了模型后，后续棒才改用短提醒。
          if (!executionError && !wasAborted) {
            injectedRoomRulesCache.set(ruleReminderKey, roomRulesForReminder);
          }

          // 清理 AbortController
          abortControllers.delete(key);

          // 清除流式事件缓存（任务已完成，按 messageId_agentId 存储）
          const streamCacheKey = `${chatRoomId}_${task.messageId}_${task.agentId}`;
          streamEventsCache.delete(streamCacheKey);

          // 清除 Bridge 信息缓存
          bridgeInfoCache.delete(task.id);

          if (discardExecutionResultKeys.delete(key)) {
            console.log(`[processor] 已丢弃清理期间结束的执行结果: ${key}`);
            continue;
          }

          // 获取执行器的调试信息
          const debugInfo = executionDebugExecutor.getDebugInfo();

          // 按时间戳排序事件
          executionEvents.sort((a, b) => a.timestamp - b.timestamp);
          const executionModels = collectExecutionModels(executionEvents, execResult?.model);

          const cancellationLocale = abortLocales.get(key);
          abortLocales.delete(key);
          const cancellationMessageContent = getSystemMessage('taskCancelledByUser', cancellationLocale);
          if (wasAborted) {
            executionEvents.push({
              type: 'output',
              timestamp: Date.now(),
              data: { content: cancellationMessageContent, type: 'message' },
            });
          }

          // 保存执行记录（中断也算完成，只是状态不同）
          const execRecord = await executionRecordService.create({
            chatRoomId,
            agentId: task.agentId,
            agentName: task.agentName,
            triggerMessage: task.messageContent,
            triggerUser: undefined, // 暂时不记录触发用户
            events: executionEvents,
            context: debugInfo.lastContext || undefined,
            systemPrompt: debugInfo.systemPrompt,
            status: wasAborted ? 'cancelled' : (executionError ? 'failed' : 'completed'),
            errorMessage: wasAborted ? undefined : executionError?.message,
            duration: Date.now() - startTime,
            // Token 使用字段
            llmProviderId: debugInfo.llmProvider?.id,
            inputTokens: execResult?.tokenUsage?.inputTokens,
            outputTokens: execResult?.tokenUsage?.outputTokens,
            totalTokens: execResult?.tokenUsage?.totalTokens,
            cacheReadTokens: execResult?.tokenUsage?.cacheReadTokens,
            cacheCreationTokens: execResult?.tokenUsage?.cacheCreationTokens,
          });
          taskOutcome = wasAborted ? 'cancelled' : (executionError ? 'failed' : 'completed');

          // 如果任务失败（非中断），通知来源助手
          if (!wasAborted && executionError) {
            try {
              await notifySourceAgentOnFailure({
                task,
                errorMessage: executionError.message,
                executionRecordId: execRecord.id,
                chatRoomId,
              });
            } catch (notificationError) {
              console.error('[processor] 发送失败通知时出错:', notificationError);
            }
          }

          if (wasAborted) {
            const cancelledMessage = await buildAIMessage(
              cancellationMessageContent,
              task.messageId,
              task.agentName,
              task.agentId,
              chatRoomId,
              agentInfo?.avatar,
              agentInfo?.avatarColor,
            );
            cancelledMessage.executionRecordId = execRecord.id;
            cancelledMessage.executionDuration = execRecord.duration ?? null;
            cancelledMessage.totalTokens = execRecord.totalTokens ?? null;
            cancelledMessage.cacheReadTokens = execRecord.cacheReadTokens ?? null;
            cancelledMessage.model = executionModels;
            cancelledMessage.taskQueueId = task.id;

            await messageService.create({
              id: cancelledMessage.id,
              type: 'REPLY',
              content: cancelledMessage.content,
              time: cancelledMessage.time,
              agentId: task.agentId,
              chatRoomId,
              replyMessageId: cancelledMessage.replyMessageId || null,
              isHuman: false,
              executionRecordId: execRecord.id,
            });
            generatedMessageIds.push(cancelledMessage.id);
            taskFinalMessage = cancelledMessage;

            if (globalEmit) {
              await globalEmit(cancelledMessage, chatRoomId);
            }
          }

          // 回填 executionRecordId 到所有生成的消息
          if (generatedMessageIds.length > 0) {
            await messageService.updateExecutionRecordId(
              generatedMessageIds,
              execRecord.id,
              execRecord.duration ?? undefined,
              execRecord.totalTokens ?? undefined,
              execRecord.cacheReadTokens ?? undefined,
              executionModels,
            );
            debugLog('executionRecordIdBackfilled', {
              chatRoomId,
              executionRecordId: execRecord.id,
              messageIds: generatedMessageIds,
              duration: execRecord.duration,
              totalTokens: execRecord.totalTokens,
              cacheReadTokens: execRecord.cacheReadTokens,
            });
          }

          // 更新恢复服务状态，记录执行结果
          recoveryService.updateRoomState(chatRoomId, task.agentName, false, execResult);

          // 任务执行完成（包括被中断），通知前端（包含 executionRecordId 和 token 信息）
          if (globalEmitDone) {
            globalEmitDone(
              {
                agentId: task.agentId,
                agentName: task.agentName,
                triggerMessageId: task.messageId,
                executionRecordId: execRecord.id,
                messageIds: generatedMessageIds,
                duration: execRecord.duration ?? undefined,
                totalTokens: execRecord.totalTokens ?? undefined,
                cacheReadTokens: execRecord.cacheReadTokens ?? undefined,
                model: executionModels ?? undefined,
              },
              chatRoomId,
            );
          }
        }
      } catch (error) {
        // 清理 AbortController
        abortControllers.delete(key);
        // 出错时停止外部平台输入状态循环
        stopTypingLoop(chatRoomId);
        console.error(
          `Task execution failed for agent ${task.agentName}:`,
          error,
        );
      } finally {
        taskExecutionStartedAt.delete(task.id);

        // 删除已处理的任务
        await taskQueueService.delete(task.id);

        try {
          await notifyAgentTaskSettled({
            chatRoomId,
            taskId: task.id,
            agentId: task.agentId,
            status: taskOutcome,
            finalMessage: taskFinalMessage,
          });
        } catch (error) {
          console.error('[processor] 处理任务完成生命周期事件失败:', error);
        }

        // 任务完成后广播任务队列更新（通知前端移除已完成的任务）
        if (globalEmitStatus) {
          // 获取最新的任务队列并广播
          const tasks = await taskQueueService.getAgentQueue(chatRoomId, task.agentId);
          const taskList = tasks.map(t => ({
            id: t.id,
            messageId: t.messageId,
            messageContent: t.messageContent,
            status: t.status,
            createdAt: t.createdAt.toISOString(),
          }));
          // 通过 socket 广播任务队列更新
          broadcastAgentTaskQueue(chatRoomId, task.agentId, taskList);
        }

        // 任务完成后立即广播状态更新（队列长度变化，可能从 busy 变成 executing）
        broadcastAgentStatus(chatRoomId);

        // 工作台任务自动状态流转：统一为「群内空闲时流转」判定，不再按触发模式区分。
        // 协调器裁决路径（coordinator-dispatch.ts 的 syncWorkbenchOnRoomIdle）语义一致、幂等。
        try {
          const roomActiveTasks = await taskQueueService.getActiveTasks(chatRoomId);
          await workbenchTaskService.syncRoomDispatchTaskStatus(chatRoomId, roomActiveTasks.length === 0);
        } catch (error) {
          console.error('[workbench] 同步派发任务状态失败:', error);
        }
      }
    }
  } finally {
    // 标记处理完成
    processingMap.set(key, false);
    recoveryService.setProcessingState(chatRoomId, false);

    // 清理 AbortController（以防万一）
    abortControllers.delete(key);

    // 重要：再次检查队列，防止在处理期间有新任务入队
    // 这确保不会遗漏任何任务
    const remainingTask = await taskQueueService.peek(chatRoomId, agentId);
    if (remainingTask) {
      // 有新任务，递归处理
      processQueue(chatRoomId, agentId);
    } else {
      // 队列清空，广播状态变化（agent finished executing）
      broadcastAgentStatus(chatRoomId, [agentId]);
    }
  }
}

// 恢复服务启动时未处理的任务
export async function recoverPendingTasks() {
  const pendingTasks = await taskQueueService.getAllPending();
  if (pendingTasks.length === 0) return;

  console.log(`恢复 ${pendingTasks.length} 个未处理任务`);

  // 按 chatRoomId_agentId 分组
  const grouped = new Map<string, typeof pendingTasks>();
  for (const task of pendingTasks) {
    const key = `${task.chatRoomId}_${task.agentId}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(task);
  }

  // 触发每个队列的处理
  for (const [key, tasks] of grouped) {
    const [chatRoomId, agentId] = key.split('_');
    if (tasks.length > 0) {
      processQueue(chatRoomId, agentId);
    }
  }
}
