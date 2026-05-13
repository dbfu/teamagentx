import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess } from 'electron';
import { UtilityProcess } from 'electron/main';
import { execFileSync, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日志文件路径 - 用于调试 Windows 启动问题
function getLogPath(): string {
  return path.join(app.getPath('userData'), 'electron-debug.log');
}

function writeLog(message: string): void {
  const logPath = getLogPath();
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, logMessage);
  } catch {
    // 忽略日志写入错误
  }
}

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: UtilityProcess | null = null;
let serverPort: number | null = null;
let mobileWebServer: http.Server | null = null;
let mobileWebPort: number | null = null;
let isQuitting = false;

const MOBILE_WEB_PORT = 11054;
const MOBILE_WEB_HOST = '0.0.0.0';
const API_PROXY_PREFIXES = [
  '/auth',
  '/agents',
  '/categories',
  '/chatrooms',
  '/cron-tasks',
  '/health',
  '/llm-providers',
  '/messages',
  '/openapi.json',
  '/skills',
  '/socket.io',
  '/token-usage',
  '/upload',
  '/uploads',
];

/**
 * 从网络接口中找到局域网 IP
 */
function findLocalIp(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  // 优先顺序：192.168.x.x > 10.x.x.x > 172.16-31.x.x
  const candidates: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;

    for (const net of nets) {
      // 跳过内部和非 IPv4 地址
      if (net.internal || net.family !== 'IPv4') continue;

      const ip = net.address;
      const parts = ip.split('.');
      if (parts.length !== 4) continue;

      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);

      // 192.168.x.x - 最常见的家庭局域网
      if (first === 192 && second === 168) {
        candidates.unshift(ip); // 最高优先级
      }
      // 10.x.x.x
      else if (first === 10) {
        candidates.push(ip);
      }
      // 172.16-31.x.x
      else if (first === 172 && second >= 16 && second <= 31) {
        candidates.push(ip);
      }
    }
  }

  return candidates[0] || null;
}

type FolderOpenTarget = 'system' | 'vscode' | 'cursor' | 'trae' | 'trae-cn';

const EDITOR_APP_NAMES: Record<Exclude<FolderOpenTarget, 'system'>, string> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  trae: 'Trae',
  'trae-cn': 'Trae CN',
};

// macOS app paths
const MAC_APP_CANDIDATES: Record<Exclude<FolderOpenTarget, 'system'>, string[]> = {
  vscode: [
    '/Applications/Visual Studio Code.app',
    '~/Applications/Visual Studio Code.app',
  ],
  cursor: [
    '/Applications/Cursor.app',
    '~/Applications/Cursor.app',
  ],
  trae: [
    '/Applications/Trae.app',
    '~/Applications/Trae.app',
  ],
  'trae-cn': [
    '/Applications/Trae CN.app',
    '~/Applications/Trae CN.app',
  ],
};

// Windows app paths (user may install to LocalAppData or ProgramFiles)
const WIN_APP_CANDIDATES: Record<Exclude<FolderOpenTarget, 'system'>, string[]> = {
  vscode: [
    '${LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe',
    '${PROGRAMFILES}\\Microsoft VS Code\\Code.exe',
  ],
  cursor: [
    '${LOCALAPPDATA}\\Programs\\Cursor\\Cursor.exe',
    '${PROGRAMFILES}\\Cursor\\Cursor.exe',
  ],
  trae: [
    '${LOCALAPPDATA}\\Programs\\Trae\\Trae.exe',
  ],
  'trae-cn': [
    '${LOCALAPPDATA}\\Programs\\Trae CN\\Trae CN.exe',
  ],
};

function getAppCandidates(target: Exclude<FolderOpenTarget, 'system'>): string[] {
  if (process.platform === 'win32') {
    const candidates = WIN_APP_CANDIDATES[target];
    // Expand environment variables
    return candidates.map(p => {
      return p
        .replace('${LOCALAPPDATA}', process.env.LOCALAPPDATA || '')
        .replace('${PROGRAMFILES}', process.env.ProgramFiles || '');
    });
  }
  return MAC_APP_CANDIDATES[target];
}

