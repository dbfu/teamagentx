import fsp from 'fs/promises';
import path from 'path';
import { getDefaultChatRoomWorkDir } from '../../core/agent/work-dir.js';

export type PackageScriptSource = 'package' | 'shell';

export interface PackageScriptInfo {
  id: string;
  name: string;
  command: string;
  runCommand: string;
  relativeDir: string;
  workDir: string;
  source: PackageScriptSource;
  filePath?: string;
}

export interface PackageScriptsResult {
  hasPackageJson: boolean;
  hasShellScripts: boolean;
  hasScripts: boolean;
  workDir: string | null;
  packageManager: string | null;
  scripts: PackageScriptInfo[];
}

export interface RunPackageScriptResult {
  scriptId: string;
  scriptName: string;
  command: string;
  workDir: string;
}

interface PackageJson {
  scripts?: unknown;
}

const IGNORED_SCRIPT_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'node_modules-prod',
  'out',
]);

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export class PackageScriptService {
  async getScripts(workDir?: string | null): Promise<PackageScriptsResult> {
    if (!workDir) {
      return {
        hasPackageJson: false,
        hasShellScripts: false,
        hasScripts: false,
        workDir: null,
        packageManager: null,
        scripts: [],
      };
    }

    const packageJsonPaths = await this.findPackageJsonFiles(workDir);
    const shellScriptPaths = await this.findShellScriptFiles(workDir);

    const packageManager = 'npm';
    const scripts: PackageScriptInfo[] = [];

    for (const packageJsonPath of packageJsonPaths) {
      const packageDir = path.dirname(packageJsonPath);
      const relativeDir = path.relative(workDir, packageDir);
      const parsed = JSON.parse(await fsp.readFile(packageJsonPath, 'utf-8')) as PackageJson;
      const packageScripts = asObject(parsed.scripts);

      scripts.push(...Object.entries(packageScripts ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([name, command]) => ({
          id: this.buildScriptId(relativeDir, name),
          name,
          command,
          runCommand: this.buildRunCommand(packageManager, name),
          relativeDir,
          workDir: packageDir,
          source: 'package' as const,
        })));
    }

    for (const shellScriptPath of shellScriptPaths) {
      const scriptDir = path.dirname(shellScriptPath);
      const scriptName = path.basename(shellScriptPath);
      const relativeDir = path.relative(workDir, scriptDir);

      scripts.push({
        id: this.buildShellScriptId(relativeDir, scriptName),
        name: scriptName,
        command: this.buildShellScriptRunCommand(scriptName),
        runCommand: this.buildShellScriptRunCommand(scriptName),
        relativeDir,
        workDir: scriptDir,
        source: 'shell',
        filePath: shellScriptPath,
      });
    }

    return {
      hasPackageJson: packageJsonPaths.length > 0,
      hasShellScripts: shellScriptPaths.length > 0,
      hasScripts: scripts.length > 0,
      workDir,
      packageManager: packageJsonPaths.length > 0 ? packageManager : null,
      scripts,
    };
  }

  async runScript(args: {
    chatRoomId: string;
    workDir?: string | null;
    scriptId?: string;
    scriptName?: string;
  }): Promise<RunPackageScriptResult> {
    const workDir = args.workDir?.trim() || getDefaultChatRoomWorkDir(args.chatRoomId);
    const scriptsResult = await this.getScripts(workDir);
    if (!scriptsResult.hasScripts || !scriptsResult.workDir) {
      throw new Error('当前群聊工作目录下没有可执行脚本');
    }

    const script = args.scriptId
      ? scriptsResult.scripts.find(item => item.id === args.scriptId)
      : scriptsResult.scripts.find(item => item.name === args.scriptName && item.relativeDir === '');
    if (!script) {
      throw new Error('脚本不存在');
    }

    return {
      scriptId: script.id,
      scriptName: script.name,
      command: script.runCommand,
      workDir: script.workDir,
    };
  }

  private async findPackageJsonFiles(rootDir: string): Promise<string[]> {
    const result: string[] = [];

    const walk = async (dir: string) => {
      let entries: import('fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;

        const entryPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === 'package.json') {
          result.push(entryPath);
        } else if (entry.isDirectory()) {
          await walk(entryPath);
        }
      }
    };

    await walk(rootDir);
    return result.sort((left, right) => {
      const leftDir = path.relative(rootDir, path.dirname(left));
      const rightDir = path.relative(rootDir, path.dirname(right));

      if (leftDir === '') return rightDir === '' ? 0 : -1;
      if (rightDir === '') return 1;
      return leftDir.localeCompare(rightDir);
    });
  }

  private async findShellScriptFiles(rootDir: string): Promise<string[]> {
    const result: string[] = [];

    const walk = async (dir: string) => {
      let entries: import('fs').Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_SCRIPT_DIRS.has(entry.name)) continue;

        const entryPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.sh')) {
          result.push(entryPath);
        } else if (entry.isDirectory()) {
          await walk(entryPath);
        }
      }
    };

    await walk(rootDir);
    return result.sort((left, right) => {
      const leftDir = path.relative(rootDir, path.dirname(left));
      const rightDir = path.relative(rootDir, path.dirname(right));

      if (leftDir === '') return rightDir === '' ? path.basename(left).localeCompare(path.basename(right)) : -1;
      if (rightDir === '') return 1;
      const dirOrder = leftDir.localeCompare(rightDir);
      return dirOrder === 0 ? path.basename(left).localeCompare(path.basename(right)) : dirOrder;
    });
  }

  private buildScriptId(relativeDir: string, scriptName: string): string {
    return Buffer.from(JSON.stringify([relativeDir, scriptName])).toString('base64url');
  }

  private buildShellScriptId(relativeDir: string, scriptName: string): string {
    return Buffer.from(JSON.stringify(['shell', relativeDir, scriptName])).toString('base64url');
  }

  private buildRunCommand(packageManager: string, scriptName: string): string {
    return `${quoteShellArg(packageManager)} run ${quoteShellArg(scriptName)}`;
  }

  private buildShellScriptRunCommand(scriptName: string): string {
    return `sh ${quoteShellArg(`./${scriptName}`)}`;
  }
}

export const packageScriptService = new PackageScriptService();
