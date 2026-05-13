import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess } from 'electron';
import { UtilityProcess } from 'electron/main';
import { execFileSync, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import os from 'node:os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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
let quitRequestedByInstaller = false;
let shutdownPromise: Promise<void> | null = null;
let shutdownCompleted = false;
let downloadedUpdatePath: string | null = null;

const MOBILE_WEB_PORT = 11054;
const MOBILE_WEB_HOST = '0.0.0.0';
// 由 vite.config.ts 的 define 在构建时注入，值来自 apps/desktop/.env 的 VITE_UPDATE_CHECK_URL。
// 配置方法：在 apps/desktop/.env 中设置 VITE_UPDATE_CHECK_URL=https://yoursite.com/update.json
declare const __UPDATE_CHECK_URL__: string;
const UPDATE_CHECK_URL: string = (typeof __UPDATE_CHECK_URL__ !== 'undefined' ? __UPDATE_CHECK_URL__ : '') || '';
const UPDATE_DOWNLOAD_DIR = 'updates';
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

type UpdateInfo = {
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
};

type DownloadProgress = {
  percent: number;
  transferred: number;
  total: number | null;
};

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

function compareVersions(a: string, b: string): number {
  const left = a.replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = b.replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  return 0;
}

function getStringField(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeUpdateInfo(payload: unknown): UpdateInfo {
  if (!payload || typeof payload !== 'object') {
    throw new Error('更新信息格式不正确');
  }

  const data = payload as Record<string, unknown>;
  const version = getStringField(data, ['version', 'latestVersion', 'tag_name']);

  // 提取平台专属链接
  const macUrl = getStringField(data, ['macUrl']) || undefined;
  const winUrl = getStringField(data, ['winUrl']) || undefined;

  // 提取 downloads 子对象中的链接
  const downloadsRaw = data['downloads'];
  let downloadsMac: string | undefined;
  let downloadsWin: string | undefined;
  if (downloadsRaw && typeof downloadsRaw === 'object') {
    const dl = downloadsRaw as Record<string, unknown>;
    downloadsMac = typeof dl['mac'] === 'string' && dl['mac'] ? dl['mac'] : undefined;
    downloadsWin = typeof dl['win'] === 'string' && dl['win'] ? dl['win'] : undefined;
  }

  // 兼容旧格式：通用 url 字段
  const url = getStringField(data, ['url', 'downloadUrl', 'downloadURL', 'latestDownloadUrl']);

  // 至少要有某个可用的下载链接
  const hasSomeUrl = url || macUrl || winUrl || downloadsMac || downloadsWin;
  if (!version || !hasSomeUrl) {
    throw new Error('更新信息缺少 version 或下载链接');
  }

  return {
    version,
    url: url || macUrl || winUrl || downloadsMac || downloadsWin || '',
    macUrl: macUrl || downloadsMac,
    winUrl: winUrl || downloadsWin,
    downloads: (downloadsMac || downloadsWin) ? { mac: downloadsMac, win: downloadsWin } : undefined,
    notes: getStringField(data, ['notes', 'releaseNotes', 'body']) || undefined,
    publishedAt: getStringField(data, ['publishedAt', 'published_at']) || undefined,
  };
}

/**
 * 根据当前运行平台，从 UpdateInfo 中选取对应的下载链接。
 * 优先级：平台专属链接 > 通用 url 字段。
 */
function getPlatformDownloadUrl(update: UpdateInfo): string {
  if (process.platform === 'darwin') {
    return update.macUrl || update.downloads?.mac || update.url;
  }
  if (process.platform === 'win32') {
    return update.winUrl || update.downloads?.win || update.url;
  }
  // Linux 等其他平台 fallback 到通用链接
  return update.url;
}

function requestJson(url: string, redirectCount = 0): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { Accept: 'application/json' } }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error('更新检查重定向次数过多'));
          return;
        }
        resolve(requestJson(new URL(location, url).toString(), redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`更新检查失败：HTTP ${statusCode}`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('更新信息不是有效 JSON'));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error('更新检查超时'));
    });
  });
}

