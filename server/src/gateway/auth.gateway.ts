import { FastifyInstance } from 'fastify';
import { authService, RegisterData, LoginData, UpdateProfileData } from '../modules/auth/auth.service.js';

// Schema definitions
const userResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    avatar: { type: 'string', nullable: true },
    preferredLanguage: { type: 'string' },
    createdAt: { type: 'string' },
  },
};

const authResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: {
        user: userResponseSchema,
        token: { type: 'string' },
      },
    },
  },
};

const registerBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 50, description: '用户名' },
    password: { type: 'string', minLength: 6, maxLength: 100, description: '密码' },
    avatar: { type: 'string', description: '头像索引（数字）' },
  },
};

const loginBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', description: '用户名' },
    password: { type: 'string', description: '密码' },
  },
};

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
  },
};

interface AuthHeaders {
  authorization?: string;
}

export async function authGateway(app: FastifyInstance) {
  // Check first use
  app.get('/auth/check-first-use', {
    schema: {
      description: '检查是否是首次使用系统（无用户存在）',
      tags: ['Auth'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                isFirstUse: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const result = await authService.checkFirstUse();
    return reply.send({ success: true, data: result });
  });

  // Register
  app.post<{ Body: RegisterData }>('/auth/register', {
    schema: {
      description: '注册新用户',
      tags: ['Auth'],
      body: registerBodySchema,
      response: {
        201: authResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await authService.register(request.body);
      return reply.code(201).send({ success: true, data: result });
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: error.message });
    }
  });

  // Login
  app.post<{ Body: LoginData }>('/auth/login', {
    schema: {
      description: '使用用户名和密码登录',
      tags: ['Auth'],
      body: loginBodySchema,
      response: {
        200: authResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      const result = await authService.login(request.body);
      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.code(401).send({ success: false, error: error.message });
    }
  });

  // Get current user (requires JWT token)
  app.get<{ Headers: AuthHeaders }>('/auth/me', {
    schema: {
      description: '获取当前用户信息',
      tags: ['Auth'],
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string', description: 'JWT 令牌格式: Bearer <token>' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: userResponseSchema,
          },
        },
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ success: false, error: '未提供令牌' });
    }

    const token = authHeader.substring(7);
    const user = await authService.getUserFromToken(token);

    if (!user) {
      return reply.code(401).send({ success: false, error: '无效令牌' });
    }

    return reply.send({ success: true, data: user });
  });

  // Update profile (requires JWT token)
  app.put<{ Body: UpdateProfileData, Headers: AuthHeaders }>('/auth/profile', {
    schema: {
      description: '更新用户信息',
      tags: ['Auth'],
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string', description: 'JWT 令牌格式: Bearer <token>' },
        },
      },
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 50, description: '用户名' },
          avatar: { type: 'string', description: '头像索引（数字）' },
          preferredLanguage: { type: 'string', description: '界面语言：zh-CN / en-US' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: userResponseSchema,
          },
        },
        400: errorResponseSchema,
        401: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ success: false, error: '未提供令牌' });
    }

    const token = authHeader.substring(7);
    const user = await authService.getUserFromToken(token);

    if (!user) {
      return reply.code(401).send({ success: false, error: '无效令牌' });
    }

    try {
      const updatedUser = await authService.updateProfile(user.id, request.body);
      return reply.send({ success: true, data: updatedUser });
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: error.message });
    }
  });
}