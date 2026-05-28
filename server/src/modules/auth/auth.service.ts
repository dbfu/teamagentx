import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
}

export interface UserResponse {
  id: string;
  username: string;
  avatar: string | null;
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
  createdAt: string;
  updatedAt: string;
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
    createdAt: new Date(user.createdAt),
  };
}

function createToken(user: LocalUserConfig) {
  const signOptions: SignOptions = { expiresIn: config.jwt.expiresIn as StringValue };
  return jwt.sign(
    { userId: user.id, username: user.username },
    config.jwt.secret,
    signOptions
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

async function syncCompatibilityUser(user: LocalUserConfig, socketId?: string | null) {
  const now = new Date();
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      username: user.username,
      password: LOCAL_USER_PASSWORD_SENTINEL,
      avatar: user.avatar,
      ...(socketId !== undefined && { socketId }),
      updatedAt: now,
    },
    create: {
      id: user.id,
      username: user.username,
      password: LOCAL_USER_PASSWORD_SENTINEL,
      avatar: user.avatar,
      socketId: socketId ?? null,
      updatedAt: now,
    },
  });
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
    createdAt: legacyUser.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await syncCompatibilityUser(user, legacyUser.socketId);
  return user;
}

async function loadLocalUser(username?: string, password?: string): Promise<LocalUserConfig | null> {
  const user = await readLocalUser();
  if (user) {
    await syncCompatibilityUser(user).catch((error) => {
      console.warn('[Auth] 同步本地用户兼容记录失败:', error);
    });
    return user;
  }
  return migrateLegacyUser(username, password);
}

export const authService = {
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
      const decoded = jwt.verify(token, config.jwt.secret) as {
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
    await syncCompatibilityUser(user, socketId);
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
    const { username, avatar } = data;
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

    const updatedUser = await writeLocalUser({
      ...user,
      ...(username && { username }),
      ...(avatar !== undefined && { avatar }),
      updatedAt: new Date().toISOString(),
    });
    await syncCompatibilityUser(updatedUser);

    return toUserResponse(updatedUser);
  },
};
