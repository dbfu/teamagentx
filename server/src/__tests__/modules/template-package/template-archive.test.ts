import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateArchive, parseTemplateArchive } from '../../../modules/template-package/template-archive.js';

describe('template archive', () => {
  test('preserves a skill root skill.json file without colliding with archive metadata', () => {
    const archive = buildTemplateArchive({
      manifest: {
        schemaVersion: '1.0',
        templateId: 'tpl-archive',
        version: '1.0.0',
        title: '归档模板',
        summary: null,
        source: { type: 'local', author: null, channel: null },
        contents: {
          group: true,
          agents: 1,
          categories: 0,
          skills: 1,
          cronTasks: 0,
        },
      },
      snapshot: {
        room: {
          name: '归档模板',
          description: null,
          rules: null,
          defaultAgentId: null,
          agentTriggerMode: 'auto',
        },
        agents: [],
        categories: [],
        cronTasks: [],
      },
      capabilityDescriptors: [],
      skillUsages: [],
      degradedSkills: [],
      skills: [{
        slug: 'browser-use',
        name: 'Browser Use',
        description: 'Test skill',
        origin: null,
        files: [
          { path: 'SKILL.md', content: Buffer.from('---\nname: Browser Use\n---\nbody') },
          { path: 'skill.json', content: Buffer.from('{"user":"real file"}') },
        ],
      }],
    });

    const restored = parseTemplateArchive(archive);
    assert.equal(
      Buffer.from(restored.skills[0]?.files.find((file) => file.path === 'skill.json')?.content ?? []).toString('utf8'),
      '{"user":"real file"}',
    );
    assert.equal(restored.skills[0]?.name, 'Browser Use');
  });

  test('round-trips binary skill files without utf8 corruption', () => {
    const archive = buildTemplateArchive({
      manifest: {
        schemaVersion: '1.0',
        templateId: 'tpl-binary',
        version: '1.0.0',
        title: '二进制模板',
        summary: null,
        source: { type: 'local', author: null, channel: null },
        contents: {
          group: true,
          agents: 1,
          categories: 0,
          skills: 1,
          cronTasks: 0,
        },
      },
      snapshot: {
        room: {
          name: '二进制模板',
          description: null,
          rules: null,
          defaultAgentId: null,
          agentTriggerMode: 'auto',
        },
        agents: [],
        categories: [],
        cronTasks: [],
      },
      capabilityDescriptors: [],
      skillUsages: [],
      degradedSkills: [],
      skills: [{
        slug: 'binary-skill',
        name: 'Binary Skill',
        description: 'Binary test',
        origin: null,
        files: [
          { path: 'SKILL.md', content: Buffer.from('---\nname: Binary Skill\n---\nbody') },
          { path: 'icon.bin', content: Buffer.from([0x00, 0xff, 0x7f, 0x40]) },
        ],
      }],
    });

    const restored = parseTemplateArchive(archive);
    assert.deepEqual(
      Array.from(restored.skills[0]?.files.find((file) => file.path === 'icon.bin')?.content ?? []),
      [0x00, 0xff, 0x7f, 0x40],
    );
  });
});
