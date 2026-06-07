import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test } from 'node:test';
import prisma from '../../../lib/prisma.js';
import { backgroundCommandService } from '../../../core/shell/background-command.service.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 轮询读取后台命令输出，直到命中预期内容或超时，避免固定 sleep 在慢环境下抖动。
async function readUntilMatch(
  taskId: string,
  pattern: RegExp,
  { timeoutMs = 3000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let stdoutTail = '';
  while (Date.now() < deadline) {
    const output = await backgroundCommandService.read(taskId, 'test-room', 'test-agent');
    stdoutTail = output.stdoutTail || '';
    if (pattern.test(stdoutTail)) return stdoutTail;
    await sleep(intervalMs);
  }
  return stdoutTail;
}

describe('backgroundCommandService', () => {
  test('starts, reads, and stops a long-running command', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-bg-test-'));
    const code = "console.log('service-ready'); setInterval(() => console.log('service-tick'), 100);";
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
    let taskId: string | undefined;

    try {
      const task = await backgroundCommandService.start({
        chatRoomId: 'test-room',
        agentId: 'test-agent',
        agentName: 'Test Agent',
        command,
        workDir,
      });
      taskId = task.id;

      assert.equal(task.state, 'backgrounded');
      assert.equal(task.command, command);
      assert.equal(task.workDir, workDir);

      const stdoutTail = await readUntilMatch(task.id, /service-ready/);
      assert.match(stdoutTail, /service-ready/);

      const stopped = await backgroundCommandService.stop(task.id, 'test-room', 'test-agent');
      assert.equal(stopped.state, 'killed');
      assert.equal(stopped.exitCode, 137);
    } finally {
      if (taskId) {
        await prisma.backgroundTask.delete({where: {id: taskId}}).catch(() => undefined);
      }
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });

  test('passes custom environment variables to background commands', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-bg-env-test-'));
    const code = "console.log(process.env.TEAMAGENTX_ENV_TEST || 'missing')";
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
    let taskId: string | undefined;

    try {
      const task = await backgroundCommandService.start({
        chatRoomId: 'test-room',
        agentId: 'test-agent',
        agentName: 'Test Agent',
        command,
        workDir,
        env: {
          ...process.env,
          TEAMAGENTX_ENV_TEST: 'present',
        },
      });
      taskId = task.id;

      const stdoutTail = await readUntilMatch(task.id, /present/);
      assert.match(stdoutTail, /present/);
    } finally {
      if (taskId) {
        await prisma.backgroundTask.delete({where: {id: taskId}}).catch(() => undefined);
      }
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });
});
