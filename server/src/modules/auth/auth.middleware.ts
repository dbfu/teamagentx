import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from './auth.service.js';

/**
 * 认证中间件
 *
 * 验证所有 HTTP API 的 JWT token
 * 公开接口（登录、注册、健康检查等）跳过验证
 */

// 公开接口列表（不需要 token 验证）
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/register',
  '/auth/check-first-use',
  '/health',
  '/network-info',
  '/openapi.json',  // Swagger 文档
  '/setup/status',  // 设置向导状态检查
  '/setup/complete',  // 完成设置向导
  '/setup/install-tool',  // 引导阶段安装 ACP 工具（此时尚未注册/登录）
];

// 部分公开的路径前缀（静态资源等）
const PUBLIC_PREFIXES = [
  '/uploads/',  // 静态文件
  '/codex-router/',  // Codex 路由模式本地代理：codex 携带 provider key 调用，网关内部自校验内部 token
];

/**
 * 检查路径是否为公开接口
 */
function isPublicPath(url: string): boolean {
  // 完全匹配
  if (PUBLIC_PATHS.some(p => url === p || url.startsWith(p + '?'))) {
    return true;
  }

  // 前缀匹配
  if (PUBLIC_PREFIXES.some(p => url.startsWith(p))) {
    return true;
  }

  return false;
}

/**
 * 认证钩子
 *
 * 在每个请求到达前验证 token
 * 将用户信息挂载到 request.user 供后续使用
 */
export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // 跳过公开接口
  if (isPublicPath(request.url)) {
    return;
  }

  // 获取 Authorization header
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      success: false,
      error: '未登录',
      code: 'UNAUTHORIZED'
    });
  }

  const token = authHeader.substring(7);

  try {
    const user = await authService.getUserFromToken(token);

    if (!user) {
      return reply.code(401).send({
        success: false,
        error: '令牌无效或已过期',
        code: 'INVALID_TOKEN'
      });
    }

    // 挂载用户信息到 request
    // 使用类型扩展来支持 request.user
    (request as any).user = user;
  } catch (error) {
    return reply.code(401).send({
      success: false,
      error: '令牌验证失败',
      code: 'TOKEN_VERIFY_FAILED'
    });
  }
}

/**
 * 扩展 FastifyRequest 类型
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      username: string;
      avatar: string | null;
      createdAt: Date;
    };
  }
}