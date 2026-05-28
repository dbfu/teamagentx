import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import fs from 'fs';
import os from 'os';
import path from 'path';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { randomUUID, randomBytes } from 'crypto';

// 本地账号文件标记：DB 中存此占位符，真实密码在 user.json
const LOCAL_USER_FILE_SENTINEL = '__TEAMAGENTX_LOCAL_USER_FILE__';

interface LocalUser {
  id: string;
  username: string;
  password: string;
  avatar: string;
  createdAt: string;
  updatedAt: string;
}

function getUserFilePath(): string {
  return process.env.TEAMAGENTX_USER_FILE || path.join(os.homedir(), '.teamagentx', 'user.json');
}

async function readLocalUser(): Promise<LocalUser | null> {
  try {
    const content = await fs.promises.readFile(getUserFilePath(), 'utf-8');
    return JSON.parse(content) as LocalUser;
  } catch {
    return null;
  }
}

async function writeLocalUser(user: LocalUser): Promise<void> {
  const filePath = getUserFilePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(user, null, 2), 'utf-8');
}

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

export const authService = {
  async register(data: RegisterData): Promise<AuthResponse> {
    const { username, password, avatar } = data;
    const now = new Date();

    // 本机单账号：user.json 已存在则禁止再注册
    const existingLocalUser = await readLocalUser();
    if (existingLocalUser) {
      throw new Error('本机账号已存在');
    }

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new Error('用户名已存在');
    }

    const id = randomUUID();
    const avatarValue = avatar || '0';

    // Create user with sentinel password in DB
    const user = await prisma.user.create({
      data: {
        id,
        username,
        password: LOCAL_USER_FILE_SENTINEL,
        avatar: avatarValue,
        updatedAt: now,
      },
    });

    // Write plaintext password to local file
    await writeLocalUser({
      id: user.id,
      username: user.username,
      password,
      avatar: avatarValue,
      createdAt: user.createdAt.toISOString(),
      updatedAt: now.toISOString(),
    });

    // Generate JWT token
    const signOptions: SignOptions = { expiresIn: config.jwt.expiresIn as StringValue };
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwt.secret,
      signOptions
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
      token,
    };
  },

  async login(data: LoginData): Promise<AuthResponse> {
    const { username, password } = data;

    // Find user
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new Error('用户不存在');
    }

    if (user.password === LOCAL_USER_FILE_SENTINEL) {
      // 新格式：从本地文件比对明文密码
      const localUser = await readLocalUser();
      if (!localUser || localUser.password !== password) {
        throw new Error('密码错误');
      }
    } else {
      // 旧格式（bcrypt）：校验后迁移到本地文件
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new Error('密码错误');
      }

      // 迁移：写 user.json，DB 换成占位符
      const now = new Date();
      await writeLocalUser({
        id: user.id,
        username: user.username,
        password,
        avatar: user.avatar || '0',
        createdAt: user.createdAt.toISOString(),
        updatedAt: now.toISOString(),
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { password: LOCAL_USER_FILE_SENTINEL, updatedAt: now },
      });
    }

    // Generate JWT token
    const signOptions: SignOptions = { expiresIn: config.jwt.expiresIn as StringValue };
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      config.jwt.secret,
      signOptions
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.createdAt,
      },
      token,
    };
  },

  async checkFirstUse(): Promise<{ isFirstUse: boolean }> {
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      return { isFirstUse: true };
    }

    // 若已有账号但 user.json 不存在，说明是旧 bcrypt 格式，自动生成恢复密码
    const localUser = await readLocalUser();
    if (!localUser) {
      const existingUser = await prisma.user.findFirst();
      if (existingUser && existingUser.password !== LOCAL_USER_FILE_SENTINEL) {
        const recoveryPassword = `tax-${randomBytes(12).toString('base64url')}`;
        const now = new Date();
        await writeLocalUser({
          id: existingUser.id,
          username: existingUser.username,
          password: recoveryPassword,
          avatar: existingUser.avatar || '0',
          createdAt: existingUser.createdAt.toISOString(),
          updatedAt: now.toISOString(),
        });
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { password: LOCAL_USER_FILE_SENTINEL, updatedAt: now },
        });
      }
    }

    return { isFirstUse: false };
  },

  async getUserFromToken(token: string): Promise<UserResponse | null> {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        username: string;
      };

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
      });

      if (!user) {
        return null;
      }

      return {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        createdAt: user.createdAt,
      };
    } catch {
      return null;
    }
  },

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
    });
  },

  async updateSocketId(userId: string, socketId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { socketId, updatedAt: new Date() },
    });
  },

  async updateProfile(userId: string, data: UpdateProfileData): Promise<UserResponse> {
    const { username, avatar } = data;
    const now = new Date();

    // 如果要更新用户名，检查是否已存在
    if (username) {
      const existingUser = await prisma.user.findFirst({
        where: {
          username,
          id: { not: userId },
        },
      });

      if (existingUser) {
        throw new Error('用户名已存在');
      }
    }

    // 更新用户信息
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(username && { username }),
        ...(avatar !== undefined && { avatar }),
        updatedAt: now,
      },
    });

    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      createdAt: user.createdAt,
    };
  },
};