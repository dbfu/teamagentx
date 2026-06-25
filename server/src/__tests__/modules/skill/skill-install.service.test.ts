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

  test('discovers nested skills inside a plugin collection without a top-level SKILL.md', () => {
    // 模拟 superpowers 这类合集：顶层目录无 SKILL.md，技能嵌套在 skills/ 下
    const collectionDir = path.join(tempHome, '.claude', 'skills', 'superpowers');
    const nestedSkillDir = path.join(collectionDir, 'skills', 'brainstorming');
    fs.mkdirSync(nestedSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedSkillDir, 'SKILL.md'),
      ['---', 'name: brainstorming', 'description: Explore ideas before building', '---', '', 'body'].join('\n'),
      'utf-8',
    );

    const skills = skillInstallService.discoverExternalSkills();

    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'brainstorming');
    assert.equal(skills[0].sourcePath, nestedSkillDir);
    // 嵌套技能的 slug 带合集名前缀，并标注所属合集
    assert.equal(skills[0].slug, 'superpowers-brainstorming');
    assert.equal(skills[0].collection, 'superpowers');
  });

  test('nested and top-level skills with the same name get distinct slugs (no overwrite)', () => {
    const claudeSkills = path.join(tempHome, '.claude', 'skills');
    // 顶层独立技能
    const topLevelDir = path.join(claudeSkills, 'using-git-worktrees');
    fs.mkdirSync(topLevelDir, { recursive: true });
    fs.writeFileSync(
      path.join(topLevelDir, 'SKILL.md'),
      ['---', 'name: using-git-worktrees', 'description: top-level', '---', '', 'body'].join('\n'),
      'utf-8',
    );
    // 合集内同名子技能
    const nestedDir = path.join(claudeSkills, 'superpowers', 'skills', 'using-git-worktrees');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(
      path.join(nestedDir, 'SKILL.md'),
      ['---', 'name: using-git-worktrees', 'description: from superpowers', '---', '', 'body'].join('\n'),
      'utf-8',
    );

    const skills = skillInstallService.discoverExternalSkills();
    const slugs = skills.map((s) => s.slug).sort();

    assert.equal(skills.length, 2);
    assert.deepEqual(slugs, ['superpowers-using-git-worktrees', 'using-git-worktrees']);
  });
});