function resolveFolderPath(folderPath: string): string {
  return folderPath.startsWith('~')
    ? path.join(app.getPath('home'), folderPath.slice(1))
    : folderPath;
}

function openFolderInApp(folderPath: string, appName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      // Windows: use spawn with the app executable
      spawn(appName, [folderPath], { detached: true, stdio: 'ignore' });
      resolve();
    } else {
      // macOS: use 'open' command
      execFile('open', ['-a', appName, folderPath], (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve();
      });
    }
  });
}

function resolveExistingAppPath(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const resolvedPath = resolveFolderPath(candidate);
    if (pathExists(resolvedPath)) {
      return resolvedPath;
    }
  }
  return null;
}

function pathExists(targetPath: string): boolean {
  return fs.existsSync(targetPath);
}

function getServerProjectRoot(): string {
  // Dev: server/ directory at project root (repo root = electron/../../..)
  if (!app.isPackaged) {
    return path.resolve(__dirname, '../../..', 'server');
  }
  // Production: server/ under resources path (alongside app.asar)
  return path.join(process.resourcesPath, 'server');
}

function getServerNodeModulesPath(): string {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '../../..', 'server', 'node_modules');
  }
  return path.join(process.resourcesPath, 'server', 'node_modules');
}

function getRendererDistPath(): string {
  return path.join(__dirname, '../dist');
}

function isApiProxyPath(pathname: string): boolean {
  return API_PROXY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return contentTypes[ext] || 'application/octet-stream';
}

