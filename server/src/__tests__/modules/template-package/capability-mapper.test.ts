import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCapabilityDescriptors,
} from '../../../modules/template-package/capability-mapper.js';

describe('template capability mapper', () => {
  test('resolves claude text capability to anthropic text provider', () => {
    const result = mapCapabilityDescriptors(
      [
        {
          agentRef: 'agent-1',
          capabilityType: 'text',
          required: true,
          tool: 'claude',
          providerProtocol: 'anthropic',
          modelType: 'text',
        },
      ],
      [
        {
          id: 'provider-1',
          name: 'Claude Sonnet',
          modelType: 'text',
          apiProtocol: 'anthropic',
        },
      ],
    );

    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0]?.providerId, 'provider-1');
    assert.equal(result.unresolved.length, 0);
  });

  test('marks required image capability as unresolved when no local image provider exists', () => {
    const result = mapCapabilityDescriptors(
      [
        {
          agentRef: 'agent-2',
          capabilityType: 'image',
          required: true,
          providerProtocol: 'openai',
          modelType: 'image',
        },
      ],
      [
        {
          id: 'provider-1',
          name: 'Claude Sonnet',
          modelType: 'text',
          apiProtocol: 'anthropic',
        },
      ],
    );

    assert.equal(result.resolved.length, 0);
    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0]?.status, 'requires_user_selection');
  });

  test('marks optional audio capability as importable when no provider exists', () => {
    const result = mapCapabilityDescriptors(
      [
        {
          agentRef: 'agent-3',
          capabilityType: 'audio',
          required: false,
          providerProtocol: 'openai',
          modelType: 'audio',
        },
      ],
      [],
    );

    assert.equal(result.unresolved.length, 1);
    assert.equal(result.unresolved[0]?.status, 'unsupported_but_importable');
  });
});
