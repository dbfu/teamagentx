import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TemplateManifestError,
  parseTemplateManifest,
} from '../../../modules/template-package/template-manifest.js';

describe('template manifest', () => {
  test('parses a valid manifest with required fields', () => {
    const manifest = parseTemplateManifest({
      schemaVersion: '1.0',
      templateId: 'tpl-demo',
      version: '1.0.0',
      title: 'Demo Template',
      source: {
        type: 'local',
        author: 'user-1',
      },
      contents: {
        group: true,
        agents: 2,
        categories: 1,
        skills: 3,
        cronTasks: 1,
      },
    });

    assert.equal(manifest.templateId, 'tpl-demo');
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.contents.skills, 3);
    assert.equal(manifest.summary, null);
  });

  test('normalizes optional summary to null when empty', () => {
    const manifest = parseTemplateManifest({
      schemaVersion: '1.0',
      templateId: 'tpl-demo',
      version: '1.0.0',
      title: 'Demo Template',
      summary: '   ',
      source: {
        type: 'market',
      },
      contents: {
        group: true,
        agents: 0,
        categories: 0,
        skills: 0,
        cronTasks: 0,
      },
    });

    assert.equal(manifest.summary, null);
  });

  test('rejects manifest without template identity', () => {
    assert.throws(
      () => parseTemplateManifest({
        schemaVersion: '1.0',
        version: '1.0.0',
        title: 'Demo Template',
        source: {
          type: 'local',
        },
        contents: {
          group: true,
          agents: 1,
          categories: 1,
          skills: 1,
          cronTasks: 0,
        },
      }),
      (error: unknown) =>
        error instanceof TemplateManifestError &&
        error.message === 'templateId is required',
    );
  });

  test('rejects unsupported schema version', () => {
    assert.throws(
      () => parseTemplateManifest({
        schemaVersion: '2.0',
        templateId: 'tpl-demo',
        version: '1.0.0',
        title: 'Demo Template',
        source: {
          type: 'local',
        },
        contents: {
          group: true,
          agents: 1,
          categories: 1,
          skills: 1,
          cronTasks: 0,
        },
      }),
      (error: unknown) =>
        error instanceof TemplateManifestError &&
        error.message === 'Unsupported template schemaVersion: 2.0',
    );
  });
});
