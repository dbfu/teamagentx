import 'react'

declare global {
  interface ElectronAPI {
    isElectron: boolean;
    platform: 'darwin' | 'win32' | 'linux';
    getServerUrl: () => Promise<string | null>;
    getMobileWebUrl: () => Promise<string | null>;
    getAppVersion: () => Promise<string>;
    getOpenTargetIcons: () => Promise<Partial<Record<'vscode' | 'cursor' | 'trae' | 'trae-cn', string | null>>>;
    openFolder: (
      path: string,
      target?: 'system' | 'vscode' | 'cursor' | 'trae' | 'trae-cn'
    ) => Promise<{ success: boolean; error?: string }>;
    selectFolder: () => Promise<{ success: boolean; path: string | null }>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    windowMinimize: () => Promise<void>;
    windowMaximize: () => Promise<void>;
    windowClose: () => Promise<void>;
    windowIsMaximized: () => Promise<boolean>;
    onServerReady: (callback: (port: number) => void) => () => void;
    onServerError: (callback: (error: string) => void) => () => void;
    getServerStatus: () => Promise<{ ready: boolean; port: number | null; error: string | null }>;
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