async function checkForUpdate(): Promise<{ hasUpdate: boolean; currentVersion: string; update: UpdateInfo | null; noUrlConfigured?: boolean }> {
  const currentVersion = app.getVersion();

  if (!UPDATE_CHECK_URL) {
    writeLog('[Update] 未配置更新检查地址（VITE_UPDATE_CHECK_URL 为空），跳过检查');
    return { hasUpdate: false, currentVersion, update: null, noUrlConfigured: true };
  }

  writeLog(`[Update] 开始检查更新，当前版本：${currentVersion}，检查地址：${UPDATE_CHECK_URL}`);

  let payload: unknown;
  try {
    payload = await requestJson(UPDATE_CHECK_URL);
    writeLog(`[Update] 更新接口响应：${JSON.stringify(payload)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    writeLog(`[Update] 更新接口请求失败：${msg}`);
    throw error;
  }

  const update = normalizeUpdateInfo(payload);
  const hasUpdate = compareVersions(update.version, currentVersion) > 0;
  writeLog(`[Update] 最新版本：${update.version}，hasUpdate：${hasUpdate}`);

  return { hasUpdate, currentVersion, update };
}

function getDownloadFileName(downloadUrl: string): string {
  try {
    const parsed = new URL(downloadUrl);
    const basename = path.basename(parsed.pathname);
    if (basename && basename.includes('.')) return basename;
  } catch {
    // fall through
  }

  const ext = process.platform === 'win32' ? '.exe' : process.platform === 'darwin' ? '.dmg' : '.AppImage';
  return `TeamAgentX-${Date.now()}${ext}`;
}

function sendUpdateProgress(progress: DownloadProgress): void {
  mainWindow?.webContents.send('update:download-progress', progress);
}

function downloadFile(downloadUrl: string, destination: string, redirectCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    // settled 守卫：防止多个错误路径同时触发导致二次 reject 变成未处理 rejection
    let settled = false;
    const safeResolve = (value: string) => { if (!settled) { settled = true; resolve(value); } };
    const safeReject = (error: Error) => { if (!settled) { settled = true; reject(error); } };

    const client = downloadUrl.startsWith('https:') ? https : http;
    const request = client.get(downloadUrl, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        if (redirectCount >= 5) {
          safeReject(new Error('安装包下载重定向次数过多'));
          return;
        }
        resolve(downloadFile(new URL(location, downloadUrl).toString(), destination, redirectCount + 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        safeReject(new Error(`安装包下载失败：HTTP ${statusCode}`));
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const total = Number.parseInt(String(response.headers['content-length'] || ''), 10);
      let transferred = 0;
      const file = fs.createWriteStream(destination);

      // 统一清理：关闭文件流、删除残留文件、触发 reject
      const cleanup = (error: Error) => {
        writeLog(`[Update] 下载出错，清理残留文件：${error.message}`);
        file.destroy();
        fs.rm(destination, { force: true }, () => safeReject(error));
      };

      response.on('error', cleanup);

      response.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        sendUpdateProgress({
          percent: Number.isFinite(total) && total > 0 ? Math.round((transferred / total) * 100) : 0,
          transferred,
          total: Number.isFinite(total) && total > 0 ? total : null,
        });
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => safeResolve(destination));
      });
      file.on('error', cleanup);
    });

    request.on('error', (error) => safeReject(error instanceof Error ? error : new Error(String(error))));
    request.setTimeout(120000, () => {
      request.destroy(new Error('安装包下载超时'));
    });
  });
}

async function downloadUpdate(update: UpdateInfo): Promise<{ success: true; filePath: string }> {
  const downloadUrl = getPlatformDownloadUrl(update);
  const filePath = path.join(app.getPath('userData'), UPDATE_DOWNLOAD_DIR, getDownloadFileName(downloadUrl));
  downloadedUpdatePath = await downloadFile(downloadUrl, filePath);
  sendUpdateProgress({ percent: 100, transferred: 1, total: 1 });
  return { success: true, filePath: downloadedUpdatePath };
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

function stopMobileWebServerAsync(): Promise<void> {
  if (!mobileWebServer) {
    mobileWebPort = null;
    return Promise.resolve();
  }

  const server = mobileWebServer;
  mobileWebServer = null;
  mobileWebPort = null;

  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 3000);
  });
}

function stopServerProcessAsync(): Promise<void> {
  if (!serverProcess) {
    serverPort = null;
    return Promise.resolve();
  }

  const processToStop = serverProcess;
  const pid = processToStop.pid;
  serverProcess = null;
  serverPort = null;

  return new Promise((resolve) => {
    processToStop.once('exit', () => {
      writeLog(`[Shutdown] server process exited (pid=${pid})`);
      resolve();
    });

    if (process.platform === 'win32' && pid) {
      // Windows: taskkill /F /T 强制终止整个进程树（含 agent 产生的所有子进程），
      // 单纯 kill() 只发信号，无法保证子进程一并退出，NSIS 会检测到残留进程。
      writeLog(`[Shutdown] taskkill /F /T /PID ${pid}`);
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000 });
      } catch (e) {
        writeLog(`[Shutdown] taskkill failed: ${e}, fallback to kill()`);
        processToStop.kill();
      }
    } else {
      processToStop.kill();
    }

    setTimeout(resolve, 5000);
  });
}

async function shutdownBackend(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    await stopMobileWebServerAsync();
    await stopServerProcessAsync();
    shutdownCompleted = true;
  })();

  return shutdownPromise;
}

async function requestAppQuit(): Promise<void> {
  isQuitting = true;
  await shutdownBackend();
  app.quit();
}

async function installDownloadedUpdate(filePath?: string): Promise<{ success: boolean; error?: string }> {
  const installerPath = filePath || downloadedUpdatePath;
  if (!installerPath || !fs.existsSync(installerPath)) {
    return { success: false, error: '安装包不存在，请重新下载' };
  }

  try {
    quitRequestedByInstaller = true;
    isQuitting = true;
    await shutdownBackend();

    if (process.platform === 'win32') {
      // 不能先卸载旧版再装新版——新版安装失败会让用户两头落空。
      // 正确做法：用 /S（静默模式）直接运行新安装包。
      // NSIS 静默模式跳过所有 UI 页面（含"关闭应用"检测页），直接覆盖文件，
      // 旧版文件在安装成功后才被替换，安装失败时旧版依然可用。
      //
      // 流程：等当前进程退出 → 强杀残留子进程 → /S 静默安装新版
      const safeInstallerPath = installerPath.replace(/'/g, "''");
      const scriptLines = [
        'Start-Sleep -Milliseconds 800',
        "Stop-Process -Name 'TeamAgentX' -Force -ErrorAction SilentlyContinue",
        'Start-Sleep -Milliseconds 300',
        `Start-Process -FilePath '${safeInstallerPath}' -ArgumentList '/S' -Wait`,
      ];

      const scriptPath = path.join(app.getPath('temp'), 'teamagentx-update.ps1');
      fs.writeFileSync(scriptPath, scriptLines.join('\r\n'), 'utf8');
      writeLog(`[Update] 写入静默安装脚本：${scriptPath}`);

      spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { detached: true, stdio: 'ignore' },
      ).unref();

      writeLog('[Update] 主进程立即退出，PowerShell 脚本接管静默安装');
      process.exit(0);
    }

    // macOS / Linux：直接打开安装包后退出
    writeLog(`[Update] 打开安装包：${installerPath}`);
    const errorMessage = await shell.openPath(installerPath);
    if (errorMessage) {
      writeLog(`[Update] shell.openPath 失败：${errorMessage}`);
      quitRequestedByInstaller = false;
      return { success: false, error: errorMessage };
    }

    writeLog('[Update] 安装包已启动，退出当前进程');
    setTimeout(() => process.exit(0), 500);
    return { success: true };
  } catch (error) {
    quitRequestedByInstaller = false;
    return { success: false, error: String(error) };
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
    const databaseUrl = pathToFileURL(dbPath).href;
    // Set UPLOADS_DIR to user data directory (not inside app)
    const uploadsDir = path.join(app.getPath('userData'), 'uploads', 'images');
    // 本地工具安装目录
    const toolsDir = path.join(app.getPath('userData'), 'tools');

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
        DATABASE_URL: databaseUrl,
        UPLOADS_DIR: uploadsDir,
        TOOLS_DIR: toolsDir,
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

/**
 * 后台启动服务，成功/失败后通过 IPC 事件通知渲染进程。
 * 窗口在调用此函数前已经创建，用户可以看到 loading 界面。
 */
function startServerInBackground(): void {
  // 防止重复启动
  if (serverProcess) {
    writeLog('Server already starting, skip duplicate startServerInBackground call');
    return;
  }

  writeLog('Starting server in background...');
  startServer()
    .then(async (port) => {
      serverPort = port;
      writeLog(`Server started on port: ${port}`);
      if (app.isPackaged) {
        await startMobileWebServer(port);
      }
      mainWindow?.webContents.send('server-ready', port);
    })
    .catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      writeLog(`Server startup failed: ${msg}`);
      console.error('Server startup failed:', error);
      mainWindow?.webContents.send('server-error', msg);
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
    createWindow();
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
          void requestAppQuit();
        },
      },
    ]),
  );
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createWindow() {
  if (mainWindow) {
    showMainWindow();
    return;
  }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 800,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
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

  // 等渲染器第一帧画完再显示窗口，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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
    const viteUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
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

  ipcMain.handle('update:check', async () => {
    try {
      const data = await checkForUpdate();
      return { success: true, data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      writeLog(`[Update] checkForUpdate 异常：${msg}`);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('update:download', async (_event, update: UpdateInfo) => {
    try {
      return await downloadUpdate(update);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('update:install', async (_event, filePath?: string) => {
    return installDownloadedUpdate(filePath);
  });

  ipcMain.handle('update:show-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
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

  // 服务状态查询（供渲染器判断后端是否就绪）
  ipcMain.handle('get-server-status', () => {
    return {
      ready: serverPort !== null,
      port: serverPort,
      error: serverPort === null && !serverProcess ? 'Server not running' : null,
    };
  });

  // 先创建窗口和托盘（用户立即看到界面），再后台启动服务
  createTray();
  createWindow();
  startServerInBackground();

  app.on('activate', () => {
    if (mainWindow) {
      showMainWindow();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      // 如果服务未运行，在后台重新启动
      if (serverPort === null && !serverProcess) {
        startServerInBackground();
      }
    }
  });
});

app.on('second-instance', () => {
  showMainWindow();
});

app.on('window-all-closed', () => {
  if (!isQuitting) return;

  if (!shutdownCompleted) {
    void requestAppQuit();
    return;
  }

  if (process.platform !== 'darwin' || quitRequestedByInstaller) {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  isQuitting = true;

  if (!shutdownCompleted) {
    event.preventDefault();
    void requestAppQuit();
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
