import * as fs from 'fs';
import * as path from 'path';

export type SkillDirectoryLinkMethod = 'symlink' | 'junction' | 'copy';

export interface SkillDirectoryLinkResult {
  method: SkillDirectoryLinkMethod;
  sourcePath: string;
  targetPath: string;
}

export function removePathIfExists(targetPath: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fs.unlinkSync(targetPath);
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

export function copySkillDirectory(sourcePath: string, targetPath: string): void {
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const relative = path.relative(sourcePath, src);
      return !relative.startsWith('.git');
    },
  });
}

export function createSkillDirectoryLink(
  sourcePath: string,
  targetPath: string,
  options: { overwrite?: boolean; copyFallback?: boolean } = {},
): SkillDirectoryLinkResult {
  const resolvedSourcePath = path.resolve(sourcePath);
  const copyFallback = options.copyFallback ?? process.platform === 'win32';

  if (options.overwrite) {
    removePathIfExists(targetPath);
  }

  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(resolvedSourcePath, targetPath, linkType);

    return {
      method: process.platform === 'win32' ? 'junction' : 'symlink',
      sourcePath: resolvedSourcePath,
      targetPath,
    };
  } catch (error) {
    if (!copyFallback) {
      throw error;
    }

    removePathIfExists(targetPath);
    copySkillDirectory(resolvedSourcePath, targetPath);

    return {
      method: 'copy',
      sourcePath: resolvedSourcePath,
      targetPath,
    };
  }
}

export function replaceWithSkillDirectoryLink(
  sourcePath: string,
  targetPath: string,
  options: { copyFallback?: boolean } = {},
): SkillDirectoryLinkResult {
  return createSkillDirectoryLink(sourcePath, targetPath, {
    ...options,
    overwrite: true,
  });
}
