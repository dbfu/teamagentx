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

  const instructions = `[Long-Term Memory Rules]
You have two long-term memory files:
1. Room-specific assistant memory (room + agent): ${roomMemoryFile}
2. Global assistant memory (agent): ${agentMemoryFile}

Write rules:
- When the user explicitly asks you to remember long-lived information, preferences, identity details, project habits, or constraints, organize the information and write it to the appropriate Markdown file yourself.
- When the user only says "remember xxx" without specifying scope, default to the room-specific assistant memory. It only applies in the current chatroom/room.
- If the memory also appears useful across chatrooms, ask whether the user wants it saved to global assistant memory, but do not write global memory without permission.
- Only write to global assistant memory when the user explicitly asks for "all chatrooms", "global", "this assistant should always remember", or clearly agrees to shared/global memory.
- Do not write temporary tasks, pleasantries, one-off context, or information the user did not explicitly ask you to save into long-term memory.
- When the user asks you to modify or forget a long-term memory item, edit the corresponding memory file yourself.`;

  const memorySections: string[] = [];
  if (agentMemory) {
    memorySections.push(`[Global Assistant Long-Term Memory]
The following content comes from the assistant global memory file and applies across rooms:
${agentMemory}`);
  }
  if (roomMemory) {
    memorySections.push(`[Current Room Assistant Long-Term Memory]
The following content comes from the current room assistant memory file and only applies in this room:
${roomMemory}`);
  }

  if (memorySections.length === 0) {
    return instructions;
  }

  return `${instructions}

${memorySections.join('\n\n')}`;
}
