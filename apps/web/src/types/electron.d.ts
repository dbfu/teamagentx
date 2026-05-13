interface ElectronAPI {
  isElectron: boolean;
  platform: 'darwin' | 'win32' | 'linux'; // 当前操作系统平台
  getServerUrl: () => Promise<string | null>;
  getMobileWebUrl: () => Promise<string | null>; // 获取局域网地址（用于手机连接）
  getAppVersion: () => Promise<string>; // 获取应用版本号
  checkForUpdates: () => Promise<{
    success: boolean;
    data?: { hasUpdate: boolean; currentVersion: string; update: UpdateInfo | null; noUrlConfigured?: boolean };
    error?: string;
  }>;
  downloadUpdate: (update: UpdateInfo) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  installUpdate: (filePath?: string) => Promise<{ success: boolean; error?: string }>;
  showUpdateInFolder: (filePath: string) => Promise<void>;
  onUpdateDownloadProgress: (callback: (progress: UpdateDownloadProgress) => void) => () => void;
  getOpenTargetIcons: () => Promise<Partial<Record<'vscode' | 'cursor' | 'trae' | 'trae-cn', string | null>>>;
  openFolder: (
    path: string,
    target?: 'system' | 'vscode' | 'cursor' | 'trae' | 'trae-cn'
  ) => Promise<{ success: boolean; error?: string }>;
  selectFolder: () => Promise<{ success: boolean; path: string | null }>;
  // 使用默认浏览器打开外部链接
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  // 窗口控制 API (用于 Windows 无边框窗口)
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  // 服务启动状态监听
  onServerReady: (callback: (port: number) => void) => () => void;
  onServerError: (callback: (error: string) => void) => () => void;
  getServerStatus: () => Promise<{ ready: boolean; port: number | null; error: string | null }>;
}

interface UpdateInfo {
  version: string;
  /** 兼容旧客户端的通用下载链接（fallback） */
  url: string;
  /** macOS 安装包下载链接 */
  macUrl?: string;
  /** Windows 安装包下载链接 */
  winUrl?: string;
  /** 各平台下载链接（新格式） */
  downloads?: { mac?: string; win?: string };
  notes?: string;
  publishedAt?: string;
}

interface UpdateDownloadProgress {
  percent: number;
  transferred: number;
  total: number | null;
}

// Flutter WebView Channel 接口
interface FlutterChannel {
  postMessage: (message: string) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
  FlutterChannel?: FlutterChannel;
}
