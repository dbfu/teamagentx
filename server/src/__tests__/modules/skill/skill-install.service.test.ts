import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';

describe('skill install service', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-skill-home-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  test('discovers external skills with multiline description frontmatter', () => {
    const skillDir = path.join(tempHome, '.codex', 'skills', 'multiline-description');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: Multiline Description',
        'description: |',
        '  First line',
        '  second line: with colon',
        '---',
        '',
        'body',
      ].join('\n'),
      'utf-8',
    );

    const skills = skillInstallService.discoverExternalSkills();

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'Multiline Description');
    assert.equal(skills[0].description, 'First line second line: with colon');
  });
});
