import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isFeishuCreatorBindCommand,
  parseFeishuMessageTimestamp,
  shouldAcceptFeishuGroupMessageFromCreator,
} from './feishu-ws-client.js';

test('parseFeishuMessageTimestamp accepts millisecond and second timestamps', () => {
  assert.equal(parseFeishuMessageTimestamp('1777286065529'), 1777286065529);
  assert.equal(parseFeishuMessageTimestamp(1777286065), 1777286065000);
});

test('parseFeishuMessageTimestamp rejects invalid timestamps', () => {
  assert.equal(parseFeishuMessageTimestamp(undefined), null);
  assert.equal(parseFeishuMessageTimestamp('not-a-time'), null);
  assert.equal(parseFeishuMessageTimestamp(0), null);
});

test('isFeishuCreatorBindCommand only matches bare /bind', () => {
  assert.equal(isFeishuCreatorBindCommand('/bind'), true);
  assert.equal(isFeishuCreatorBindCommand(' /bind '), true);
  assert.equal(isFeishuCreatorBindCommand('/BIND'), true);
  assert.equal(isFeishuCreatorBindCommand('/bind ABC123'), false);
});

test('shouldAcceptFeishuGroupMessageFromCreator filters group messages after creator binding', () => {
  assert.equal(shouldAcceptFeishuGroupMessageFromCreator({
    chatType: 'group',
    senderOpenId: 'ou_creator',
    feishuCreatorOpenId: 'ou_creator',
  }), true);
  assert.equal(shouldAcceptFeishuGroupMessageFromCreator({
    chatType: 'group',
    senderOpenId: 'ou_other',
    feishuCreatorOpenId: 'ou_creator',
  }), false);
  assert.equal(shouldAcceptFeishuGroupMessageFromCreator({
    chatType: 'group',
    senderOpenId: 'ou_other',
    feishuCreatorOpenId: null,
  }), true);
  assert.equal(shouldAcceptFeishuGroupMessageFromCreator({
    chatType: 'p2p',
    senderOpenId: 'ou_other',
    feishuCreatorOpenId: 'ou_creator',
  }), true);
});
