import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test } from 'node:test';
import { buildInstalledSkillNames } from '../../../core/agent/skill-instructions.js';

describe('skill instructions helpers', () => {
  test('builds Claude SDK skill name arrays from installed skill directories', () => {
    const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-skills-'));

    try {
      fs.mkdirSync(path.join(skillsDir, 'browser-use'));
      fs.writeFileSync(
        path.join(skillsDir, 'browser-use', 'SKILL.md'),
        '---\nname: browser-use\n---\nbody',
      );
      fs.mkdirSync(path.join(skillsDir, 'byteplan-api'));
      fs.writeFileSync(
        path.join(skillsDir, 'byteplan-api', 'SKILL.md'),
        '---\nname: byteplan-api\n---\nbody',
      );
      fs.mkdirSync(path.join(skillsDir, 'not-a-skill'));

      assert.deepEqual(buildInstalledSkillNames('agent-id', skillsDir), [
        'browser-use',
        'byteplan-api',
      ]);
    } finally {
      fs.rmSync(skillsDir, { recursive: true, force: true });
    }
  });
});
