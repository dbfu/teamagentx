import { contextBridge, ipcRenderer } from 'electron';

// 获取当前平台
const platform = process.platform;

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform, // 暴露平台信息给渲染进程
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getMobileWebUrl: () => ipcRenderer.invoke('get-mobile-web-url'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (update: {
    version: string;
    url: string;
    macUrl?: string;
    winUrl?: string;
    downloads?: { mac?: string; win?: string };
    notes?: string;
    publishedAt?: string;
  }) => ipcRenderer.invoke('update:download', update),
  installUpdate: (filePath?: string) => ipcRenderer.invoke('update:install', filePath),
  showUpdateInFolder: (filePath: string) => ipcRenderer.invoke('update:show-in-folder', filePath),
  onUpdateDownloadProgress: (callback: (progress: { percent: number; transferred: number; total: number | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number | null }) => callback(progress);
    ipcRenderer.on('update:download-progress', handler);
    return () => ipcRenderer.removeListener('update:download-progress', handler);
  },
  getOpenTargetIcons: () => ipcRenderer.invoke('get-open-target-icons'),
  openFolder: (
    path: string,
    target: 'system' | 'vscode' | 'cursor' | 'trae' | 'trae-cn' = 'system'
  ) => ipcRenderer.invoke('open-folder', { path, target }),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  // 使用默认浏览器打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // 窗口控制 API (用于 Windows 无边框窗口)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // 服务启动状态监听（渲染器用于判断后端何时就绪）
  onServerReady: (callback: (port: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, port: number) => callback(port);
    ipcRenderer.on('server-ready', handler);
    return () => ipcRenderer.removeListener('server-ready', handler);
  },
  onServerError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('server-error', handler);
    return () => ipcRenderer.removeListener('server-error', handler);
  },
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  // Runtime（server 从 resources 拷贝到 userData）准备事件。
  // 首次启动或升级后会触发 start → done/error，UI 可借此显示"正在准备运行环境"。
  onRuntimePrepareStart: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('runtime:prepare-start', handler);
    return () => ipcRenderer.removeListener('runtime:prepare-start', handler);
  },
  onRuntimePrepareDone: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('runtime:prepare-done', handler);
    return () => ipcRenderer.removeListener('runtime:prepare-done', handler);
  },
  onRuntimePrepareError: (callback: (error: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('runtime:prepare-error', handler);
    return () => ipcRenderer.removeListener('runtime:prepare-error', handler);
  },
});
