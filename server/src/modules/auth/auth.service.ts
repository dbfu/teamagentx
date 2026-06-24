import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearExecutorCacheEntries } from '../../core/agent/agent-handler/cache.js';

export interface RegisterData {
  username: string;
  password: string;
  avatar?: string;
}

export interface LoginData {
  username: string;
  password: string;
}

export interface UpdateProfileData {
  username?: string;
  avatar?: string;
  preferredLanguage?: string;
}

export interface UserResponse {
  id: string;
  username: string;
  avatar: string | null;
  preferredLanguage: string;
  createdAt: Date;
}

export interface AuthResponse {
  user: UserResponse;
  token: string;
}

interface LocalUserConfig {
  id: string;
  username: string;
  password: string;
  avatar: string | null;
  preferredLanguage: string;
  createdAt: string;
  updatedAt: string;
}

// 仅支持中英文，其它一律落到默认中文。
function normalizePreferredLanguage(value: unknown): 'zh-CN' | 'en-US' {
  return typeof value === 'string' && value.toLowerCase().startsWith('en')
    ? 'en-US'
    : 'zh-CN';
}

const LOCAL_USER_PASSWORD_SENTINEL = '__TEAMAGENTX_LOCAL_USER_FILE__';

function getLocalUserPath() {
  return process.env.TEAMAGENTX_USER_FILE
    || path.join(os.homedir(), '.teamagentx', 'user.json');
}

function toUserResponse(user: LocalUserConfig): UserResponse {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    preferredLanguage: user.preferredLanguage,
    createdAt: new Date(user.createdAt),
  };
}

function createToken(user: LocalUserConfig) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    config.jwt.secret
  );
}

function normalizeLocalUser(data: unknown): LocalUserConfig {
  if (!data || typeof data !== 'object') {
    throw new Error('用户配置文件格式无效');
  }

  const raw = data as Partial<LocalUserConfig>;
  if (typeof raw.username !== 'string' || !raw.username.trim()) {
    throw new Error('用户配置文件缺少用户名');
  }
  if (typeof raw.password !== 'string' || !raw.password) {
    throw new Error('用户配置文件缺少密码');
  }

  const now = new Date().toISOString();
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    username: raw.username,
    password: raw.password,
    avatar: typeof raw.avatar === 'string' ? raw.avatar : null,
    preferredLanguage: normalizePreferredLanguage(raw.preferredLanguage),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
  };
}

async function readLocalUser(): Promise<LocalUserConfig | null> {
  try {
    const content = await readFile(getLocalUserPath(), 'utf8');
    return normalizeLocalUser(JSON.parse(content));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeLocalUser(user: LocalUserConfig): Promise<LocalUserConfig> {
  const userPath = getLocalUserPath();
  await mkdir(path.dirname(userPath), { recursive: true, mode: 0o700 });
  await writeFile(userPath, `${JSON.stringify(user, null, 2)}\n`, { mode: 0o600 });
  await chmod(userPath, 0o600).catch(() => {});
  return user;
}

function generateRecoveryPassword() {
  return `tax-${randomBytes(12).toString('base64url')}`;
}

async function findLegacyUser(username?: string) {
  if (username) {
    const exactUser = await prisma.user.findUnique({ where: { username } });
    if (exactUser) return exactUser;
  }

  return prisma.user.findFirst({
    orderBy: { createdAt: 'asc' },
  });
}

// 返回数据库中的 canonical user ID（通常与 user.id 相同；P2002 时返回已有记录的 ID）
async function syncCompatibilityUser(user: LocalUserConfig, socketId?: string | null): Promise<string> {
  const now = new Date();
  try {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        username: user.username,
        password: LOCAL_USER_PASSWORD_SENTINEL,
        avatar: user.avatar,
        preferredLanguage: user.preferredLanguage,
        ...(socketId !== undefined && { socketId }),
        updatedAt: now,
      },
      create: {
        id: user.id,
        username: user.username,
        password: LOCAL_USER_PASSWORD_SENTINEL,
        avatar: user.avatar,
        preferredLanguage: user.preferredLanguage,
        socketId: socketId ?? null,
        updatedAt: now,
      },
    });
    return user.id;
  } catch (error: any) {
    // 本地文件 ID 与数据库 ID 不一致时（用户名已存在但 ID 不同），按 username 更新已有记录
    // 同时返回 DB 中实际的 ID，让调用方将本地文件对齐到 DB
    if (error?.code === 'P2002') {
      const existing = await prisma.user.update({
        where: { username: user.username },
        data: {
          password: LOCAL_USER_PASSWORD_SENTINEL,
          avatar: user.avatar,
          preferredLanguage: user.preferredLanguage,
          ...(socketId !== undefined && { socketId }),
          updatedAt: now,
        },
      });
      return existing.id;
    } else {
      throw error;
    }
  }
}

