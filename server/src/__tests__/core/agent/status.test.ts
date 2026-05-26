import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../../../lib/prisma.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { GROUP_COORDINATOR_ID } from '../../../core/agent/system-assistant.constants.js';
import { processingMap } from '../../../core/agent/agent-handler/cache.js';
import { getAgentStatuses } from '../../../core/agent/agent-handler/status.js';

describe('agent status aggregation', () => {
  const chatRoomId = 'status-hidden-agent-room';

  beforeEach(async () => {
    processingMap.clear();
    await prisma.taskQueue.deleteMany({ where: { chatRoomId } });
  });

  afterEach(async () => {
    processingMap.clear();
    await prisma.taskQueue.deleteMany({ where: { chatRoomId } });
  });

  test('includes hidden active coordinator tasks in room statuses', async () => {
    const task = await taskQueueService.enqueue({
      chatRoomId,
      agentId: GROUP_COORDINATOR_ID,
      agentName: '群调度助手',
      messageId: 'message-1',
      messageContent: '需要协调的消息',
    });

    await taskQueueService.updateStatus(task.id, 'executing');
    processingMap.set(`${chatRoomId}_${GROUP_COORDINATOR_ID}`, true);

    const statuses = await getAgentStatuses(chatRoomId);

    assert.equal(statuses.get(GROUP_COORDINATOR_ID), 'executing');
  });

  test('can explicitly include hidden coordinator as idle after its task is gone', async () => {
    const statuses = await getAgentStatuses(chatRoomId, [GROUP_COORDINATOR_ID]);

    assert.equal(statuses.get(GROUP_COORDINATOR_ID), 'idle');
  });
});
