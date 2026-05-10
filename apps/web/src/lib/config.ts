// 开发模式下后端端口是 3001，打包模式下是 11053
const DEV_SERVER_PORT = 3001;
const PACKAGED_SERVER_PORT = 11053;
const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');

// 根据环境判断默认端口
const WEB_FALLBACK_URL = import.meta.env.DEV
  ? `http://localhost:${DEV_SERVER_PORT}`
  : `http://localhost:${PACKAGED_SERVER_PORT}`;

let cachedBaseUrl: string | null = null;

function getBrowserApiBaseUrl(): string {
  if (ENV_API_BASE_URL) {
    return ENV_API_BASE_URL;
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const { hostname, protocol } = window.location;

    if (import.meta.env.DEV) {
      return `${protocol}//${hostname}:${DEV_SERVER_PORT}`;
    }

    // 打包后的移动 Web 服务会把 API 和 Socket 请求反向代理到桌面端后端。
    return window.location.origin;
  }

  return WEB_FALLBACK_URL;
}

export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;

  if (typeof window !== 'undefined' && (window as any).electronAPI?.getServerUrl) {
    const url = await (window as any).electronAPI.getServerUrl();
    if (url) {
      cachedBaseUrl = url;
      return url;
    }
  }

  cachedBaseUrl = getBrowserApiBaseUrl();
  return cachedBaseUrl;
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}
