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
    assert.equal(Buffer.from(result.skills[0]?.files.find((file) => file.path === 'helper.txt')?.content ?? []).toString('utf8'), 'helper');
    assert.equal(result.skills[0]?.origin?.source, 'user-created');
    assert.equal(result.usages[0]?.agentId, 'agent-1');
  });

  test('collects binary files and nested symlinked directories from a valid skill', () => {
    const skillDir = path.join(tempDir, 'skills', 'browser-use');
    const linkedAssetsDir = path.join(tempDir, 'linked-assets');
    fs.mkdirSync(path.join(skillDir, 'assets'), { recursive: true });
    fs.mkdirSync(linkedAssetsDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: Browser Use\n---\nbody');
    fs.writeFileSync(path.join(skillDir, 'icon.bin'), Buffer.from([0x00, 0xff, 0x7f, 0x40]));
    fs.writeFileSync(path.join(linkedAssetsDir, 'prompt.txt'), 'linked prompt');
    fs.symlinkSync(linkedAssetsDir, path.join(skillDir, 'assets', 'shared'));

    const result = collectSkillsForTemplate([{
      agentId: 'agent-1',
      skillsDir: path.join(tempDir, 'skills'),
    }]);

    const binaryFile = result.skills[0]?.files.find((file) => file.path === 'icon.bin');
    const linkedFile = result.skills[0]?.files.find((file) => file.path === path.join('assets', 'shared', 'prompt.txt'));
    assert.deepEqual(Array.from(binaryFile?.content ?? []), [0x00, 0xff, 0x7f, 0x40]);
    assert.equal(Buffer.from(linkedFile?.content ?? []).toString('utf8'), 'linked prompt');
  });

  test('skips directories that are not valid skills', () => {
    const invalidSkillDir = path.join(tempDir, 'skills', 'broken-skill');
    fs.mkdirSync(invalidSkillDir, { recursive: true });
    fs.writeFileSync(path.join(invalidSkillDir, 'README.md'), 'missing skill file');

    const result = collectSkillsForTemplate([{
      agentId: 'agent-1',
      skillsDir: path.join(tempDir, 'skills'),
    }]);

    assert.equal(result.skills.length, 0);
    assert.equal(result.degraded.length, 0);
    assert.equal(result.usages.length, 0);
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
          { path: 'SKILL.md', content: Buffer.from('---\nname: Browser Use\n---') },
          { path: 'helper.txt', content: Buffer.from('helper') },
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
            { path: 'SKILL.md', content: Buffer.from('---\nname: Browser Use\n---') },
          ],
          origin: { source: 'user-created' },
        }],
      }),
      /EEXIST|ENOTDIR/,
    );

    assert.equal(fs.existsSync(path.join(sharedDir, 'browser-use')), false);
  });
});
