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

      await sleep(350);
      const output = await backgroundCommandService.read(task.id, 'test-room', 'test-agent');
      assert.match(output.stdoutTail || '', /service-ready/);

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

      await sleep(150);
      const output = await backgroundCommandService.read(task.id, 'test-room', 'test-agent');
      assert.match(output.stdoutTail || '', /present/);
    } finally {
      if (taskId) {
        await prisma.backgroundTask.delete({where: {id: taskId}}).catch(() => undefined);
      }
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });
});
