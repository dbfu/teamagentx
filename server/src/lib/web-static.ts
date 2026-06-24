import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 解析前端 SPA 构建产物目录（apps/web/dist）。
 *
 * 用于「单容器 / 独立服务端」部署：Fastify 同时托管前端静态资源 + API + Socket，
 * 客户端通过 IP 同源访问。开发模式下（Vite 独立 serve）产物不存在，返回 null，
 * 调用方据此跳过静态托管，保持原有行为。
 *
 * 优先级：WEB_DIST_DIR 环境变量 > 源码相对路径 > 当前工作目录相对路径。
 */
let cachedDistDir: string | null | undefined;

function resolveCandidates(): string[] {
  const candidates: string[] = [];
  const env = process.env.WEB_DIST_DIR?.trim();
  if (env) candidates.push(path.resolve(env));

  // server/src/lib -> 仓库根 apps/web/dist（开发/源码运行）
  const here = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(here, '../../../apps/web/dist'));

  // 以服务端 cwd 为基准的常见位置
  candidates.push(path.resolve(process.cwd(), '../apps/web/dist'));
  candidates.push(path.resolve(process.cwd(), 'web-dist'));

  return candidates;
}

export function getWebDistDir(): string | null {
  if (cachedDistDir !== undefined) return cachedDistDir;

  for (const candidate of resolveCandidates()) {
    if (existsSync(path.join(candidate, 'index.html'))) {
      cachedDistDir = candidate;
      return cachedDistDir;
    }
  }

  cachedDistDir = null;
  return null;
}

export function isWebServingEnabled(): boolean {
  return getWebDistDir() !== null;
}

/**
 * 将请求 URL 安全地解析为前端产物目录内的真实文件路径；
 * 不是真实文件（或越界尝试路径穿越）时返回 null。
 * 鉴权中间件据此放行前端静态资源，且不会误放行受保护 API。
 */
export function resolveWebStaticFile(url: string): string | null {
  const dist = getWebDistDir();
  if (!dist) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.split('?')[0]);
  } catch {
    return null;
  }

  if (pathname === '/' || pathname === '') {
    return path.join(dist, 'index.html');
  }

  const resolved = path.resolve(dist, `.${pathname}`);
  const root = path.resolve(dist);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null; // 防路径穿越
  }

  try {
    if (statSync(resolved).isFile()) return resolved;
  } catch {
    // 文件不存在
  }
  return null;
}
