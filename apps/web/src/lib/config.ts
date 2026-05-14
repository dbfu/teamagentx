// 开发模式下后端端口是 3001，打包模式下是 11053
const DEV_SERVER_PORT = 3001;
const PACKAGED_SERVER_PORT = 11053;
const importMetaEnv = (import.meta as ImportMeta & {
  env?: {
    DEV?: boolean;
    VITE_API_BASE_URL?: string;
  };
}).env;
const ENV_API_BASE_URL = importMetaEnv?.VITE_API_BASE_URL?.replace(/\/+$/, '');

// 根据环境判断默认端口
const WEB_FALLBACK_URL = importMetaEnv?.DEV
  ? `http://localhost:${DEV_SERVER_PORT}`
  : `http://localhost:${PACKAGED_SERVER_PORT}`;

let cachedBaseUrl: string | null = null;

function getBrowserApiBaseUrl(): string {
  if (ENV_API_BASE_URL) {
    return ENV_API_BASE_URL;
  }

  if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
    const { hostname, protocol } = window.location;

    if (importMetaEnv?.DEV) {
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

/**
 * 等待 Electron 后端服务就绪。
 * 非 Electron 环境直接 resolve；Electron 环境下等待 server-ready 事件。
 * 成功时缓存 server URL 到 cachedBaseUrl。
 */
export function waitForServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !(window as any).electronAPI) {
      resolve();
      return;
    }

    const api = (window as any).electronAPI;

    api.getServerStatus().then((status: { ready: boolean; port: number | null; error: string | null }) => {
      if (status.ready && status.port) {
        cachedBaseUrl = `http://localhost:${status.port}`;
        resolve();
        return;
      }

      if (status.error) {
        reject(new Error(status.error));
        return;
      }

      // 服务尚未就绪，监听事件
      const unsubReady = api.onServerReady((port: number) => {
        cachedBaseUrl = `http://localhost:${port}`;
        unsubReady();
        unsubError();
        resolve();
      });

      const unsubError = api.onServerError((error: string) => {
        unsubReady();
        unsubError();
        reject(new Error(error));
      });
    });
  });
}
