import { appendFileSync } from 'fs';
import { join } from 'path';

// 调试日志文件路径
export const DEBUG_LOG_PATH = join(process.cwd(), 'debug-messages.jsonl');

// 写入调试日志
export function debugLog(event: string, data: Record<string, unknown>) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
  try {
    appendFileSync(DEBUG_LOG_PATH, JSON.stringify(logEntry) + '\n', 'utf-8');
  } catch (err) {
    console.error('Failed to write debug log:', err);
  }
}