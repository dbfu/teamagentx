import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { MultipartFile } from '@fastify/multipart';

let tempRoot = '';

function createMockFile(options: {
  filename: string;
  mimetype: string;
  content: Buffer;
}): MultipartFile {
  return {
    type: 'file',
    fieldname: 'file',
    filename: options.filename,
    encoding: '7bit',
    mimetype: options.mimetype,
    file: undefined as never,
    fields: {},
    async toBuffer() {
      return options.content;
    },
  } as MultipartFile;
}

describe('uploadService audio support', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teamagentx-upload-test-'));
    process.env.UPLOADS_DIR = tempRoot;
  });

  afterEach(async () => {
    delete process.env.UPLOADS_DIR;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('应该保存音频文件到 audio 目录并返回音频附件信息', async () => {
    const { uploadService } = await import('./upload.service.js');
    await uploadService.init();

    const file = createMockFile({
      filename: 'recording.webm',
      mimetype: 'audio/webm',
      content: Buffer.from('fake audio'),
    });

    const result = await uploadService.processAudio(file);

    assert.strictEqual(result.type, 'audio');
    assert.strictEqual(result.filename, 'recording.webm');
    assert.strictEqual(result.mimeType, 'audio/webm');
    assert.match(result.url, /^\/uploads\/audio\//);
  });
});
