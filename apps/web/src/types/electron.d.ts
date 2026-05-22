import 'react'

declare global {
  interface ElectronAPI {
    isElectron: boolean;
    platform: 'darwin' | 'win32' | 'linux';
    getServerUrl: () => Promise<string | null>;
    getMobileWebUrl: () => Promise<string | null>;
    getAppVersion: () => Promise<string>;
    getOpenAtLoginSettings: () => Promise<{
      success: boolean;
      data?: OpenAtLoginSettings;
      error?: string;
    }>;
    setOpenAtLogin: (enabled: boolean) => Promise<{
      success: boolean;
      data?: OpenAtLoginSettings;
      error?: string;
    }>;
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
      target?: 'system' | 'terminal' | 'vscode' | 'cursor' | 'trae' | 'trae-cn',
      terminalTarget?: 'terminal-app' | 'iterm2' | 'alacritty' | 'kitty' | 'ghostty' | 'wezterm' | 'kaku'
    ) => Promise<{ success: boolean; error?: string }>;
    selectFolder: () => Promise<{ success: boolean; path: string | null }>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    windowMinimize: () => Promise<void>;
    windowMaximize: () => Promise<void>;
    windowClose: () => Promise<void>;
    windowIsMaximized: () => Promise<boolean>;
    onServerReady: (callback: (port: number) => void) => () => void;
    onServerError: (callback: (error: string) => void) => () => void;
    getServerStatus: () => Promise<{
      ready: boolean;
      port: number | null;
      error: string | null;
      logPath?: string;
      runtime?: {
        phase: 'idle' | 'preparing' | 'ready' | 'failed';
        progress: RuntimePrepareProgress | null;
      };
    }>;
    appendDebugLog?: (message: string, payload?: unknown) => Promise<{ success: boolean; error?: string }>;
    openLogFolder?: () => Promise<{ success: boolean; error?: string }>;
    onRuntimePrepareStart?: (callback: () => void) => () => void;
    onRuntimePrepareProgress?: (callback: (progress: RuntimePrepareProgress) => void) => () => void;
    onRuntimePrepareDone?: (callback: () => void) => () => void;
    onRuntimePrepareError?: (callback: (error: string) => void) => () => void;
  }

  interface RuntimePrepareProgress {
    phase: 'extract' | 'copy';
    percent: number | null;
    files: number;
    bytes: number;
    totalBytes: number | null;
    message: string;
  }

  interface OpenAtLoginSettings {
    supported: boolean;
    openAtLogin: boolean;
    wasOpenedAtLogin: boolean;
    wasOpenedAsHidden: boolean;
    executableWillLaunchAtLogin?: boolean;
    status?: 'not-registered' | 'enabled' | 'requires-approval' | 'not-found';
  }

  interface UpdateInfo {
    version: string;
    url: string;
    macUrlArm64?: string;
    macUrlX64?: string;
    winUrl?: string;
    downloads?: { macArm64?: string; macX64?: string; win?: string };
    notes?: string;
    publishedAt?: string;
  }

  interface UpdateDownloadProgress {
    percent: number;
    transferred: number;
    total: number | null;
  }

  interface FlutterChannel {
    postMessage: (message: string) => void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
    FlutterChannel?: FlutterChannel;
  }
}

declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

export {}
