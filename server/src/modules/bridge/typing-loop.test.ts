import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerTypingLoopClearer,
  registerTypingLoopSender,
  startTypingLoop,
  stopTypingLoop,
} from './typing-loop.js';

test('stopTypingLoop clears stale platform indicator when an in-flight send finishes after stop', async () => {
  const roomId = 'typing-loop-race-room';
  const calls: string[] = [];

  let releaseSend!: () => void;
  const sendStarted = new Promise<void>((resolve) => {
    registerTypingLoopSender(async (chatRoomId) => {
      calls.push(`send:${chatRoomId}`);
      resolve();
      await new Promise<void>((release) => {
        releaseSend = release;
      });
      calls.push(`sent:${chatRoomId}`);
    });
  });

  registerTypingLoopClearer(async (chatRoomId) => {
    calls.push(`clear:${chatRoomId}`);
  });

  const startPromise = startTypingLoop(roomId);
  await sendStarted;

  stopTypingLoop(roomId);
  releaseSend();
  await startPromise;

  assert.deepEqual(calls, [
    `send:${roomId}`,
    `clear:${roomId}`,
    `sent:${roomId}`,
    `clear:${roomId}`,
  ]);
});
