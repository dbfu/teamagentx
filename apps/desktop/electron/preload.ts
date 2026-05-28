import { contextBridge, ipcRenderer } from 'electron';

// 获取当前平台
const platform = process.platform;

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform, // 暴露平台信息给渲染进程
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getMobileWebUrl: () => ipcRenderer.invoke('get-mobile-web-url'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getOpenAtLoginSettings: () => ipcRenderer.invoke('app:get-open-at-login-settings'),
  setOpenAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:set-open-at-login', enabled),
  setActiveTaskState: (state: { hasActiveTasks: boolean; executingRoomCount: number }) =>
    ipcRenderer.send('app:active-task-state', state),
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
    target: 'system' | 'terminal' | 'vscode' | 'cursor' | 'trae' | 'trae-cn' = 'system',
    terminalTarget: 'terminal-app' | 'iterm2' | 'alacritty' | 'kitty' | 'ghostty' | 'wezterm' | 'kaku' = 'terminal-app'
  ) => ipcRenderer.invoke('open-folder', { path, target, terminalTarget }),
  runCommandInTerminal: (
    path: string,
    command: string,
    terminalTarget: 'terminal-app' | 'iterm2' | 'alacritty' | 'kitty' | 'ghostty' | 'wezterm' | 'kaku' = 'terminal-app'
  ) => ipcRenderer.invoke('terminal:run-command', { path, command, terminalTarget }),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  exportPdf: (payload: { html: string; filename: string }) => ipcRenderer.invoke('pdf:export', payload),
  // 使用默认浏览器打开外部链接
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  setBadgeCount: (count: number) => ipcRenderer.invoke('notification:set-badge-count', count),
  showNotification: (payload: { title: string; body: string; chatRoomId?: string }) => ipcRenderer.invoke('notification:show', payload),
  onNotificationOpen: (callback: (chatRoomId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chatRoomId: string) => callback(chatRoomId);
    ipcRenderer.on('notification:open-chatroom', handler);
    return () => ipcRenderer.removeListener('notification:open-chatroom', handler);
  },
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
  appendDebugLog: (message: string, payload?: unknown) => ipcRenderer.invoke('debug:append-log', { message, payload }),
  // Runtime（server 从 resources 解压/拷贝到 userData）准备事件。
  // 首次启动或升级后会触发 start → progress* → done/error，
  // UI 可借此显示"正在准备运行环境"和文件级进度。
  onRuntimePrepareStart: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('runtime:prepare-start', handler);
    return () => ipcRenderer.removeListener('runtime:prepare-start', handler);
  },
  onRuntimePrepareProgress: (
    callback: (progress: {
      phase: 'extract' | 'copy';
      percent: number | null;
      files: number;
      bytes: number;
      totalBytes: number | null;
      message: string;
    }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) =>
      callback(progress);
    ipcRenderer.on('runtime:prepare-progress', handler);
    return () => ipcRenderer.removeListener('runtime:prepare-progress', handler);
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