function sendTextResponse(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function proxyHttpRequest(req: IncomingMessage, res: ServerResponse, apiPort: number): void {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${apiPort}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (error) => {
    writeLog(`Mobile web proxy error: ${error.message}`);
    if (!res.headersSent) {
      sendTextResponse(res, 502, 'Bad gateway');
    } else {
      res.end();
    }
  });

  // Handle client connection errors
  req.on('error', (error) => {
    writeLog(`Mobile web client request error: ${error.message}`);
    proxyReq.destroy();
  });

  req.on('aborted', () => {
    writeLog('Mobile web client request aborted');
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
}

function proxyUpgradeRequest(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  apiPort: number,
): void {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: apiPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${apiPort}`,
    },
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const statusMessage = proxyRes.statusMessage || 'Switching Protocols';
    const responseHeaders = [`HTTP/${req.httpVersion} ${proxyRes.statusCode} ${statusMessage}`];

    Object.entries(proxyRes.headers).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => responseHeaders.push(`${key}: ${item}`));
      } else if (value !== undefined) {
        responseHeaders.push(`${key}: ${value}`);
      }
    });

    socket.write(`${responseHeaders.join('\r\n')}\r\n\r\n`);
    if (proxyHead.length > 0) {
      socket.write(proxyHead);
    }
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // Handle errors on both sockets
    proxySocket.on('error', (error) => {
      writeLog(`Proxy socket error: ${error.message}`);
      socket.destroy();
    });

    socket.on('error', (error) => {
      writeLog(`Client socket error: ${error.message}`);
      proxySocket.destroy();
    });

    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', (error) => {
    writeLog(`Mobile web upgrade proxy error: ${error.message}`);
    socket.destroy();
  });

  // Handle client socket errors before proxy
  socket.on('error', (error) => {
    writeLog(`Client socket error before upgrade: ${error.message}`);
    proxyReq.destroy();
  });

  proxyReq.end();
}

function serveStaticFile(
  pathname: string,
  res: ServerResponse,
  distPath: string,
  indexPath: string,
): void {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    sendTextResponse(res, 400, 'Bad request');
    return;
  }

  const relativePath = decodedPathname === '/' ? '/index.html' : decodedPathname;
  const filePath = path.normalize(path.join(distPath, relativePath));
  const relativeToDist = path.relative(distPath, filePath);

  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
    sendTextResponse(res, 403, 'Forbidden');
    return;
  }

  const sendFile = (targetPath: string) => {
    res.writeHead(200, {
      'Content-Type': getContentType(targetPath),
      'Cache-Control': targetPath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(targetPath).pipe(res);
  };

  fs.stat(filePath, (error, stats) => {
    if (!error && stats.isFile()) {
      sendFile(filePath);
      return;
    }

    sendFile(indexPath);
  });
}

function startMobileWebServer(apiPort: number): Promise<number> {
  writeLog('startMobileWebServer called');

  if (mobileWebServer && mobileWebPort) {
    return Promise.resolve(mobileWebPort);
  }

  const distPath = getRendererDistPath();
  const indexPath = path.join(distPath, 'index.html');
  writeLog(`Mobile web dist path: ${distPath}`);
  writeLog(`Mobile web index exists: ${fs.existsSync(indexPath)}`);

  if (!fs.existsSync(indexPath)) {
    return Promise.reject(new Error(`Renderer dist not found: ${indexPath}`));
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', 'http://localhost');

      if (isApiProxyPath(requestUrl.pathname)) {
        proxyHttpRequest(req, res, apiPort);
        return;
      }

      serveStaticFile(requestUrl.pathname, res, distPath, indexPath);
    });

    server.on('upgrade', (req, socket, head) => {
      const requestUrl = new URL(req.url || '/', 'http://localhost');
      if (isApiProxyPath(requestUrl.pathname)) {
        proxyUpgradeRequest(req, socket, head, apiPort);
        return;
      }
      socket.destroy();
    });

    server.on('error', (error) => {
      writeLog(`Mobile web server error: ${error.message}`);
      reject(error);
    });

    server.listen(MOBILE_WEB_PORT, MOBILE_WEB_HOST, () => {
      mobileWebServer = server;
      mobileWebPort = MOBILE_WEB_PORT;
      writeLog(`Mobile web server started on http://${MOBILE_WEB_HOST}:${MOBILE_WEB_PORT}`);
      resolve(MOBILE_WEB_PORT);
    });
  });
}

function stopMobileWebServer(): void {
  if (mobileWebServer) {
    mobileWebServer.close();
    mobileWebServer = null;
    mobileWebPort = null;
  }
}

/**
 * 通过启动用户 shell 来获取完整 PATH 环境变量。
 *
 * Electron.app 启动时不加载用户的 shell profile（.zshrc / .bashrc 等），
 * 导致 nvm / fnm / volta 等版本管理器添加的 node 路径缺失。
 * 不同用户会把初始化脚本放在 login profile 或 interactive rc 文件里，
 * 所以这里同时尝试 login 和 interactive shell，并合并兜底路径。
 */
function resolveShellPath(): string {
  const separator = process.platform === 'win32' ? ';' : ':';
  const fallback = buildFallbackPath();

  // Windows 不走这一套
  if (process.platform === 'win32') {
    return fallback;
  }

  const pathParts: string[] = [];

  // 按优先级尝试用户 shell。zsh -l 读取 .zprofile，zsh -i 读取 .zshrc；
  // 很多 nvm/fnm 配置只在 .zshrc 里，单用 login shell 会漏掉 node。
  const userShell = process.env.SHELL || '';
  const shells = [userShell, '/bin/zsh', '/bin/bash'].filter(
    (s, i, arr) => s && arr.indexOf(s) === i,
  );
  const shellModes = [
    { label: 'login', args: ['-l', '-c', 'printf "%s" "$PATH"'] },
    { label: 'interactive', args: ['-i', '-c', 'printf "%s" "$PATH"'] },
  ];

  for (const shell of shells) {
    for (const mode of shellModes) {
      try {
        const output = execFileSync(shell, mode.args, {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env, TERM: process.env.TERM || 'dumb' },
        }).trim();

        if (output && output.includes('/')) {
          writeLog(`[PATH] resolved from ${mode.label} shell (${shell}): ${output.slice(0, 200)}...`);
          pathParts.push(...output.split(separator));
        }
      } catch {
        writeLog(`[PATH] ${mode.label} shell (${shell}) failed, trying next`);
      }
    }
  }

  pathParts.push(...fallback.split(separator));
  const resolved = Array.from(new Set(pathParts.filter(Boolean))).join(separator);
  writeLog(`[PATH] final resolved path: ${resolved.slice(0, 200)}...`);
  return resolved;
}

