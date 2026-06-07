import { appendFile, writeFile } from 'fs/promises';
import * as path from 'path';

// Agent 执行日志文件路径
const AGENT_LOG_PATH = path.join(process.cwd(), 'agent-exec.log');

/**
 * 写入执行日志（异步）
 */
export async function agentLog(
  agentName: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${agentName}] [${type}] ${JSON.stringify(data)}\n`;
  try {
    await appendFile(AGENT_LOG_PATH, logEntry, 'utf-8');
  } catch (err) {
    console.error('Failed to write agent log:', err);
  }
}

/**
 * 清空执行日志（服务启动时调用）
 */
export async function clearAgentLog(): Promise<void> {
  try {
    await writeFile(AGENT_LOG_PATH, '', 'utf-8');
    console.log(`Agent 执行日志已重置: ${AGENT_LOG_PATH}`);
  } catch (err) {
    console.error('Failed to clear agent log:', err);
  }
}
