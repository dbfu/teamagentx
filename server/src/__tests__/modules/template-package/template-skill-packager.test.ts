import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  collectSkillsForTemplate,
  materializeTemplateSkills,
} from '../../../modules/template-package/template-skill-packager.js';

describe('template skill packager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-template-skill-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('collects full skill files from agent skills directory', () => {
    const skillDir = path.join(tempDir, 'skills', 'browser-use');
    fs.mkdirSync(path.join(skillDir, '.skills'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: Browser Use\ndescription: Test\n---\nbody');
    fs.writeFileSync(path.join(skillDir, 'helper.txt'), 'helper');
    fs.writeFileSync(path.join(skillDir, '.skills', 'origin.json'), JSON.stringify({ source: 'user-created' }));

    const result = collectSkillsForTemplate([{
      agentId: 'agent-1',
      skillsDir: path.join(tempDir, 'skills'),
    }]);

    assert.equal(result.skills.length, 1);
    assert.equal(result.skills[0]?.slug, 'browser-use');
    assert.equal(result.skills[0]?.files.some((file) => file.path === 'SKILL.md'), true);
    assert.equal(result.skills[0]?.files.some((file) => file.path === 'helper.txt'), true);
    assert.equal(result.skills[0]?.origin?.source, 'user-created');
    assert.equal(result.usages[0]?.agentId, 'agent-1');
  });

  test('marks missing skill metadata as degraded instead of crashing', () => {
    const invalidSkillDir = path.join(tempDir, 'skills', 'broken-skill');
    fs.mkdirSync(invalidSkillDir, { recursive: true });
    fs.writeFileSync(path.join(invalidSkillDir, 'README.md'), 'missing skill file');

    const result = collectSkillsForTemplate([{
      agentId: 'agent-1',
      skillsDir: path.join(tempDir, 'skills'),
    }]);

    assert.equal(result.skills.length, 0);
    assert.equal(result.degraded.length, 1);
    assert.match(result.degraded[0]?.reason ?? '', /SKILL\.md/);
  });

  test('materializes packaged skills into shared dir and agent dir', () => {
    const sharedDir = path.join(tempDir, 'shared');
    const agentDir = path.join(tempDir, 'agent-skills');

    materializeTemplateSkills({
      sharedSkillsDir: sharedDir,
      usages: [{ agentId: 'agent-1', slug: 'browser-use' }],
      agentSkillsDirs: new Map([['agent-1', agentDir]]),
      skills: [{
        slug: 'browser-use',
        name: 'Browser Use',
        description: 'Test',
        files: [
          { path: 'SKILL.md', content: '---\nname: Browser Use\n---' },
          { path: 'helper.txt', content: 'helper' },
        ],
        origin: { source: 'user-created' },
      }],
    });

    assert.equal(fs.existsSync(path.join(sharedDir, 'browser-use', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(sharedDir, 'browser-use', 'helper.txt')), true);
    assert.equal(fs.existsSync(path.join(agentDir, 'browser-use', 'SKILL.md')), true);
  });

  test('cleans up newly created shared skill dirs when agent copy fails', () => {
    const sharedDir = path.join(tempDir, 'shared');
    const blockedAgentDir = path.join(tempDir, 'blocked-agent-skills');
    fs.writeFileSync(blockedAgentDir, 'blocked', 'utf8');

    assert.throws(
      () => materializeTemplateSkills({
        sharedSkillsDir: sharedDir,
        usages: [{ agentId: 'agent-1', slug: 'browser-use' }],
        agentSkillsDirs: new Map([['agent-1', blockedAgentDir]]),
        skills: [{
          slug: 'browser-use',
          name: 'Browser Use',
          description: 'Test',
          files: [
            { path: 'SKILL.md', content: '---\nname: Browser Use\n---' },
          ],
          origin: { source: 'user-created' },
        }],
      }),
      /EEXIST|ENOTDIR/,
    );

    assert.equal(fs.existsSync(path.join(sharedDir, 'browser-use')), false);
  });
});
