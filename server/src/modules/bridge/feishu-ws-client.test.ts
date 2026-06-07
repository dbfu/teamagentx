import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFeishuMessageTimestamp } from './feishu-ws-client.js';

test('parseFeishuMessageTimestamp accepts millisecond and second timestamps', () => {
  assert.equal(parseFeishuMessageTimestamp('1777286065529'), 1777286065529);
  assert.equal(parseFeishuMessageTimestamp(1777286065), 1777286065000);
});

test('parseFeishuMessageTimestamp rejects invalid timestamps', () => {
  assert.equal(parseFeishuMessageTimestamp(undefined), null);
  assert.equal(parseFeishuMessageTimestamp('not-a-time'), null);
  assert.equal(parseFeishuMessageTimestamp(0), null);
});
