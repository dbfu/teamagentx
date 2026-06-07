import fsp from 'fs/promises';
import path from 'path';
import { getDefaultChatRoomWorkDir } from '../../core/agent/work-dir.js';

export interface PackageScriptInfo {
  id: string;
  name: string;
  command: string;
  runCommand: string;
  relativeDir: string;
  workDir: string;
}

export interface PackageScriptsResult {
  hasPackageJson: boolean;
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
      return { hasPackageJson: false, workDir: null, packageManager: null, scripts: [] };
    }

    const packageJsonPaths = await this.findPackageJsonFiles(workDir);
    if (packageJsonPaths.length === 0) {
      return { hasPackageJson: false, workDir, packageManager: null, scripts: [] };
    }

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
        })));
    }

    return {
      hasPackageJson: true,
      workDir,
      packageManager,
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
    if (!scriptsResult.hasPackageJson || !scriptsResult.workDir) {
      throw new Error('当前群聊工作目录下没有 package.json');
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

  private buildScriptId(relativeDir: string, scriptName: string): string {
    return Buffer.from(JSON.stringify([relativeDir, scriptName])).toString('base64url');
  }

  private buildRunCommand(packageManager: string, scriptName: string): string {
    return `${quoteShellArg(packageManager)} run ${quoteShellArg(scriptName)}`;
  }
}

export const packageScriptService = new PackageScriptService();
