import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_COORDINATOR_AGENT_NAME,
  INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE,
  buildInternalCoordinatorPrompt,
  shouldSuppressInternalCoordinatorMessage,
} from '../../../core/agent/internal-coordinator-agent.js';
import { GROUP_COORDINATOR_ID } from '../../../core/agent/system-assistant.constants.js';
import type { IAgentExecutor } from '../../../core/agent/executor.interface.js';
import {
  executorCache,
  getCacheKey,
  processQueue,
  processingMap,
} from '../../../core/agent/agent-handler/index.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { executionRecordService } from '../../../modules/execution-record/execution-record.service.js';
import { agentService } from '../../../core/agent/agent.service.js';

const originalTaskQueue = {
  peek: taskQueueService.peek,
  updateStatus: taskQueueService.updateStatus,
  parseHistory: taskQueueService.parseHistory,
  parseAttachments: taskQueueService.parseAttachments,
  delete: taskQueueService.delete,
  getAgentQueue: taskQueueService.getAgentQueue,
};
const originalMessageCreate = messageService.create;
const originalMessageUpdateExecutionRecordId = messageService.updateExecutionRecordId;
const originalExecutionRecordCreate = executionRecordService.create;
const originalAgentFindById = agentService.findById;

afterEach(() => {
  taskQueueService.peek = originalTaskQueue.peek;
  taskQueueService.updateStatus = originalTaskQueue.updateStatus;
  taskQueueService.parseHistory = originalTaskQueue.parseHistory;
  taskQueueService.parseAttachments = originalTaskQueue.parseAttachments;
  taskQueueService.delete = originalTaskQueue.delete;
  taskQueueService.getAgentQueue = originalTaskQueue.getAgentQueue;
  messageService.create = originalMessageCreate;
  messageService.updateExecutionRecordId = originalMessageUpdateExecutionRecordId;
  executionRecordService.create = originalExecutionRecordCreate;
  agentService.findById = originalAgentFindById;
  executorCache.delete(getCacheKey('room-1', INTERNAL_COORDINATOR_AGENT_NAME));
  processingMap.delete(`room-1_${GROUP_COORDINATOR_ID}`);
});

describe('internal coordinator no-dispatch handling', () => {
  test('prompt forces an exact no-dispatch sentinel', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /最终回复必须只包含这四个字：无需调度/);
    assert.match(prompt, /不要添加原因、标点、换行或任何其他文字/);
    assert.doesNotMatch(prompt, /无需调度：一句话原因/);
  });

  test('prompt forbids expanding human user messages during dispatch', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /用户原始消息全文/);
    assert.match(prompt, /不要扩写、总结、解释、拆解、补充验收标准/);
    assert.match(prompt, /添加分支\/提交\/PR\/发布等操作/);
    assert.match(prompt, /用户没有明确说出的内容，不能出现在你的调度消息里/);
    assert.match(prompt, /不得添加、删除、改写任何内容/);
  });

  test('prompt requires mentioning the chatroom owner for human answers', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /需要人类用户回答问题或确认事项/);
    assert.match(prompt, /最终回复必须提及群主/);
    assert.match(prompt, /不要为了提问或确认而 @其他人类成员/);
    assert.match(prompt, /不要把需要用户回答或确认的问题输出为“无需调度”/);
  });

  test('suppresses only exact internal coordinator no-dispatch output', () => {
    assert.equal(
      shouldSuppressInternalCoordinatorMessage(
        GROUP_COORDINATOR_ID,
        ` ${INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE}\n`,
      ),
      true,
    );
    assert.equal(
      shouldSuppressInternalCoordinatorMessage(GROUP_COORDINATOR_ID, '无需调度：等待用户确认'),
      false,
    );
    assert.equal(
      shouldSuppressInternalCoordinatorMessage('normal-agent', INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE),
      false,
    );
  });

  test('does not save or emit coordinator no-dispatch output as a group message', async () => {
    const chatRoomId = 'room-1';
    const task = {
      id: 'task-1',
      chatRoomId,
      agentId: GROUP_COORDINATOR_ID,
      agentName: INTERNAL_COORDINATOR_AGENT_NAME,
      messageId: 'message-1',
      messageContent: '收到',
      history: null,
      sessionDir: null,
      attachments: null,
      status: 'pending',
      createdAt: new Date(),
    };
    let peekCount = 0;
    let messageCreateCalls = 0;
    let updateExecutionRecordCalls = 0;
    let executionRecordPayload: any;

    taskQueueService.peek = (async () => {
      peekCount += 1;
      return peekCount === 1 ? task : null;
    }) as typeof taskQueueService.peek;
    taskQueueService.updateStatus = (async () => task) as typeof taskQueueService.updateStatus;
    taskQueueService.parseHistory = (() => undefined) as typeof taskQueueService.parseHistory;
    taskQueueService.parseAttachments = (() => undefined) as typeof taskQueueService.parseAttachments;
    taskQueueService.delete = (async () => undefined) as typeof taskQueueService.delete;
    taskQueueService.getAgentQueue = (async () => []) as typeof taskQueueService.getAgentQueue;
    messageService.create = (async () => {
      messageCreateCalls += 1;
      throw new Error('no-dispatch output should not be saved');
    }) as typeof messageService.create;
    messageService.updateExecutionRecordId = (async () => {
      updateExecutionRecordCalls += 1;
    }) as unknown as typeof messageService.updateExecutionRecordId;
    executionRecordService.create = (async (data) => {
      executionRecordPayload = data;
      return {
        id: 'exec-1',
        duration: data.duration ?? 1,
        totalTokens: data.totalTokens ?? null,
        cacheReadTokens: data.cacheReadTokens ?? null,
      };
    }) as typeof executionRecordService.create;
    agentService.findById = (async () => null) as typeof agentService.findById;

    const executor: IAgentExecutor = {
      name: INTERNAL_COORDINATOR_AGENT_NAME,
      chatRoomId,
      injectGroupHistory: false,
      async exec(_message, emit, originalMessageId) {
        await emit(INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE, originalMessageId);
        return {
          actions: [{ type: 'message', content: INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE }],
        };
      },
      getDebugInfo() {
        return {
          name: INTERNAL_COORDINATOR_AGENT_NAME,
          systemPrompt: 'test prompt',
          lastContext: null,
          lastHistory: null,
          chatRoomId,
          injectGroupHistory: false,
          type: 'acp',
        };
      },
      setLastInjectedMessageId() {
        // Test executor does not maintain incremental history state.
      },
    };
    executorCache.set(getCacheKey(chatRoomId, INTERNAL_COORDINATOR_AGENT_NAME), executor);

    await processQueue(chatRoomId, GROUP_COORDINATOR_ID);

    assert.equal(messageCreateCalls, 0);
    assert.equal(updateExecutionRecordCalls, 0);
    assert.equal(executionRecordPayload.status, 'completed');
    assert.equal(executionRecordPayload.events.length, 1);
    assert.equal(
      executionRecordPayload.events[0].data.content,
      INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE,
    );
  });
});