async function migrateLegacyUser(username?: string, password?: string): Promise<LocalUserConfig | null> {
  const legacyUser = await findLegacyUser(username);
  if (!legacyUser) return null;

  let localPassword = generateRecoveryPassword();
  if (username && password && legacyUser.username === username) {
    const matchesLegacyPassword = await bcrypt.compare(password, legacyUser.password).catch(() => false);
    if (matchesLegacyPassword) {
      localPassword = password;
    }
  }

  const user = await writeLocalUser({
    id: legacyUser.id,
    username: legacyUser.username,
    password: localPassword,
    avatar: legacyUser.avatar ?? '0',
    preferredLanguage: normalizePreferredLanguage((legacyUser as any).preferredLanguage),
    createdAt: legacyUser.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await syncCompatibilityUser(user, legacyUser.socketId);
  return user;
}

async function loadLocalUser(username?: string, password?: string): Promise<LocalUserConfig | null> {
  const user = await readLocalUser();
  if (user) {
    const canonicalId = await syncCompatibilityUser(user).catch((error) => {
      console.warn('[Auth] 同步本地用户兼容记录失败:', error);
      return null;
    });
    // 若 DB 中已有同名用户但 ID 不同，将本地文件对齐到 DB 的 ID，避免 FK 约束错误
    if (canonicalId && canonicalId !== user.id) {
      console.warn(`[Auth] 本地用户 ID 与 DB 不一致，自动修正: ${user.id} -> ${canonicalId}`);
      const corrected = { ...user, id: canonicalId, updatedAt: new Date().toISOString() };
      await writeLocalUser(corrected).catch((e) => console.warn('[Auth] 写入修正后的本地文件失败:', e));
      return corrected;
    }
    return user;
  }
  return migrateLegacyUser(username, password);
}

export const authService = {
  /**
   * 用环境变量 AUTH_USERNAME / AUTH_PASSWORD 预置/对齐本地单账号（Docker / 独立部署）。
   * 启动即建好账号，使开放注册接口对已存在账号直接拒绝，消除「谁先连谁抢注」风险。
   * - 账号不存在 → 用 env 创建；
   * - 已存在但用户名/口令与 env 不一致 → 以 env 为准更新（保留头像、语言、id、创建时间）；
   * - 两个变量缺一则不做任何操作（保持原有注册流程）。
   */
  async seedLocalUserFromEnv(): Promise<void> {
    const username = process.env.AUTH_USERNAME?.trim();
    const password = process.env.AUTH_PASSWORD;
    if (!username || !password) return;

    const existing = await readLocalUser().catch(() => null);
    if (existing && existing.username === username && existing.password === password) {
      return; // 无变化
    }

    const now = new Date().toISOString();
    const user: LocalUserConfig = existing
      ? { ...existing, username, password, updatedAt: now }
      : {
          id: randomUUID(),
          username,
          password,
          avatar: '0',
          preferredLanguage: 'zh-CN',
          createdAt: now,
          updatedAt: now,
        };

    await writeLocalUser(user);
    await syncCompatibilityUser(user).catch((error) => {
      console.warn('[Auth] 预置账号同步兼容记录失败:', error);
    });
    console.log(`[Auth] 已根据环境变量预置本地账号：${username}`);
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const { username, password, avatar } = data;

    const existingUser = await loadLocalUser();
    if (existingUser) {
      throw new Error('本机账号已存在，请直接登录');
    }

    const now = new Date().toISOString();
    const user = await writeLocalUser({
      id: randomUUID(),
      username,
      password,
      avatar: avatar || '0',
      preferredLanguage: 'zh-CN',
      createdAt: now,
      updatedAt: now,
    });
    await syncCompatibilityUser(user);

    return {
      user: toUserResponse(user),
      token: createToken(user),
    };
  },

  async login(data: LoginData): Promise<AuthResponse> {
    const { username, password } = data;

    const user = await loadLocalUser(username, password);

    if (!user || user.username !== username) {
      throw new Error('用户不存在');
    }

    if (password !== user.password) {
      throw new Error('密码错误');
    }

    return {
      user: toUserResponse(user),
      token: createToken(user),
    };
  },

  async checkFirstUse(): Promise<{ isFirstUse: boolean }> {
    const user = await loadLocalUser();
    return { isFirstUse: !user };
  },

  async getUserFromToken(token: string): Promise<UserResponse | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, { ignoreExpiration: true }) as {
        userId: string;
        username: string;
      };

      const user = await loadLocalUser(decoded.username);
      if (!user || user.id !== decoded.userId) {
        return null;
      }

      return toUserResponse(user);
    } catch {
      return null;
    }
  },

  async findById(id: string) {
    const user = await loadLocalUser();
    if (!user || user.id !== id) return null;

    return {
      id: user.id,
      socketId: null,
      clientId: null,
      username: user.username,
      password: LOCAL_USER_PASSWORD_SENTINEL,
      avatar: user.avatar,
      avatarColor: null,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    };
  },

  async updateSocketId(userId: string, socketId: string) {
    const user = await loadLocalUser();
    if (!user || user.id !== userId) return null;
    await syncCompatibilityUser(user, socketId).catch((error) => {
      console.warn('[Auth] 更新 socketId 同步失败:', error);
    });
    return {
      id: user.id,
      socketId,
      clientId: null,
      username: user.username,
      password: LOCAL_USER_PASSWORD_SENTINEL,
      avatar: user.avatar,
      avatarColor: null,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    };
  },

  async updateProfile(userId: string, data: UpdateProfileData): Promise<UserResponse> {
    const { username, avatar, preferredLanguage } = data;
    const user = await loadLocalUser();

    if (!user || user.id !== userId) {
      throw new Error('用户不存在');
    }

    if (username && username !== user.username) {
      const existingUser = await prisma.user.findFirst({
        where: { username, id: { not: userId } },
      });
      if (existingUser) throw new Error('用户名已存在');
    }

    const nextLanguage = preferredLanguage !== undefined
      ? normalizePreferredLanguage(preferredLanguage)
      : user.preferredLanguage;
    const languageChanged = nextLanguage !== user.preferredLanguage;

    const updatedUser = await writeLocalUser({
      ...user,
      ...(username && { username }),
      ...(avatar !== undefined && { avatar }),
      preferredLanguage: nextLanguage,
      updatedAt: new Date().toISOString(),
    });
    await syncCompatibilityUser(updatedUser);

    // 界面语言改变后，已缓存的执行器持有旧语种系统提示词，清空缓存让下次执行按新语种重建。
    if (languageChanged) {
      clearExecutorCacheEntries();
    }

    return toUserResponse(updatedUser);
  },
};
