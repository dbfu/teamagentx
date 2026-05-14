export interface Attachment {
  type?: 'image' | 'audio' | 'file';
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  transcript?: string;
  waveform?: string;
  base64?: string;  // 用于传递给大模型
}

export interface Message {
  id: string;
  type: 'message' | 'reply';
  content: string;
  time: Date;
  user?: string;
  userId?: string | null;
  agentId?: string;
  agentName?: string;
  avatar?: string | null;
  avatarColor?: string | null;
  chatRoomId: string;
  replyMessageId?: string | null;
  isHuman?: boolean;
  attachments?: Attachment[];
  executionRecordId?: string | null;
  executionDuration?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
}
