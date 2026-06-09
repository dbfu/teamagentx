import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { ChevronDown, ChevronRight, Code, File, FileText, Folder, FolderOpen, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SkillDetail, SkillFile, skillApi } from '@/lib/skill-api';
import { cn } from '@/lib/utils';
import { MarkdownContent } from './markdown-content';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  content?: string;
  children?: FileTreeNode[];
}

function buildFileTree(files: SkillFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  for (const file of files) {
    nodeMap.set(file.path, {
      name: file.name,
      path: file.path,
      type: file.type,
      size: file.size,
      content: file.content,
      children: file.type === 'directory' ? [] : undefined,
    });
  }

  for (const file of files) {
    const node = nodeMap.get(file.path);
    if (!node) continue;
    const parentPath = file.path.split('/').slice(0, -1).join('/');
    if (!parentPath) {
      root.push(node);
      continue;
    }
    const parent = nodeMap.get(parentPath);
    parent?.children?.push(node);
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => node.children && sortNodes(node.children));
  };

  sortNodes(root);
  return root;
}

function languageFromPath(path?: string | null): string {
  const ext = path?.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
      return 'bash';
    case 'diff':
    case 'patch':
      return 'diff';
    default:
      return 'text';
  }
}

function isMarkdownFile(path?: string | null): boolean {
  const ext = path?.split('.').pop()?.toLowerCase();
  return ext === 'md' || ext === 'markdown';
}

