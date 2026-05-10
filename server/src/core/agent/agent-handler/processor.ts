import type { ToolCall } from '../executor.interface.js';
import { taskQueueService, type HistoryMessage } from '../../../modules/task-queue/task-queue.service.js';
import { agentMemoryService } from '../../../modules/agent-memory/agent-memory.service.js';
import { executionRecordService, type ExecutionEvent } from '../../../modules/execution-record/execution-record.service.js';
import { recoveryService } from '../../../modules/recovery/recovery.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { userService } from '../../../modules/user/user.service.js';
import { todoService } from '../../../modules/todo/todo.service.js';
import { agentService } from '../agent.service.js';
import {
  processingMap,
  abortControllers,
  streamEventsCache,
} from './cache.js';
import {
  globalEmit,
  globalEmitTyping,
  globalEmitDone,
  globalEmitStream,
  globalEmitToolCall,
  globalEmitThinking,
  globalEmitStatus,
  globalBroadcastTaskQueue,
  globalEmitTodoCreated,
  broadcastAgentStatus,
  broadcastAgentTaskQueue,
} from './status.js';
import { getExecutor } from './executor-manager.js';
import { buildAIMessage } from './message-utils.js';
import { debugLog } from './debug.js';

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

      // 发送 typing 事件（让前端初始化流式面板）
      if (globalEmitTyping) {
        globalEmitTyping(
          { messageId: task.messageId, agentId: task.agentId, agentName: task.agentName, status: 'executing' },
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

      try {
        // 创建 AbortController 用于中断执行
        const abortController = new AbortController();
        abortControllers.set(key, abortController);

        // 获取执行器；sessionDir 只在显式指定运行目录时传入。
        const executor = await getExecutor(chatRoomId, task.agentName, task.sessionDir ?? undefined);
        if (executor) {
          // 使用入队时保存的历史消息，如果没有则获取当前历史
          let history: HistoryMessage[] | undefined = taskQueueService.parseHistory(task);

          // 只有当任务没有保存历史且配置了注入群历史时，才构建摘要 + 最近消息上下文
          if (!history && executor.injectGroupHistory) {
            history = await agentMemoryService.buildHistory(chatRoomId, task.agentId, task.messageId);
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

          // 收集生成的消息 ID，用于后续回填 executionRecordId
          const generatedMessageIds: string[] = [];

          // 收集执行事件（用于保存到 ExecutionRecord）
          const executionEvents: ExecutionEvent[] = [];

          // 创建 emit 回调，在 tool 调用时直接广播消息
          const emitCallback = async (content: string, replyMessageId?: string) => {
            // 合并连续的 output 事件
            const lastEvent = executionEvents[executionEvents.length - 1];
            if (lastEvent && lastEvent.type === 'output') {
              // 在同一个 output 事件内累加内容
              lastEvent.data.content = (lastEvent.data.content || '') + content;
            } else {
              // 创建新的 output 事件
              executionEvents.push({
                type: 'output',
                timestamp: Date.now(),
                data: { content, type: 'message' },
              });
            }

            const aiMessage = buildAIMessage(
              content,
              replyMessageId || null,
              task.agentName,
              task.agentId,
              chatRoomId,
              agentInfo?.avatar,
              agentInfo?.avatarColor,
            );

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

            // 检查是否需要创建待办（助手 @群主）
            try {
              const chatRoom = await chatRoomService.findById(chatRoomId);
              if (chatRoom?.ownerId) {
                const ownerUser = await userService.findById(chatRoom.ownerId);
                if (ownerUser) {
                  // 检查消息内容是否 @群主
                  const mentionRegex = new RegExp(`(?:^|\\s|[*_>#\\-])@${ownerUser.username}(?=\\s|$)`);
                  if (mentionRegex.test(content)) {
                    // 检查是否已存在该消息的待办（避免重复创建）
                    const existingTodo = await todoService.getByMessageId(aiMessage.id);
                    if (!existingTodo) {
                      // 创建待办
                      const todo = await todoService.create({
                        chatRoomId,
                        messageId: aiMessage.id,
                        triggerAgentId: task.agentId,
                        ownerUserId: chatRoom.ownerId,
                        contentSummary: content.slice(0, 100),
                      });

                      // 广播待办创建事件给群主
                      if (globalEmitTodoCreated) {
                        globalEmitTodoCreated({
                          id: todo.id,
                          chatRoomId,
                          messageId: aiMessage.id,
                          triggerAgentId: task.agentId,
                          triggerAgentName: task.agentName,
                          ownerUserId: chatRoom.ownerId,
                          contentSummary: content.slice(0, 100),
                          chatRoomName: chatRoom.name,
                          status: 'pending',
                          createdAt: todo.createdAt,
                        }, chatRoom.ownerId);
                      }

                      debugLog('todoCreated', {
                        chatRoomId,
                        messageId: aiMessage.id,
                        todoId: todo.id,
                        ownerUserId: chatRoom.ownerId,
                        ownerUsername: ownerUser.username,
                      });
                    }
                  }
                }
              }
            } catch (todoError) {
              console.error('Failed to check/create todo:', todoError);
              // 待办创建失败不影响消息发送
            }

            // 更新恢复服务状态（Agent 发送了消息）
            recoveryService.updateRoomState(chatRoomId, task.agentName);
          };

          // 流式内容回调
          const streamCallback = (content: string) => {
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
          const thinkingCallback = (thinking: string) => {
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

          // 执行任务，消息在 tool 调用时实时广播
          const startTime = Date.now();
          let execResult;
          let executionError: Error | null = null;
          let wasAborted = false;

          try {
            execResult = await executor.exec(
              task.messageContent,
              emitCallback,
              task.messageId,
              history,
              streamCallback,
              toolCallCallback,
              thinkingCallback,
              abortController.signal,
              attachments,  // 传递图片附件
            );
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
            }
          }

          // 清理 AbortController
          abortControllers.delete(key);

          // 清除流式事件缓存（任务已完成，按 messageId_agentId 存储）
          const streamCacheKey = `${chatRoomId}_${task.messageId}_${task.agentId}`;
          streamEventsCache.delete(streamCacheKey);

          // 获取执行器的调试信息
          const debugInfo = executor.getDebugInfo();

          // 按时间戳排序事件
          executionEvents.sort((a, b) => a.timestamp - b.timestamp);

          const cancellationMessageContent = '任务已被用户手动取消';
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

          if (wasAborted) {
            const cancelledMessage = buildAIMessage(
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
              },
              chatRoomId,
            );
          }
        }
      } catch (error) {
        // 清理 AbortController
        abortControllers.delete(key);
        console.error(
          `Task execution failed for agent ${task.agentName}:`,
          error,
        );
      } finally {
        // 删除已处理的任务
        await taskQueueService.delete(task.id);

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
      broadcastAgentStatus(chatRoomId);
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
