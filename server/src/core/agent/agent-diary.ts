import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** 校验 YYYY-MM-DD 形式，避免路径穿越 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDiaryDate(date: string): boolean {
  return DATE_RE.test(date);
}

/** 取 Asia/Shanghai 本地日期 YYYY-MM-DD（与 cron 调度时区一致） */
export function shanghaiDateKey(date: Date = new Date()): string {
  // en-CA 输出 YYYY-MM-DD 格式
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

export function getAgentDiaryDir(agentId: string | null | undefined, agentName: string): string {
  const agentKey = sanitizePathSegment(agentId || agentName || 'unknown');
  return path.join(os.homedir(), '.teamagentx', 'agents', agentKey, 'diary');
}

export function getAgentDiaryFile(
  agentId: string | null | undefined,
  agentName: string,
  date: string,
): string {
  if (!isValidDiaryDate(date)) {
    throw new Error(`Invalid diary date: ${date}`);
  }
  return path.join(getAgentDiaryDir(agentId, agentName), `${date}.md`);
}

export function ensureAgentDiaryFile(
  agentId: string | null | undefined,
  agentName: string,
  date: string,
): string {
  const file = getAgentDiaryFile(agentId, agentName, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '', 'utf-8');
  }
  return file;
}

export function readAgentDiary(
  agentId: string | null | undefined,
  agentName: string,
  date: string,
): string {
  if (!isValidDiaryDate(date)) return '';
  const file = getAgentDiaryFile(agentId, agentName, date);
  try {
    return fs.readFileSync(file, 'utf-8').trim();
  } catch {
    return '';
  }
}

export function writeAgentDiary(
  agentId: string | null | undefined,
  agentName: string,
  date: string,
  content: string,
): string {
  const file = ensureAgentDiaryFile(agentId, agentName, date);
  fs.writeFileSync(file, content.trim() + '\n', 'utf-8');
  return file;
}

/** 列出该助手已有的日记日期，按日期倒序（最新在前） */
export function listAgentDiaryDates(agentId: string | null | undefined, agentName: string): string[] {
  const dir = getAgentDiaryDir(agentId, agentName);
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))
      .filter((name) => isValidDiaryDate(name))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}
