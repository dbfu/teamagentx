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

export function getRoomAgentLongTermMemoryFile(
  chatRoomId: string,
  agentId: string | null | undefined,
  agentName: string,
): string {
  const roomKey = sanitizePathSegment(chatRoomId || 'unknown-room');
  const agentKey = sanitizePathSegment(agentId || agentName || 'unknown');
  return path.join(os.homedir(), '.teamagentx', 'rooms', roomKey, 'agents', agentKey, 'MEMORY.md');
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

export function ensureRoomAgentLongTermMemoryFile(
  chatRoomId: string,
  agentId: string | null | undefined,
  agentName: string,
): string {
  const memoryFile = getRoomAgentLongTermMemoryFile(chatRoomId, agentId, agentName);
  return ensureMemoryFile(memoryFile);
}

export function ensureLongTermMemoryFiles(
  chatRoomId: string,
  agentId: string | null | undefined,
  agentName: string,
): string[] {
  return [
    ensureRoomAgentLongTermMemoryFile(chatRoomId, agentId, agentName),
    ensureAgentLongTermMemoryFile(agentId, agentName),
  ];
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

export function buildAgentLongTermMemorySection(
  chatRoomId: string,
  agentId: string | null | undefined,
  agentName: string,
): string {
  const roomMemoryFile = ensureRoomAgentLongTermMemoryFile(chatRoomId, agentId, agentName);
  const agentMemoryFile = ensureAgentLongTermMemoryFile(agentId, agentName);
  const roomMemory = readMemoryFile(roomMemoryFile);
  const agentMemory = readMemoryFile(agentMemoryFile);

  const instructions = `【长期记忆规则】
你有两份长期记忆文件：
1. 当前房间中的助手记忆（room + agent）：${roomMemoryFile}
2. 助手全局记忆（agent）：${agentMemoryFile}

写入规则：
- 当用户明确要求你记住某些长期有效的信息、偏好、身份资料、项目习惯或约束时，请你自己将信息整理后写入合适的 Markdown 文件。
- 当用户只说“记住 xxx”但没有说明作用范围时，默认写入“当前房间中的助手记忆”，它只在当前群聊/房间内对你生效。
- 如果这条记忆看起来也适合跨群聊复用，可以在回复中询问用户是否也保存到“助手全局记忆”，但不要擅自写入全局记忆。
- 只有当用户明确要求“所有群聊都记住”、“全局记住”、“这个助手以后都记住”，或明确同意保存到共享/全局记忆时，才写入“助手全局记忆”。
- 不要把临时任务、寒暄、一次性上下文或未经用户明确要求保存的信息写入长期记忆。
- 当用户要求修改或忘记某条长期记忆时，请你自己编辑对应的记忆文件。`;

  const memorySections: string[] = [];
  if (agentMemory) {
    memorySections.push(`【助手全局长期记忆内容】
以下内容来自助手全局记忆文件，会在所有房间中参考：
${agentMemory}`);
  }
  if (roomMemory) {
    memorySections.push(`【当前房间助手长期记忆内容】
以下内容来自当前房间中的助手记忆文件，只适用于当前房间：
${roomMemory}`);
  }

  if (memorySections.length === 0) {
    return instructions;
  }

  return `${instructions}

${memorySections.join('\n\n')}`;
}