function getExistingPath(pathValue: string): string | null {
  return fs.existsSync(pathValue) ? pathValue : null;
}

function getNodeVersionManagerPaths(home: string): string[] {
  const paths = [
    getExistingPath(path.join(home, '.volta', 'bin')),
    getExistingPath(path.join(home, '.asdf', 'shims')),
    getExistingPath(path.join(home, '.nodenv', 'shims')),
    getExistingPath(path.join(home, '.local', 'share', 'mise', 'shims')),
    getExistingPath(path.join(home, 'Library', 'pnpm')),
  ].filter(Boolean) as string[];

  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    for (const version of fs.readdirSync(nvmVersionsDir).sort().reverse()) {
      const binDir = getExistingPath(path.join(nvmVersionsDir, version, 'bin'));
      if (binDir) paths.push(binDir);
    }
  }

  for (const fnmRoot of [
    path.join(home, '.fnm', 'node-versions'),
    path.join(home, '.local', 'share', 'fnm', 'node-versions'),
  ]) {
    if (!fs.existsSync(fnmRoot)) continue;
    for (const version of fs.readdirSync(fnmRoot).sort().reverse()) {
      const binDir = getExistingPath(path.join(fnmRoot, version, 'installation', 'bin'));
      if (binDir) paths.push(binDir);
    }
  }

  return paths;
}

/**
 * 兜底 PATH：login shell 全部失败时使用的基础路径
 */
function buildFallbackPath(): string {
  const home = app.getPath('home');
  const separator = process.platform === 'win32' ? ';' : ':';

  if (process.platform === 'win32') {
    return [
      path.join(process.env.LOCALAPPDATA || home, 'Programs'),
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
      'C:\\Windows\\System32',
      'C:\\Windows',
      process.env.PATH || '',
    ].filter(Boolean).join(separator);
  }

  return [
    ...getNodeVersionManagerPaths(home),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/bin',
    '/bin',
    process.env.PATH || '',
  ].filter(Boolean).join(separator);
}

