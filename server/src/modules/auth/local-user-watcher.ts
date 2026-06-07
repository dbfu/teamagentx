import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Server } from 'socket.io';

/**
 * 本地用户配置文件监听服务
 *
 * 监听 ~/.teamagentx/user.json 文件变化
 * 当密码变更时，广播 auth:password-changed 事件给所有客户端
 * 客户端收到后应清除 token 并跳转到登录页
 */

let io: Server | null = null;
let watcher: fs.FSWatcher | null = null;
let lastPasswordHash: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface LocalUserConfig {
  id: string;
  username: string;
  password: string;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

function getLocalUserPath(): string {
  return process.env.TEAMAGENTX_USER_FILE
    || path.join(os.homedir(), '.teamagentx', 'user.json');
}

async function readLocalUser(): Promise<LocalUserConfig | null> {
  try {
    const content = await fs.promises.readFile(getLocalUserPath(), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 简单的密码哈希用于比对变更
 * 不需要加密哈希，只是用于快速比对
 */
function hashPassword(password: string): string {
  // 使用简单的方法：截取固定长度 + 原始值比对
  // 实际安全由文件系统权限保证
  return `${password.length}:${password.slice(0, 8)}...${password.slice(-8)}`;
}

/**
 * 处理文件变更事件
 */
async function handleFileChange(): Promise<void> {
  // 使用 debounce 避免频繁触发（文件写入可能触发多次事件）
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;

    const user = await readLocalUser();
    if (!user) {
      // 文件被删除或无效，不做处理
      return;
    }

    const currentHash = hashPassword(user.password);

    // 首次读取，记录当前密码哈希
    if (lastPasswordHash === null) {
      lastPasswordHash = currentHash;
      return;
    }

    // 密码未变更
    if (currentHash === lastPasswordHash) {
      return;
    }

    // 密码已变更，更新记录并广播
    console.log('[LocalUserWatcher] 检测到密码变更，广播通知所有客户端');
    lastPasswordHash = currentHash;

    if (io) {
      io.emit('auth:password-changed', {
        message: '密码已变更，请重新登录',
        timestamp: Date.now(),
      });
    }
  }, 500);
}

/**
 * 启动文件监听
 */
export function startLocalUserWatcher(socketIo: Server): void {
  if (watcher) {
    console.warn('[LocalUserWatcher] 监听器已启动，跳过');
    return;
  }

  io = socketIo;

  const userPath = getLocalUserPath();
  const userDir = path.dirname(userPath);

  // 确保目录存在
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true, mode: 0o700 });
  }

  // 初始读取当前密码
  readLocalUser().then(user => {
    if (user) {
      lastPasswordHash = hashPassword(user.password);
    }
  });

  // 监听文件变化
  // 使用 persistent: false 因为 Electron 主进程会管理生命周期
  try {
    watcher = fs.watch(userPath, { persistent: false }, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        handleFileChange();
      }
    });

    watcher.on('error', (error) => {
      console.error('[LocalUserWatcher] 文件监听错误:', error.message);
      // 尝试重新启动监听
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      // 延迟重启
      setTimeout(() => {
        if (io) {
          startLocalUserWatcher(io);
        }
      }, 5000);
    });

    console.log('[LocalUserWatcher] 已启动监听:', userPath);
  } catch (error: any) {
    console.error('[LocalUserWatcher] 启动监听失败:', error.message);
  }
}

/**
 * 停止文件监听
 */
export function stopLocalUserWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[LocalUserWatcher] 已停止监听');
  }

  io = null;
  lastPasswordHash = null;
}