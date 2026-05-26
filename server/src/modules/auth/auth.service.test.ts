import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import prisma from '../../lib/prisma.js';
import { authService } from './auth.service.js';

describe('authService local user file', () => {
  let tempDir: string;
  let originalUserFile: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'teamagentx-auth-test-'));
    originalUserFile = process.env.TEAMAGENTX_USER_FILE;
    process.env.TEAMAGENTX_USER_FILE = path.join(tempDir, 'user.json');
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await prisma.user.deleteMany();
    if (originalUserFile === undefined) {
      delete process.env.TEAMAGENTX_USER_FILE;
    } else {
      process.env.TEAMAGENTX_USER_FILE = originalUserFile;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  async function readUserFile() {
    const content = await readFile(process.env.TEAMAGENTX_USER_FILE!, 'utf8');
    return JSON.parse(content) as {
      id: string;
      username: string;
      password: string;
      avatar: string | null;
    };
  }

  test('首次注册创建本地账号文件并阻止再次注册', async () => {
    assert.deepEqual(await authService.checkFirstUse(), { isFirstUse: true });

    const result = await authService.register({
      username: 'admin',
      password: 'secret123',
      avatar: '2',
    });

    assert.equal(result.user.username, 'admin');
    assert.ok(result.token);

    const localUser = await readUserFile();
    assert.equal(localUser.username, 'admin');
    assert.equal(localUser.password, 'secret123');
    assert.equal(localUser.avatar, '2');

    const dbUser = await prisma.user.findUnique({ where: { id: result.user.id } });
    assert.equal(dbUser?.password, '__TEAMAGENTX_LOCAL_USER_FILE__');

    await assert.rejects(
      () => authService.register({ username: 'other', password: 'secret456' }),
      /本机账号已存在/
    );
  });

  test('登录使用本地账号文件中的明文密码', async () => {
    await authService.register({ username: 'admin', password: 'secret123' });

    await assert.rejects(
      () => authService.login({ username: 'admin', password: 'wrong' }),
      /密码错误/
    );

    const result = await authService.login({ username: 'admin', password: 'secret123' });
    assert.equal(result.user.username, 'admin');
  });

  test('旧数据库账号在密码正确时迁移为本地账号文件', async () => {
    await prisma.user.create({
      data: {
        id: 'legacy-user',
        username: 'legacy',
        password: await bcrypt.hash('old-password', 10),
        avatar: '1',
        updatedAt: new Date(),
      },
    });

    const result = await authService.login({
      username: 'legacy',
      password: 'old-password',
    });

    assert.equal(result.user.id, 'legacy-user');
    const localUser = await readUserFile();
    assert.equal(localUser.password, 'old-password');
  });

  test('旧数据库账号可生成配置文件恢复密码', async () => {
    await prisma.user.create({
      data: {
        id: 'legacy-recovery-user',
        username: 'legacy-recovery',
        password: await bcrypt.hash('forgotten-password', 10),
        updatedAt: new Date(),
      },
    });

    assert.deepEqual(await authService.checkFirstUse(), { isFirstUse: false });

    const localUser = await readUserFile();
    assert.match(localUser.password, /^tax-/);

    const result = await authService.login({
      username: 'legacy-recovery',
      password: localUser.password,
    });
    assert.equal(result.user.id, 'legacy-recovery-user');
  });
});
