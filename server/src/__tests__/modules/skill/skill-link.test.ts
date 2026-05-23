import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createSkillDirectoryLink,
  replaceWithSkillDirectoryLink,
} from '../../../modules/skill/skill-link.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-skill-link-'));
  tempDirs.push(dir);
  return dir;
}

function createSourceSkill(root: string, name: string): string {
  const sourceDir = path.join(root, name);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: test\n---\n', 'utf-8');
  return sourceDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('skill directory links', () => {
  test('creates a readable directory link', () => {
    const root = makeTempDir();
    const sourceDir = createSourceSkill(root, 'source-skill');
    const targetDir = path.join(root, 'target-skill');

    const result = createSkillDirectoryLink(sourceDir, targetDir);

    assert.ok(['symlink', 'junction', 'copy'].includes(result.method));
    assert.equal(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf-8'), '---\nname: test\n---\n');
  });

  test('replaces an existing directory target', () => {
    const root = makeTempDir();
    const sourceDir = createSourceSkill(root, 'source-skill');
    const targetDir = path.join(root, 'target-skill');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'old.txt'), 'old', 'utf-8');

    replaceWithSkillDirectoryLink(sourceDir, targetDir);

    assert.equal(fs.existsSync(path.join(targetDir, 'old.txt')), false);
    assert.equal(fs.existsSync(path.join(targetDir, 'SKILL.md')), true);
  });
});
