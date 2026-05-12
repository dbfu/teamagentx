import { contextBridge, ipcRenderer } from 'electron';

// 获取当前平台
const platform = process.platform;

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform, // 暴露平台信息给渲染进程
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getMobileWebUrl: () => ipcRenderer.invoke('get-mobile-web-url'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
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
});
