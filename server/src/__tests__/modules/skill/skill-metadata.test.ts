import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillFrontmatter, parseSkillMetadata } from '../../../modules/skill/skill-metadata.js';

describe('skill metadata parser', () => {
  test('parses multiline skill description frontmatter for display', () => {
    const content = [
      '---',
      'name: "Browser Use"',
      'description: >-',
      '  First line',
      '  second line: with colon',
      'source: user-created',
      '---',
      '',
      'body',
    ].join('\n');

    assert.deepEqual(parseSkillMetadata(content), {
      name: 'Browser Use',
      description: 'First line second line: with colon',
    });
    assert.equal(parseSkillFrontmatter(content).source, 'user-created');
  });
});
