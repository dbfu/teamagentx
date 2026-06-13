import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NoActivityTimeoutError,
  createNoActivityMonitor,
  sleepForNoActivityRetry,
} from '../../../../core/agent/agent-handler/no-activity-timeout.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('no-activity monitor fires when no activity is recorded', async () => {
  const captured: NoActivityTimeoutError[] = [];
  const monitor = createNoActivityMonitor(5, (error) => {
    captured.push(error);
  }, 'assistant');

  monitor.start();
  await wait(20);

  assert.equal(monitor.didTimeout(), true);
  assert.equal(captured[0]?.name, 'NoActivityTimeoutError');
  assert.match(captured[0]?.message ?? '', /assistant did not produce any activity/);
});

test('no-activity monitor is cancelled by first activity', async () => {
  let fired = false;
  const monitor = createNoActivityMonitor(10, () => {
    fired = true;
  }, 'assistant');

  monitor.start();
  monitor.markActivity();
  await wait(20);

  assert.equal(fired, false);
  assert.equal(monitor.didTimeout(), false);
});

test('no-activity retry sleep observes abort signal', async () => {
  const controller = new AbortController();
  const pending = sleepForNoActivityRetry(50, controller.signal);
  controller.abort(new Error('cancelled'));

  await assert.rejects(pending, /cancelled/);
});