function startServer(): Promise<number> {
  writeLog('startServer called');
  return new Promise((resolve, reject) => {
    const projectRoot = getServerProjectRoot();
    writeLog(`Server project root: ${projectRoot}`);

    // Set DATABASE_URL to user data directory
    const dbPath = path.join(app.getPath('userData'), 'teamagentx.db');
    // Set UPLOADS_DIR to user data directory (not inside app)
    const uploadsDir = path.join(app.getPath('userData'), 'uploads');

    // Use Electron's utilityProcess to run the server
    // This is the correct way to spawn Node.js child processes in Electron
    const nodeModulesPath = getServerNodeModulesPath();
    const serverEntry = path.join(projectRoot, 'dist', 'electron-entry.js');
    writeLog(`Server entry: ${serverEntry}`);
    writeLog(`Node modules path: ${nodeModulesPath}`);
    writeLog(`Server entry exists: ${fs.existsSync(serverEntry)}`);

    const fullPath = resolveShellPath();

    // Electron 打包时固定端口为 11053
    const fixedPort = 11053;

    serverProcess = utilityProcess.fork(serverEntry, [], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PATH: fullPath,
        DATABASE_URL: `file:${dbPath}`,
        UPLOADS_DIR: uploadsDir,
        NODE_PATH: nodeModulesPath,
        ELECTRON: 'true',
        ACPX_FALLBACK: 'true',
      },
      stdio: 'pipe',
    });

    let outputBuffer = '';

    serverProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      writeLog(`Server stdout: ${text.trim()}`);

      // Parse port from output: __ELECTRON_PORT__:XXXX
      const match = text.match(/__ELECTRON_PORT__:(\d+)/);
      if (match) {
        serverPort = parseInt(match[1], 10);
        writeLog(`Server started on port: ${serverPort}`);
        process.stdout.write(data);
        resolve(serverPort);
      } else {
        process.stdout.write(data);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      writeLog(`Server stderr: ${text.trim()}`);
      process.stderr.write(data);
    });

    serverProcess.on('exit', (code) => {
      writeLog(`Server process exited with code: ${code}`);
      if (serverPort === null) {
        reject(
          new Error(
            `Server process exited with code ${code} before port was assigned`,
          ),
        );
      }
      serverProcess = null;
    });

    // Set a timeout to reject if server doesn't start
    setTimeout(() => {
      if (serverPort === null) {
        reject(
          new Error(
            'Server startup timeout - no port received within 30 seconds',
          ),
        );
      }
    }, 30000);
  });
}

function applyDefaultZoom(window: BrowserWindow) {
  const { webContents } = window;

  // Reset any persisted Chromium zoom state to keep the UI crisp on Retina displays.
  webContents.setZoomFactor(1);
  void webContents.setVisualZoomLevelLimits(1, 1);

  webContents.on('did-finish-load', () => {
    webContents.setZoomFactor(1);
  });
}