function highlightedHtml(code: string, language?: string): string {
  try {
    const highlightLanguage = language === 'html' ? 'xml' : language;
    if (highlightLanguage && highlightLanguage !== 'text' && hljs.getLanguage(highlightLanguage)) {
      return hljs.highlight(code, { language: highlightLanguage }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

const HIGHLIGHT_CLASS_NAME = '[&_.hljs-addition]:text-green-700 dark:[&_.hljs-addition]:text-green-300 [&_.hljs-attr]:text-sky-700 dark:[&_.hljs-attr]:text-sky-300 [&_.hljs-built_in]:text-cyan-700 dark:[&_.hljs-built_in]:text-cyan-300 [&_.hljs-comment]:text-gray-400 [&_.hljs-comment]:italic [&_.hljs-deletion]:text-red-700 dark:[&_.hljs-deletion]:text-red-300 [&_.hljs-keyword]:font-medium [&_.hljs-keyword]:text-blue-600 dark:[&_.hljs-keyword]:text-blue-400 [&_.hljs-literal]:font-medium [&_.hljs-literal]:text-purple-600 dark:[&_.hljs-literal]:text-purple-400 [&_.hljs-meta]:text-blue-700 dark:[&_.hljs-meta]:text-blue-300 [&_.hljs-number]:text-orange-600 dark:[&_.hljs-number]:text-orange-400 [&_.hljs-string]:text-emerald-600 dark:[&_.hljs-string]:text-emerald-400 [&_.hljs-title]:text-cyan-700 dark:[&_.hljs-title]:text-cyan-300 [&_.hljs-type]:text-amber-700 dark:[&_.hljs-type]:text-amber-300';

function HighlightedCode({ code, language }: { code: string; language?: string }) {
  const html = useMemo(() => highlightedHtml(code, language), [code, language]);
  return (
    <code
      className={`language-${language || 'text'} ${HIGHLIGHT_CLASS_NAME}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function FileTree({
  nodes,
  selectedFile,
  onSelectFile,
  expandedDirs,
  onToggleDir,
  level = 0,
}: {
  nodes: FileTreeNode[];
  selectedFile: SkillFile | null;
  onSelectFile: (file: SkillFile) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  level?: number;
}) {
  const getFileIcon = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      return expandedDirs.has(node.path)
        ? <FolderOpen className="size-4 text-amber-500" />
        : <Folder className="size-4 text-amber-500" />;
    }
    const ext = node.name.split('.').pop()?.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'].includes(ext || '')) {
      return <Code className="size-4 text-blue-500" />;
    }
    if (ext === 'md') return <FileText className="size-4 text-muted-foreground" />;
    return <File className="size-4 text-muted-foreground" />;
  };

  return (
    <>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            onClick={() => {
              if (node.type === 'directory') {
                onToggleDir(node.path);
              } else {
                onSelectFile(node);
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              node.type === 'file' && selectedFile?.path === node.path
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent',
            )}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
          >
            {node.type === 'directory' && (
              expandedDirs.has(node.path)
                ? <ChevronDown className="size-4 text-muted-foreground" />
                : <ChevronRight className="size-4 text-muted-foreground" />
            )}
            {node.type === 'file' && <span className="w-3" />}
            {getFileIcon(node)}
            <span className="truncate">{node.name}</span>
          </button>
          {node.type === 'directory' && node.children && expandedDirs.has(node.path) && (
            <FileTree
              nodes={node.children}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}

interface SkillDetailModalProps {
  slug: string | null;
  onClose: () => void;
}

export function SkillDetailModal({ slug, onClose }: SkillDetailModalProps) {
  const { t } = useTranslation();
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!slug) return undefined;

    let cancelled = false;
    setLoading(true);
    setSkill(null);
    setSelectedFile(null);
    setExpandedDirs(new Set());

    skillApi.getDetail(slug)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setSkill(result.data);
          const skillMd = result.data.files.find((file) => file.name === 'SKILL.md');
          const firstFileWithContent = result.data.files.find((file) => file.type === 'file' && file.content);
          setSelectedFile(skillMd || firstFileWithContent || null);
          return;
        }
        toast.error(t('skill.getSkillContentFailed'));
        onClose();
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(t('skill.getSkillContentFailed'));
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, t]);

  if (!slug) return null;

  const title = skill?.name || slug;
  const description = skill?.description;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-[900px] max-w-[calc(100vw-2rem)] flex-col rounded-[var(--radius-panel)] bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-foreground">{title}</h3>
            {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {loading || !skill ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-56 shrink-0 overflow-y-auto border-r bg-muted/30">
              <div className="p-2">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{t('skill.fileList')}</div>
                <FileTree
                  nodes={buildFileTree(skill.files)}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                  expandedDirs={expandedDirs}
                  onToggleDir={(path) => {
                    setExpandedDirs((prev) => {
                      const next = new Set(prev);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                      }
                      return next;
                    });
                  }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {selectedFile ? (
                selectedFile.content ? (
                  <div>
                    <div className="mb-2 text-xs text-muted-foreground">
                      {selectedFile.path}
                      {selectedFile.size && ` (${(selectedFile.size / 1024).toFixed(1)} KB)`}
                    </div>
                    {isMarkdownFile(selectedFile.path) ? (
                      <div className="max-h-[60vh] overflow-auto rounded-lg border bg-background p-4">
                        <MarkdownContent
                          content={selectedFile.content}
                          className="prose-headings:mt-4 prose-headings:mb-2 [&_p]:my-2"
                        />
                      </div>
                    ) : (
                      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted p-4 font-mono text-sm text-foreground">
                        <HighlightedCode code={selectedFile.content} language={languageFromPath(selectedFile.path)} />
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                    <File className="mb-2 size-12 opacity-50" />
                    <p>{t('skill.cannotPreviewFile')}</p>
                    {selectedFile.size && (
                      <p className="mt-1 text-xs">{t('skill.fileSize', { size: (selectedFile.size / 1024).toFixed(1) })}</p>
                    )}
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <FileText className="mb-2 size-12 opacity-50" />
                  <p>{t('skill.selectFileToView')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {skill && (
          <div className="flex items-center justify-between border-t px-6 py-3">
            <div className="text-xs text-muted-foreground">
              {t('skill.sourceLabel')}: {skill.source === 'user-created' ? t('skill.sourceUserCreated') : t('skill.sourceExternal')}
              {' · '}
              {t('skill.fileCount', { count: skill.files.length })}
            </div>
            <button onClick={onClose} className="ta-button-secondary">
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
