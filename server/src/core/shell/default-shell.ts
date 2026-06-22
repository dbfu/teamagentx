import { execFileSync } from 'child_process';

/**
 * 跨平台默认 shell 解析
 *
 * 问题背景：Windows 客户端执行命令时报 `Spawn /bin/bash ENOENT`，
 * 原因是旧逻辑硬编码 `process.env.SHELL || '/bin/bash'`，而 Windows 上
 * 通常没有 SHELL 环境变量，也没有 /bin/bash，导致 spawn 在启动 shell
 * 阶段就失败。
 *
 * 解析策略：
 * - 非 Windows：沿用 `process.env.SHELL`，兜底 `/bin/bash`。
 * - Windows：优先 PowerShell 7（pwsh.exe，支持 `&&`、`pwd` 等），
 *   其次 Windows PowerShell（powershell.exe），最后兜底 cmd.exe。
 */

let cachedShell: string | null = null;

/**
 * 在 Windows PATH 中查找可执行文件，找到则返回名称（交给 spawn 解析），
 * 找不到返回 null。
 */
function findOnWindowsPath(executable: string): string | null {
  try {
    execFileSync('where', [executable], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    });
    return executable;
  } catch {
    return null;
  }
}

function resolveWindowsShell(): string {
  // PowerShell 7+：支持 `&&`、`pwd`、`whoami` 等，跨平台行为最接近 bash
  const pwsh = findOnWindowsPath('pwsh.exe');
  if (pwsh) return pwsh;

  // Windows PowerShell 5.1：大多数 Windows 自带
  const powershell = findOnWindowsPath('powershell.exe');
  if (powershell) return powershell;

  // 最后兜底：cmd.exe（ComSpec）
  return process.env.ComSpec || 'cmd.exe';
}

/**
 * 获取当前平台的默认 shell（结果会缓存）。
 */
export function getDefaultShell(): string {
  if (cachedShell) return cachedShell;

  if (process.platform === 'win32') {
    cachedShell = resolveWindowsShell();
  } else {
    cachedShell = process.env.SHELL || '/bin/bash';
  }

  return cachedShell;
}