function shouldOpenInExternalBrowser(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function showMainWindow() {
  if (!mainWindow) {
    if (serverPort) {
      createWindow(serverPort);
    }
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function resolveTrayIconPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath, 'tray-icon.png'),
    path.join(__dirname, 'tray-icon.png'),
    path.join(__dirname, '../electron/tray-icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../electron/icon.png'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function createTray() {
  if (tray) return;

  const trayIconPath = resolveTrayIconPath();
  if (!trayIconPath) {
    writeLog('Tray icon not found, skipping tray creation');
    return;
  }

  const trayIconSize = process.platform === 'darwin' ? 16 : 20;
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({
    width: trayIconSize,
    height: trayIconSize,
  });

  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('TeamAgentX');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 TeamAgentX',
        click: showMainWindow,
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createWindow(_port: number) {
  if (mainWindow) {
    showMainWindow();
    return;
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 800,
    minWidth: 1100,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // 允许 file:// 协议访问 localhost API
      zoomFactor: 1,
    },
  };

  // macOS 特有的标题栏样式
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 12, y: 12 };
  } else if (process.platform === 'win32') {
    // Windows: 使用无边框窗口，自定义标题栏
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  applyDefaultZoom(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenInExternalBrowser(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    event.preventDefault();
    mainWindow?.hide();
  });

  if (!app.isPackaged) {
    // Dev: load Vite dev server (supports dynamic port)
    const viteUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow.loadURL(viteUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // Production: use file:// protocol for localStorage support
    const distPath = path.join(__dirname, '../dist');
    mainWindow.loadFile(path.join(distPath, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  writeLog('App ready, initializing...');
  writeLog(`Platform: ${process.platform}, Arch: ${process.arch}`);
  writeLog(`App path: ${app.getAppPath()}`);
  writeLog(`User data path: ${app.getPath('userData')}`);
  writeLog(`Resources path: ${process.resourcesPath}`);
  writeLog(`Is packaged: ${app.isPackaged}`);

  ipcMain.handle('get-server-url', () => {
    return serverPort ? `http://localhost:${serverPort}` : null;
  });

  // 获取局域网地址（用于手机连接）
  ipcMain.handle('get-mobile-web-url', () => {
    if (!mobileWebPort) return null;

    // 获取局域网 IP
    const interfaces = os.networkInterfaces();
    const localIp = findLocalIp(interfaces);

    if (localIp) {
      return `http://${localIp}:${mobileWebPort}`;
    }
    return null;
  });

  // 获取应用版本号
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // 窗口控制 IPC handlers (用于 Windows 无边框窗口)
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('get-open-target-icons', async () => {
    const targets = Object.keys(MAC_APP_CANDIDATES) as Array<Exclude<FolderOpenTarget, 'system'>>;
    const entries = await Promise.all(
      targets.map(async (target) => {
        try {
          const appPath = resolveExistingAppPath(getAppCandidates(target));
          if (!appPath) return [target, null] as const;

          const icon = await app.getFileIcon(appPath, { size: 'small' });
          return [target, icon.isEmpty() ? null : icon.toDataURL()] as const;
        } catch {
          return [target, null] as const;
        }
      })
    );

    return Object.fromEntries(entries);
  });

  // 打开本地目录
  ipcMain.handle('open-folder', async (_event, payload: { path: string; target?: FolderOpenTarget } | string) => {
    const folderPath = typeof payload === 'string' ? payload : payload.path;
    const target = typeof payload === 'string' ? 'system' : (payload.target || 'system');
    const resolvedPath = resolveFolderPath(folderPath);

    try {
      // 确保目录存在（如果不存在则创建）
      if (!fs.existsSync(resolvedPath)) {
        fs.mkdirSync(resolvedPath, { recursive: true });
      }

      if (target === 'system') {
        const errorMessage = await shell.openPath(resolvedPath);
        if (errorMessage) {
          return { success: false, error: errorMessage };
        }
      } else {
        const appPath = resolveExistingAppPath(getAppCandidates(target));
        if (!appPath) {
          return { success: false, error: `${target} not found` };
        }
        await openFolderInApp(resolvedPath, appPath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 选择本地目录
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择工作目录',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, path: null };
    }

    return { success: true, path: result.filePaths[0] };
  });

  // 使用默认浏览器打开外部链接
  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  try {
    writeLog('Starting server...');
    serverPort = await startServer();
    if (app.isPackaged) {
      await startMobileWebServer(serverPort);
    }
    writeLog('Server started, creating window...');
    createTray();
    createWindow(serverPort);
    writeLog('Window created successfully');
  } catch (error) {
    writeLog(`Failed to start server: ${error}`);
    console.error('Failed to start server:', error);
    app.quit();
  }

  app.on('activate', async () => {
    if (mainWindow) {
      showMainWindow();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      // Restart server if it was stopped (macOS: window closed but app still running)
      if (serverPort === null) {
        try {
          serverPort = await startServer();
          if (app.isPackaged) {
            await startMobileWebServer(serverPort);
          }
        } catch (error) {
          console.error('Failed to restart server:', error);
          app.quit();
          return;
        }
      }
      createWindow(serverPort);
    }
  });
});

app.on('second-instance', () => {
  showMainWindow();
});

app.on('window-all-closed', () => {
  if (!isQuitting) return;

  stopMobileWebServer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  // Reset serverPort so we know server is not running
  serverPort = null;
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopMobileWebServer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverPort = null;
  }
});

// Handle uncaught exceptions to prevent error dialogs
process.on('uncaughtException', (error) => {
  writeLog(`Uncaught exception: ${error.message}`);
  console.error('Uncaught exception:', error);
  // Don't quit on ECONNRESET - it's a common network error that can be safely ignored
  if (error.message.includes('ECONNRESET') || (error as NodeJS.ErrnoException).code === 'ECONNRESET') {
    writeLog('ECONNRESET error ignored');
    return;
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  writeLog(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  console.error('Unhandled rejection:', reason);
});
