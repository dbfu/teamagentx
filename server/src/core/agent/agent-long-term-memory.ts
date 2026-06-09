import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function getAgentLongTermMemoryFile(agentId: string | null | undefined, agentName: string): string {
  const agentKey = sanitizePathSegment(agentId || agentName || 'unknown');
  return path.join(os.homedir(), '.teamagentx', 'agents', agentKey, 'MEMORY.md');
}

function ensureMemoryFile(memoryFile: string): string {
  fs.mkdirSync(path.dirname(memoryFile), { recursive: true });

  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(memoryFile, '', 'utf-8');
  }

  return memoryFile;
}

export function ensureAgentLongTermMemoryFile(agentId: string | null | undefined, agentName: string): string {
  const memoryFile = getAgentLongTermMemoryFile(agentId, agentName);
  return ensureMemoryFile(memoryFile);
}


function readMemoryFile(memoryFile: string): string {
  try {
    return fs.readFileSync(memoryFile, 'utf-8').trim();
  } catch (error) {
    console.warn(`[AgentLongTermMemory] 读取记忆文件失败: ${memoryFile}`, error);
    return '';
  }
}

export function readAgentLongTermMemory(agentId: string | null | undefined, agentName: string): string {
  const memoryFile = ensureAgentLongTermMemoryFile(agentId, agentName);
  return readMemoryFile(memoryFile);
}

/**
 * 非破坏性追加：把一段内容追加到助手全局长期记忆文件末尾。
 * 用于日记沉淀等自动写入场景；绝不覆盖已有（用户手写）内容。
 */
export function appendAgentLongTermMemory(
  agentId: string | null | undefined,
  agentName: string,
  section: string,
): void {
  const trimmed = section.trim();
  if (!trimmed) return;

  const memoryFile = ensureAgentLongTermMemoryFile(agentId, agentName);
  const existing = readMemoryFile(memoryFile);
  const next = existing ? `${existing}\n\n${trimmed}\n` : `${trimmed}\n`;
  fs.writeFileSync(memoryFile, next, 'utf-8');
}

export function buildAgentLongTermMemoryInstructions(
  agentId: string | null | undefined,
  agentName: string,
): string {
  ensureAgentLongTermMemoryFile(agentId, agentName);

  return `[Long-Term Memory Rules]
You have a configured long-term memory file managed by TeamAgentX. Do not display its local file path to users.

Write rules:
- When the user explicitly asks you to remember long-lived information, preferences, identity details, project habits, or constraints, organize the information and write it to this Markdown file yourself.
- Do not write temporary tasks, pleasantries, one-off context, or information the user did not explicitly ask you to save into long-term memory.
- When the user asks you to modify or forget a long-term memory item, edit the memory file yourself.`;
}

export function buildAgentLongTermMemoryContentSection(
  agentId: string | null | undefined,
  agentName: string,
): string {
  const agentMemoryFile = ensureAgentLongTermMemoryFile(agentId, agentName);
  const agentMemory = readMemoryFile(agentMemoryFile);

  if (!agentMemory) return '';

  return `[Global Assistant Long-Term Memory]
The following content comes from the assistant global memory file and applies across rooms:
${agentMemory}`;
}

export function buildAgentLongTermMemorySection(
  agentId: string | null | undefined,
  agentName: string,
): string {
  return [
    buildAgentLongTermMemoryInstructions(agentId, agentName),
    buildAgentLongTermMemoryContentSection(agentId, agentName),
  ]
    .filter((section) => section.trim().length > 0)
    .join('\n\n');
}
