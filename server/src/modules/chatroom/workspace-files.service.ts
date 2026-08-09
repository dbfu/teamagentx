import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDefaultChatRoomWorkDir } from '../../core/agent/work-dir.js';

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  depth: number;
  size: number | null;
}

export interface WorkspaceFilePreview {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'document' | 'unsupported';
  mimeType: string;
  content: string;
  size: number;
}

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.cache', '.next', 'dist', 'build', 'coverage']);
const SKIPPED_ENTRIES = new Set(['.DS_Store']);
const IMAGE_MIME: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
const DOCUMENT_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const UNSUPPORTED_EXTENSIONS = new Set(['.7z', '.avi', '.db', '.dmg', '.doc', '.exe', '.gz', '.mov', '.mp3', '.mp4', '.ppt', '.tar', '.zip']);
const MAX_DEPTH = 8;
const MAX_ENTRIES = 1_000;
const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024;
const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;

function expandWorkDir(workDir: string): string {
  const expanded = workDir.startsWith('~')
    ? path.join(os.homedir(), workDir.slice(1))
    : workDir;
  return path.resolve(expanded);
}

export function resolveChatRoomWorkspaceRoot(chatRoomId: string, workDir?: string | null): string {
  return workDir?.trim()
    ? expandWorkDir(workDir.trim())
    : getDefaultChatRoomWorkDir(chatRoomId);
}

export function ensureWorkspaceRoot(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('群聊工作目录不是文件夹');
  return fs.realpathSync(root);
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function ensureExistingFile(root: string, relativePath: string): string {
  if (!relativePath.trim() || relativePath.includes('\0')) throw new Error('文件路径不能为空');

  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, candidate)) throw new Error('路径超出当前工作目录');

  const candidateStat = fs.lstatSync(candidate);
  if (candidateStat.isSymbolicLink()) throw new Error('不支持读取符号链接文件');
  const resolvedFile = fs.realpathSync(candidate);
  if (!isInside(resolvedRoot, resolvedFile)) throw new Error('路径超出当前工作目录');
  if (!fs.statSync(resolvedFile).isFile()) throw new Error('目标不是文件');
  return resolvedFile;
}

export function listWorkspaceEntries(root: string): WorkspaceEntry[] {
  const resolvedRoot = fs.realpathSync(root);
  if (!fs.statSync(resolvedRoot).isDirectory()) throw new Error('群聊工作目录不是文件夹');

  const entries: WorkspaceEntry[] = [];

  function visit(directory: string, depth: number): void {
    if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;

    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    children.sort((left, right) => (
      Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name)
    ));

    for (const child of children) {
      if (entries.length >= MAX_ENTRIES) break;
      if (SKIPPED_ENTRIES.has(child.name) || child.isSymbolicLink()) continue;
      if (child.isDirectory() && SKIPPED_DIRECTORIES.has(child.name)) continue;

      const absolutePath = path.join(directory, child.name);
      const relativePath = path.relative(resolvedRoot, absolutePath).split(path.sep).join('/');
      if (child.isDirectory()) {
        entries.push({ path: relativePath, name: child.name, kind: 'directory', depth, size: null });
        visit(absolutePath, depth + 1);
      } else if (child.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(absolutePath).size;
        } catch {
          // The file may disappear while the tree is being read.
        }
        entries.push({ path: relativePath, name: child.name, kind: 'file', depth, size });
      }
    }
  }

  visit(resolvedRoot, 0);
  return entries;
}

export function readWorkspaceFile(root: string, relativePath: string): WorkspaceFilePreview {
  const absolutePath = ensureExistingFile(root, relativePath);
  const stat = fs.statSync(absolutePath);
  const normalizedPath = path.relative(fs.realpathSync(root), absolutePath).split(path.sep).join('/');
  const name = path.basename(absolutePath);
  const extension = path.extname(absolutePath).toLowerCase();
  const documentMime = DOCUMENT_MIME[extension];

  if (stat.size > (documentMime ? MAX_DOCUMENT_FILE_SIZE : MAX_TEXT_FILE_SIZE)) {
    return { path: normalizedPath, name, kind: 'unsupported', mimeType: 'application/octet-stream', content: '', size: stat.size };
  }

  const imageMime = IMAGE_MIME[extension];
  if (imageMime) {
    return { path: normalizedPath, name, kind: 'image', mimeType: imageMime, content: fs.readFileSync(absolutePath).toString('base64'), size: stat.size };
  }

  if (documentMime) {
    return { path: normalizedPath, name, kind: 'document', mimeType: documentMime, content: fs.readFileSync(absolutePath).toString('base64'), size: stat.size };
  }

  if (UNSUPPORTED_EXTENSIONS.has(extension)) {
    return { path: normalizedPath, name, kind: 'unsupported', mimeType: 'application/octet-stream', content: '', size: stat.size };
  }

  return { path: normalizedPath, name, kind: 'text', mimeType: 'text/plain', content: fs.readFileSync(absolutePath, 'utf8'), size: stat.size };
}
