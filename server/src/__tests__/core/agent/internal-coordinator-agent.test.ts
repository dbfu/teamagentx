import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_COORDINATOR_AGENT_NAME,
  INTERNAL_COORDINATOR_NO_DISPATCH_RESPONSE,
  INTERNAL_COORDINATOR_NO_SUITABLE_ASSISTANT,
  INTERNAL_COORDINATOR_SYSTEM_MANAGEMENT,
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
  test('prompt uses dispatch_decision tool for all decisions', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.ok(prompt.length < 2100);
    assert.match(prompt, /dispatch_decision 工具/);
    assert.match(prompt, /禁止输出纯文本/);
    assert.doesNotMatch(prompt, /无需调度：一句话原因/);
    // All four decision types are present
    assert.match(prompt, /no_dispatch/);
    assert.match(prompt, /ask_owner/);
    assert.match(prompt, /cannot_dispatch/);
  });

  test('prompt limits the coordinator to dispatching only', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /你只负责路由/);
    assert.match(prompt, /不要分析问题、解释原因、给方案、下结论或评价任务本身/);
    assert.match(prompt, /dispatch_decision 工具/);
  });

  test('prompt uses forwardVerbatim instead of text copy constraints', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /forwardVerbatim/);
    assert.match(prompt, /原文发送给目标助手/);
    assert.match(prompt, /不要添加与原始目标无关的新需求/);
  });

  test('prompt supports multiple parallel targetAgentIds', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /targetAgentIds/);
    assert.match(prompt, /可多个（并行）/);
    assert.match(prompt, /必须等所有被并行调度的助手都明确完成各自任务后/);
    assert.match(prompt, /才能调度下一个阶段任务/);
  });

  test('prompt requires ask_owner for human confirmation', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /需要人类用户回答问题或确认事项/);
    assert.match(prompt, /ask_owner/);
    assert.match(prompt, /涉及群主\/admin 的选择、确认、授权、验收或偏好/);
    assert.match(prompt, /不要替群主做决定/);
    assert.match(prompt, /必须 ask_owner，让用户回答/);
    assert.match(prompt, /不要为了提问或确认而 @其他人类成员/);
    assert.match(prompt, /不要把需要用户回答或确认的问题设为 no_dispatch/);
    assert.match(prompt, /必须先 ask_owner 提问/);
    assert.match(prompt, /用户回答或确认后，再 dispatch 合适的助手处理/);
    assert.match(prompt, /回答你刚刚转发给群主的问题时，调度回原始提问的业务助手/);
  });

  test('prompt requires preserving forwarded question formatting for the owner', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /转发助手提出的问题或确认事项给群主/);
    assert.match(prompt, /Markdown 格式、换行、列表、选项编号和代码块/);
    assert.match(prompt, /不要压缩成一句话、不要改成纯文本摘要/);
  });

  test('prompt uses no_dispatch to block next phase until all parallel tasks finish', () => {
    const prompt = buildInternalCoordinatorPrompt();

    assert.match(prompt, /上一阶段并行任务中有任一助手尚未完成/);
    assert.match(prompt, /不能 dispatch 下一阶段/);
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
    // English sentinels (with trailing punctuation/whitespace) are also suppressed.
    assert.equal(
      shouldSuppressInternalCoordinatorMessage(
        GROUP_COORDINATOR_ID,
        `${INTERNAL_COORDINATOR_NO_SUITABLE_ASSISTANT}\n`,
      ),
      true,
    );
    assert.equal(
      shouldSuppressInternalCoordinatorMessage(
        GROUP_COORDINATOR_ID,
        `${INTERNAL_COORDINATOR_SYSTEM_MANAGEMENT}.`,
      ),
      true,
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
