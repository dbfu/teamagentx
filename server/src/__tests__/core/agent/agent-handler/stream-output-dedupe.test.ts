import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStreamRecordedOutput } from '../../../../core/agent/agent-handler/processor.js';

test('recorded output is not streamed again after a tool call closes the stream segment', () => {
  const events = [
    {
      id: 'output-1',
      type: 'output',
      content: '好的，执行打包流程：',
      timestamp: 1,
      endTime: 2,
    },
    {
      id: 'tool-run_shell_command',
      type: 'tool_call',
      timestamp: 2,
    },
  ];

  assert.equal(shouldStreamRecordedOutput(events, ' 好的，执行打包流程：\n'), false);
});

test('recorded output is streamed when no matching output event exists', () => {
  const events = [
    {
      id: 'output-1',
      type: 'output',
      content: '开始处理',
      timestamp: 1,
      endTime: 2,
    },
  ];

  assert.equal(shouldStreamRecordedOutput(events, '打包成功'), true);
});
