import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import prisma from '../../lib/prisma.js';
import { config } from '../../config/index.js';
import { randomUUID } from 'crypto';

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

    // Check if username already exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new Error('用户名已存在');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        username,
        password: hashedPassword,
        avatar: avatar || '0',
        updatedAt: now,
      },
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

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      throw new Error('密码错误');
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
    return { isFirstUse: userCount === 0 };
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