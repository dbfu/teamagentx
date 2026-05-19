import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, utilityProcess } from 'electron';
import { UtilityProcess } from 'electron/main';
import { execFileSync, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import zlib from 'node:zlib';
import { isLanzouShareUrl, resolveLanzouDownloadUrl } from './update-download';

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
let lastServerError: string | null = null;
let lastServerStderr = '';
let mobileWebServer: http.Server | null = null;
let mobileWebPort: number | null = null;
let isQuitting = false;
let quitRequestedByInstaller = false;
let shutdownPromise: Promise<void> | null = null;
let shutdownCompleted = false;
let downloadedUpdatePath: string | null = null;

// Runtime 准备阶段（首次启动 / 升级时把 server 解压/拷贝到 userData）。
// 用于让前端区分「正在准备运行环境」和「服务真的失败」。
type RuntimePhase = 'idle' | 'preparing' | 'ready' | 'failed';
let runtimePhase: RuntimePhase = 'idle';
let lastRuntimeProgress: RuntimeProgress | null = null;

type RuntimeProgress = {
  phase: 'extract' | 'copy';
  /** 0~100；未知时为 null */
  percent: number | null;
  /** 已处理文件数 */
  files: number;
  /** 已写入字节数 */
  bytes: number;
  /** 期望总字节数；未知时为 null */
  totalBytes: number | null;
  /** 阶段性提示，如「正在解压运行环境…」 */
  message: string;
};

function emitRuntimeProgress(progress: RuntimeProgress): void {
  lastRuntimeProgress = progress;
  mainWindow?.webContents.send('runtime:prepare-progress', progress);
}

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

type FolderOpenTarget = 'system' | 'terminal' | 'vscode' | 'cursor' | 'trae' | 'trae-cn';
type EditorOpenTarget = Exclude<FolderOpenTarget, 'system' | 'terminal'>;
type TerminalOpenTarget = 'terminal-app' | 'iterm2' | 'alacritty' | 'kitty' | 'ghostty' | 'wezterm' | 'kaku';

type UpdateInfo = {
  version: string;
  /** 兼容旧客户端的通用下载链接（fallback） */
  url: string;
  /** macOS Apple Silicon (arm64) 安装包下载链接 */
  macUrlArm64?: string;
  /** macOS Intel (x64) 安装包下载链接 */
  macUrlX64?: string;
  /** Windows 安装包下载链接 */
  winUrl?: string;
  /** 各平台下载链接（新格式） */
  downloads?: { macArm64?: string; macX64?: string; win?: string };
  notes?: string;
  publishedAt?: string;
};

type DownloadProgress = {
  percent: number;
  transferred: number;
  total: number | null;
};

const EDITOR_APP_NAMES: Record<EditorOpenTarget, string> = {
  vscode: 'Visual Studio Code',
  cursor: 'Cursor',
  trae: 'Trae',
  'trae-cn': 'Trae CN',
};

const TERMINAL_APP_NAMES: Record<TerminalOpenTarget, string> = {
  'terminal-app': 'Terminal.app',
  iterm2: 'iTerm2',
  alacritty: 'Alacritty',
  kitty: 'Kitty',
  ghostty: 'Ghostty',
  wezterm: 'WezTerm',
  kaku: 'Kaku',
};

// macOS app paths
const MAC_APP_CANDIDATES: Record<EditorOpenTarget, string[]> = {
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
const WIN_APP_CANDIDATES: Record<EditorOpenTarget, string[]> = {
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

function getAppCandidates(target: EditorOpenTarget): string[] {
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

function execFilePromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function runAppleScript(lines: string[]): Promise<void> {
  return execFilePromise('osascript', lines.flatMap((line) => ['-e', line]));
}

function openTerminalAppAtFolder(folderPath: string): Promise<void> {
  const cdCommand = escapeAppleScriptString(`cd ${shellQuote(folderPath)}`);
  return runAppleScript([
    'tell application "Terminal"',
    `do script "${cdCommand}"`,
    'activate',
    'end tell',
  ]);
}

async function openITermAtFolder(folderPath: string): Promise<void> {
  const cdCommand = escapeAppleScriptString(`cd ${shellQuote(folderPath)}`);
  const errors: string[] = [];

  for (const appName of ['iTerm2', 'iTerm']) {
    try {
      await runAppleScript([
        `tell application "${appName}"`,
        'activate',
        'set newWindow to (create window with default profile)',
        'tell current session of newWindow',
        `write text "${cdCommand}"`,
        'end tell',
        'end tell',
      ]);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] || `${TERMINAL_APP_NAMES.iterm2} not found`);
}

function getDarwinTerminalOpenCandidates(
  terminalTarget: TerminalOpenTarget,
  folderPath: string,
): { appName: string; args: string[] }[] {
  switch (terminalTarget) {
    case 'terminal-app':
      return [{ appName: 'Terminal', args: [folderPath] }];
    case 'iterm2':
      return [
        { appName: 'iTerm', args: [folderPath] },
        { appName: 'iTerm2', args: [folderPath] },
      ];
    case 'alacritty':
      return [{ appName: 'Alacritty', args: ['--args', '--working-directory', folderPath] }];
    case 'kitty':
      return [
        { appName: 'kitty', args: ['--args', '--directory', folderPath] },
        { appName: 'Kitty', args: ['--args', '--directory', folderPath] },
      ];
    case 'ghostty':
      return [{ appName: 'Ghostty', args: ['--args', `--working-directory=${folderPath}`] }];
    case 'wezterm':
      return [{ appName: 'WezTerm', args: ['--args', 'start', '--cwd', folderPath] }];
    case 'kaku':
      return [{ appName: 'Kaku', args: [folderPath] }];
    default:
      return [{ appName: 'Terminal', args: [folderPath] }];
  }
}

async function openFolderInTerminal(
  folderPath: string,
  terminalTarget: TerminalOpenTarget = 'terminal-app',
): Promise<void> {
  if (process.platform === 'darwin') {
    if (terminalTarget === 'terminal-app') {
      await openTerminalAppAtFolder(folderPath);
      return;
    }

    if (terminalTarget === 'iterm2') {
      await openITermAtFolder(folderPath);
      return;
    }

    const candidates = getDarwinTerminalOpenCandidates(terminalTarget, folderPath);
    const errors: string[] = [];

    for (const candidate of candidates) {
      try {
        await execFilePromise('open', ['-n', '-a', candidate.appName, ...candidate.args]);
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(errors[0] || `${TERMINAL_APP_NAMES[terminalTarget]} not found`);
  }

  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/K', 'cd', '/d', folderPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', reject);
      child.unref();
      resolve();
      return;
    }

    const candidates = [
      { command: 'x-terminal-emulator', args: [] },
      { command: 'gnome-terminal', args: [] },
      { command: 'konsole', args: [] },
      { command: 'xfce4-terminal', args: [] },
      { command: 'xterm', args: [] },
    ];

    const terminal = candidates.find(({ command }) => {
      try {
        execFileSync('which', [command], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });

    if (!terminal) {
      reject(new Error('Terminal not found'));
      return;
    }

    const child = spawn(terminal.command, terminal.args, {
      cwd: folderPath,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.unref();
    resolve();
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
  const macUrlArm64 = getStringField(data, ['macUrlArm64']) || undefined;
  const macUrlX64 = getStringField(data, ['macUrlX64']) || undefined;
  const winUrl = getStringField(data, ['winUrl']) || undefined;

  // 提取 downloads 子对象中的链接
  const downloadsRaw = data['downloads'];
  let downloadsMacArm64: string | undefined;
  let downloadsMacX64: string | undefined;
  let downloadsWin: string | undefined;
  if (downloadsRaw && typeof downloadsRaw === 'object') {
    const dl = downloadsRaw as Record<string, unknown>;
    downloadsMacArm64 = typeof dl['macArm64'] === 'string' && dl['macArm64'] ? dl['macArm64'] : undefined;
    downloadsMacX64 = typeof dl['macX64'] === 'string' && dl['macX64'] ? dl['macX64'] : undefined;
    downloadsWin = typeof dl['win'] === 'string' && dl['win'] ? dl['win'] : undefined;
  }

  // 兼容旧格式：通用 url 字段（fallback，不主动使用）
  const url = getStringField(data, ['url', 'downloadUrl', 'downloadURL', 'latestDownloadUrl']);

  const resolvedMacArm64 = macUrlArm64 || downloadsMacArm64;
  const resolvedMacX64 = macUrlX64 || downloadsMacX64;
  const resolvedWin = winUrl || downloadsWin;

  // 至少要有某个可用的下载链接
  const hasSomeUrl = resolvedMacArm64 || resolvedMacX64 || resolvedWin || url;
  if (!version || !hasSomeUrl) {
    throw new Error('更新信息缺少 version 或下载链接');
  }

  return {
    version,
    url: url || resolvedMacArm64 || resolvedMacX64 || resolvedWin || '',
    macUrlArm64: resolvedMacArm64,
    macUrlX64: resolvedMacX64,
    winUrl: resolvedWin,
    downloads: (downloadsMacArm64 || downloadsMacX64 || downloadsWin)
      ? { macArm64: downloadsMacArm64, macX64: downloadsMacX64, win: downloadsWin }
      : undefined,
    notes: getStringField(data, ['notes', 'releaseNotes', 'body']) || undefined,
    publishedAt: getStringField(data, ['publishedAt', 'published_at']) || undefined,
  };
}

/**
 * 根据当前运行平台和 CPU 架构，从 UpdateInfo 中选取对应的下载链接。
 */
function getPlatformDownloadUrl(update: UpdateInfo): string {
  if (process.platform === 'darwin') {
    const arch = process.arch; // 'arm64' for Apple Silicon, 'x64' for Intel
    if (arch === 'arm64') {
      return update.macUrlArm64 || update.downloads?.macArm64 || update.url;
    }
    return update.macUrlX64 || update.downloads?.macX64 || update.url;
  }
  if (process.platform === 'win32') {
    return update.winUrl || update.downloads?.win || update.url;
  }
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
  const originalDownloadUrl = getPlatformDownloadUrl(update);
  const downloadUrl = await resolveLanzouDownloadUrl(originalDownloadUrl);
  if (downloadUrl !== originalDownloadUrl && isLanzouShareUrl(originalDownloadUrl)) {
    writeLog(`[Update] 已解析蓝奏分享链接为真实下载地址：${downloadUrl}`);
  }
  const filePath = path.join(app.getPath('userData'), UPDATE_DOWNLOAD_DIR, getDownloadFileName(downloadUrl));
  downloadedUpdatePath = await downloadFile(downloadUrl, filePath);
  sendUpdateProgress({ percent: 100, transferred: 1, total: 1 });
  return { success: true, filePath: downloadedUpdatePath };
}

// 已就绪的 server 运行时目录（userData 下），由 ensureRuntimeServer() 设置。
// 为 null 时表示尚未准备好或拷贝失败，此时回退到 resources（保持向后兼容）。
let runtimeServerRoot: string | null = null;

function getResourcesServerRoot(): string {
  return path.join(process.resourcesPath, 'server');
}

/**
 * Server 运行时目录。
 *
 * 打包后 server/ 默认在 `resources/server/`，其中的 `.node` / `.dll` 一旦被
 * utilityProcess 加载，安装目录就会被 Windows 文件锁锁住，更新时 NSIS 会
 * 报"程序正在运行"。把 server 复制到 userData 后，安装目录里就不再有任何
 * 会被加载的 native 模块，从根本上消除文件锁。
 */
function getServerProjectRoot(): string {
  // Dev: server/ directory at project root (repo root = electron/../../..)
  if (!app.isPackaged) {
    return path.resolve(__dirname, '../../..', 'server');
  }
  // 优先用 runtime（userData 下），未就绪时回退到 resources
  return runtimeServerRoot ?? getResourcesServerRoot();
}

function getServerNodeModulesPath(): string {
  if (!app.isPackaged) {
    return path.resolve(__dirname, '../../..', 'server', 'node_modules');
  }
  return path.join(getServerProjectRoot(), 'node_modules');
}

/**
 * 把 resources/server/ 整个拷贝到 userData/runtime/<version>-<platform>-<arch>/server/。
 *
 * - 用版本 + 平台 + 架构作为子目录名，同架构同版本只拷一次；升级后旧版本目录会被清理。
 * - 用 `.ready` sentinel 标记拷贝完成；缺失或损坏时自动重拷。
 * - 拷贝失败时返回 null，调用方回退到 resources（旧路径仍然能跑，只是无法解决文件锁问题）。
 */
async function ensureRuntimeServer(): Promise<string | null> {
  if (!app.isPackaged) {
    return null; // dev 模式直接用源码目录，无需准备
  }

  const resourcesRoot = process.resourcesPath;
  const sourceRoot = getResourcesServerRoot();
  const tarball = findServerTarball(resourcesRoot);

  if (!tarball && !fs.existsSync(sourceRoot)) {
    writeLog(`[Runtime] resources 中既无 server tarball 也无 server 目录：${resourcesRoot}`);
    return null;
  }

  const version = app.getVersion();
  const runtimeKey = `${version}-${process.platform}-${process.arch}`;
  const runtimeBase = path.join(app.getPath('userData'), 'runtime');
  const targetRoot = path.join(runtimeBase, runtimeKey, 'server');
  const sentinel = path.join(targetRoot, '.ready');

  if (fs.existsSync(sentinel)) {
    writeLog(`[Runtime] server runtime 已就绪：${targetRoot}`);
    runtimePhase = 'ready';
    void cleanupOldRuntimeVersions(runtimeBase, runtimeKey, version);
    return targetRoot;
  }

  runtimePhase = 'preparing';
  lastRuntimeProgress = null;
  mainWindow?.webContents.send('runtime:prepare-start');

  try {
    // 残留的不完整目录直接删掉，避免 cp 把新文件混到旧目录中
    if (fs.existsSync(targetRoot)) {
      writeLog(`[Runtime] 清理残留的不完整目录：${targetRoot}`);
      await fs.promises.rm(targetRoot, { recursive: true, force: true });
    }

    await fs.promises.mkdir(targetRoot, { recursive: true });
    const start = Date.now();

    if (tarball) {
      writeLog(`[Runtime] 首次启动或升级，开始解压 server tarball → ${targetRoot}`);
      await extractServerTarball(tarball, targetRoot);
    } else {
      writeLog(`[Runtime] 首次启动或升级，开始拷贝 server → ${targetRoot}`);
      await copyServerWithProgress(sourceRoot, targetRoot);
    }

    await fs.promises.writeFile(sentinel, runtimeKey, 'utf8');
    writeLog(`[Runtime] server 准备完成，耗时 ${Date.now() - start}ms`);

    runtimePhase = 'ready';
    void cleanupOldRuntimeVersions(runtimeBase, runtimeKey, version);
    mainWindow?.webContents.send('runtime:prepare-done');
    return targetRoot;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    writeLog(`[Runtime] server 准备失败：${msg}`);
    runtimePhase = 'failed';
    mainWindow?.webContents.send('runtime:prepare-error', msg);
    // 清理半成品，下次启动重试
    try {
      await fs.promises.rm(targetRoot, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
    return null;
  }
}

/**
 * 在 resources 目录下寻找 server tarball（方案 B 产物）。
 * 优先匹配 .tar.zst；若不存在返回 null，调用方回退到目录拷贝。
 */
function findServerTarball(resourcesRoot: string): string | null {
  const candidates = [
    path.join(resourcesRoot, 'server.tar.zst'),
    path.join(resourcesRoot, 'server-runtime.tar.zst'),
    path.join(resourcesRoot, 'server.tar.gz'),
    path.join(resourcesRoot, 'server-runtime.tar.gz'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 流式解压 server tarball 到目标目录，按压缩包字节进度向前端汇报。
 * 使用动态 import 避免在没有 tar 包时编译报错。
 */
async function extractServerTarball(tarballPath: string, targetRoot: string): Promise<void> {
  const stat = await fs.promises.stat(tarballPath);
  const totalBytes = stat.size;
  let processedBytes = 0;
  let processedFiles = 0;
  let lastEmit = 0;

  emitRuntimeProgress({
    phase: 'extract',
    percent: 0,
    files: 0,
    bytes: 0,
    totalBytes,
    message: '正在解压运行环境…',
  });

  // 注：Windows 10+ 自带 tar.exe，但行为在不同版本上不一致；
  // 使用 npm 'tar' 包（pure-JS）跨平台更稳，会被 Vite bundle 进 main.js。
  const tar = await import('tar');
  const stream = fs.createReadStream(tarballPath);
  stream.on('data', (chunk) => {
    processedBytes += chunk.length;
    const now = Date.now();
    if (now - lastEmit >= 250) {
      lastEmit = now;
      emitRuntimeProgress({
        phase: 'extract',
        percent: totalBytes > 0 ? Math.min(99, Math.round((processedBytes / totalBytes) * 100)) : null,
        files: processedFiles,
        bytes: processedBytes,
        totalBytes,
        message: '正在解压运行环境…',
      });
    }
  });

  const extractor = tar.x({ cwd: targetRoot, onentry: () => { processedFiles += 1; } });
  if (tarballPath.endsWith('.tar.zst')) {
    await pipeline(stream, zlib.createZstdDecompress(), extractor);
  } else if (tarballPath.endsWith('.tar.gz') || tarballPath.endsWith('.tgz')) {
    await pipeline(stream, zlib.createGunzip(), extractor);
  } else {
    await pipeline(stream, extractor);
  }

  emitRuntimeProgress({
    phase: 'extract',
    percent: 100,
    files: processedFiles,
    bytes: processedBytes,
    totalBytes,
    message: '解压完成',
  });
}

/**
 * 兜底：当没有 tarball 时（旧打包产物或 dev 调试），递归拷贝目录并汇报进度。
 * 自己实现而不用 fs.cp，是为了能在拷贝过程中按文件数发心跳，让用户感知进度。
 */
async function copyServerWithProgress(sourceRoot: string, targetRoot: string): Promise<void> {
  let copiedFiles = 0;
  let copiedBytes = 0;
  let lastEmit = 0;

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 500) return;
    lastEmit = now;
    emitRuntimeProgress({
      phase: 'copy',
      percent: null, // 总量未知，前端用 indeterminate 进度条
      files: copiedFiles,
      bytes: copiedBytes,
      totalBytes: null,
      message: `正在准备运行环境（已复制 ${copiedFiles} 个文件）…`,
    });
  };

  emit(true);

  async function walk(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isSymbolicLink()) {
        // electron-builder 已展开 symlink；保留 link 信息（极少情况）
        try {
          const linkTarget = await fs.promises.readlink(srcPath);
          await fs.promises.symlink(linkTarget, destPath);
        } catch {
          // 失败就跳过
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(srcPath, destPath);
        continue;
      }
      await fs.promises.copyFile(srcPath, destPath);
      const stat = await fs.promises.stat(destPath).catch(() => null);
      copiedBytes += stat?.size ?? 0;
      copiedFiles += 1;
      emit();
    }
  }

  await walk(sourceRoot, targetRoot);
  emit(true);
}

async function cleanupOldRuntimeVersions(runtimeBase: string, currentKey: string, currentVersion: string): Promise<void> {
  try {
    if (!fs.existsSync(runtimeBase)) return;
    const entries = await fs.promises.readdir(runtimeBase);
    for (const entry of entries) {
      if (entry === currentKey) continue;
      if (entry.startsWith(`${currentVersion}-`)) continue;
      const oldPath = path.join(runtimeBase, entry);
      writeLog(`[Runtime] 清理旧版 runtime：${oldPath}`);
      await fs.promises.rm(oldPath, { recursive: true, force: true });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    writeLog(`[Runtime] 清理旧版 runtime 失败：${msg}`);
  }
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
      // 正确做法：用 /S（静默模式）直接运行新安装包，旧版文件在安装成功后才被替换。
      //
      // NSIS 检测"应用占用"看的是**文件锁**而不是窗口：只要 resources\server\ 下
      // 的 .node / .dll 还被任何进程的句柄持有，安装就会一直失败，重试多少次都没用。
      // 而 server 经常派生 node.exe / cmd.exe / npm 子进程（claude/codex/shell/npm install），
      // 这些孤儿子进程在主进程退出后仍然驻留并持有文件句柄。
      //
      // 流程：等主进程退出 → 反复杀掉所有从安装目录启动的进程 → 等文件句柄释放 → /S 静默安装
      const safeInstallerPath = installerPath.replace(/'/g, "''");
      const installDir = path.dirname(app.getPath('exe'));
      const safeInstallDir = installDir.replace(/'/g, "''");

      // 注意：PowerShell 脚本中字符串字面量用单引号包围，
      // 字符串里的单引号通过两次单引号转义（上面的 .replace 已处理）。
      const scriptLines = [
        `$ErrorActionPreference = 'SilentlyContinue'`,
        `$installDir = '${safeInstallDir}'`,
        `$installerPath = '${safeInstallerPath}'`,
        ``,
        `# 等当前 TeamAgentX 主进程从内存中退出`,
        `Start-Sleep -Milliseconds 800`,
        ``,
        `# 按"可执行文件路径在安装目录下"为准杀进程，能抓到 utilityProcess、`,
        `# ACP 子进程、npm 子进程等任何 server 派生出来的孤儿进程。`,
        `function Kill-ProcessesInDir {`,
        `  param([string]$Dir)`,
        `  $count = 0`,
        `  try {`,
        `    $procs = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {`,
        `      $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Dir, [StringComparison]::OrdinalIgnoreCase)`,
        `    }`,
        `    foreach ($p in $procs) {`,
        `      Stop-Process -Id $p.ProcessId -Force`,
        `      $count++`,
        `    }`,
        `  } catch {}`,
        `  return $count`,
        `}`,
        ``,
        `# 反复杀直到连续两轮 0 个，避免子进程链来不及全部死掉。最多 10 轮（约 3s）。`,
        `$emptyRounds = 0`,
        `for ($i = 0; $i -lt 10; $i++) {`,
        `  $killed = Kill-ProcessesInDir -Dir $installDir`,
        `  if ($killed -eq 0) {`,
        `    $emptyRounds++`,
        `    if ($emptyRounds -ge 2) { break }`,
        `  } else {`,
        `    $emptyRounds = 0`,
        `  }`,
        `  Start-Sleep -Milliseconds 300`,
        `}`,
        ``,
        `# 兜底：按进程名再杀一次（防止有进程因权限读不到 ExecutablePath 而漏网）`,
        `Stop-Process -Name 'TeamAgentX' -Force`,
        ``,
        `# 进程死掉 ≠ 文件句柄立即释放。Windows 上 .node / .dll 句柄常有 ~1s 的延迟，`,
        `# 这里多等 1.5s，否则 NSIS 仍可能命中残留句柄报"程序正在运行"。`,
        `Start-Sleep -Milliseconds 1500`,
        ``,
        `Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait`,
      ];

      const scriptPath = path.join(app.getPath('temp'), 'teamagentx-update.ps1');
      fs.writeFileSync(scriptPath, scriptLines.join('\r\n'), 'utf8');
      writeLog(`[Update] 写入静默安装脚本：${scriptPath}，installDir=${installDir}`);

      spawn(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        { detached: true, stdio: 'ignore' },
      ).unref();

      writeLog('[Update] 主进程立即退出，PowerShell 脚本接管进程清理与静默安装');
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

async function startServer(): Promise<number> {
  writeLog('startServer called');
  lastServerStderr = '';

  // 在 fork utilityProcess 之前先把 server 目录拷贝到 userData，
  // 这样所有 .node / .dll 文件锁都落在 userData 而非 resources，
  // 后续更新时 NSIS 不会再卡在"程序正在运行"。失败时回退到 resources。
  if (app.isPackaged && !runtimeServerRoot) {
    const root = await ensureRuntimeServer();
    if (root) {
      runtimeServerRoot = root;
      writeLog(`[Runtime] server 将从 userData 加载：${root}`);
    } else {
      writeLog(`[Runtime] server 回退到 resources：${getResourcesServerRoot()}`);
    }
  }

  const projectRoot = getServerProjectRoot();
  const nodeModulesPath = getServerNodeModulesPath();
  const serverEntry = path.join(projectRoot, 'dist', 'electron-entry.js');
  writeLog(`Server project root: ${projectRoot}`);
  writeLog(`Server entry: ${serverEntry}`);
  writeLog(`Node modules path: ${nodeModulesPath}`);

  // 启动前预检查：缺失关键文件直接抛出明确错误，避免 utilityProcess 静默退出
  const preflightErrors: string[] = [];
  if (!fs.existsSync(projectRoot)) {
    preflightErrors.push(`server 目录不存在：${projectRoot}`);
  }
  if (!fs.existsSync(serverEntry)) {
    preflightErrors.push(`server 入口文件缺失：${serverEntry}（检查打包是否包含 server/dist/electron-entry.js）`);
  }
  if (!fs.existsSync(nodeModulesPath)) {
    preflightErrors.push(`server node_modules 缺失：${nodeModulesPath}`);
  } else {
    const prismaClient = path.join(nodeModulesPath, '@prisma', 'client');
    if (!fs.existsSync(prismaClient)) {
      preflightErrors.push(`Prisma client 缺失：${prismaClient}`);
    }
  }
  if (preflightErrors.length > 0) {
    const message = `服务启动预检查失败：\n- ${preflightErrors.join('\n- ')}\n\n详细日志：${getLogPath()}`;
    writeLog(`[Preflight] ${message}`);
    throw new Error(message);
  }

  return new Promise((resolve, reject) => {
    // Set DATABASE_URL to user data directory
    const dbPath = path.join(app.getPath('userData'), 'teamagentx.db');
    const databaseUrl = pathToFileURL(dbPath).href;
    // Set UPLOADS_DIR to user data directory (not inside app)
    const uploadsDir = path.join(app.getPath('userData'), 'uploads');
    // 本地工具安装目录
    const toolsDir = path.join(app.getPath('userData'), 'tools');

    const fullPath = resolveShellPath();

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    try {
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
    } catch (forkError) {
      const msg = forkError instanceof Error ? forkError.message : String(forkError);
      writeLog(`utilityProcess.fork 抛出异常：${msg}`);
      reject(new Error(`无法启动 server 进程：${msg}\n详细日志：${getLogPath()}`));
      return;
    }

    serverProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      writeLog(`Server stdout: ${text.trim()}`);

      // Parse port from output: __ELECTRON_PORT__:XXXX
      const match = text.match(/__ELECTRON_PORT__:(\d+)/);
      if (match) {
        serverPort = parseInt(match[1], 10);
        writeLog(`Server started on port: ${serverPort}`);
        process.stdout.write(data);
        settle(() => resolve(serverPort!));
      } else {
        process.stdout.write(data);
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      lastServerStderr = `${lastServerStderr}${text}`.slice(-8000);
      writeLog(`Server stderr: ${text.trim()}`);
      process.stderr.write(data);
    });

    serverProcess.on('exit', (code) => {
      writeLog(`Server process exited with code: ${code}`);
      const wasReady = serverPort !== null;
      serverProcess = null;
      if (!wasReady) {
        const tail = lastServerStderr.trim().split(/\r?\n/).slice(-15).join('\n');
        const detail = tail ? `\n\n最后的错误输出：\n${tail}` : '';
        settle(() => reject(new Error(
          `server 进程退出，退出码 ${code}（端口尚未就绪）${detail}\n\n详细日志：${getLogPath()}`,
        )));
      }
    });

    // Set a timeout to reject if server doesn't start
    setTimeout(() => {
      if (serverPort === null) {
        const tail = lastServerStderr.trim().split(/\r?\n/).slice(-15).join('\n');
        const detail = tail ? `\n\n最后的错误输出：\n${tail}` : '';
        settle(() => reject(new Error(
          `server 启动超时（30 秒内未输出端口）${detail}\n\n详细日志：${getLogPath()}`,
        )));
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
      lastServerError = null;
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
      lastServerError = msg;
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
    const targets = Object.keys(MAC_APP_CANDIDATES) as EditorOpenTarget[];
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
  ipcMain.handle('open-folder', async (_event, payload: { path: string; target?: FolderOpenTarget; terminalTarget?: TerminalOpenTarget } | string) => {
    const folderPath = typeof payload === 'string' ? payload : payload.path;
    const target = typeof payload === 'string' ? 'system' : (payload.target || 'system');
    const terminalTarget = typeof payload === 'string' ? 'terminal-app' : (payload.terminalTarget || 'terminal-app');
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
      } else if (target === 'terminal') {
        await openFolderInTerminal(resolvedPath, terminalTarget);
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
    let error: string | null = null;
    // 只有当不是「正在准备运行环境」、且没有进程在跑、也没有端口时才算失败。
    // 否则前端会在解压阶段误判为「服务启动失败」。
    if (serverPort === null && !serverProcess && runtimePhase !== 'preparing') {
      if (lastServerError) {
        error = lastServerError;
      } else if (runtimePhase === 'failed') {
        error = `运行环境准备失败。详细日志：${getLogPath()}`;
      }
      // runtimePhase === 'idle' 时返回 error=null，由前端继续等待事件
    }
    return {
      ready: serverPort !== null,
      port: serverPort,
      error,
      logPath: getLogPath(),
      runtime: {
        phase: runtimePhase,
        progress: lastRuntimeProgress,
      },
    };
  });

  // 让用户在错误界面"打开日志文件夹"以协助排查
  ipcMain.handle('open-log-folder', async () => {
    try {
      shell.showItemInFolder(getLogPath());
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
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
