import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getDefaultSkillColor,
  isSkillColor,
  parseSkillColorTags,
  SKILL_COLORS,
} from '../../../modules/skill/skill-color.js';

describe('skill color tags', () => {
  test('creates a stable default color from the skill slug', () => {
    const color = getDefaultSkillColor('browser-use');
    assert.equal(getDefaultSkillColor('browser-use'), color);
    assert.ok(SKILL_COLORS.includes(color));
  });

  test('parses only supported color values', () => {
    assert.deepEqual(parseSkillColorTags(JSON.stringify({
      browser: 'blue',
      writer: 'purple',
      invalid: 'pink',
    })), {
      browser: 'blue',
      writer: 'purple',
    });
    assert.deepEqual(parseSkillColorTags('invalid-json'), {});
  });

  test('recognizes supported colors', () => {
    assert.equal(isSkillColor('green'), true);
    assert.equal(isSkillColor('pink'), false);
  });
});
