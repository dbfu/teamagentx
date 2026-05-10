interface ElectronAPI {
  isElectron: boolean;
  platform: 'darwin' | 'win32' | 'linux'; // 当前操作系统平台
  getServerUrl: () => Promise<string | null>;
  getMobileWebUrl: () => Promise<string | null>; // 获取局域网地址（用于手机连接）
  getAppVersion: () => Promise<string>; // 获取应用版本号
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
}

// Flutter WebView Channel 接口
interface FlutterChannel {
  postMessage: (message: string) => void;
}

interface Window {
  electronAPI?: ElectronAPI;
  FlutterChannel?: FlutterChannel;
}
