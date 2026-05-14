// 外部平台持久输入状态循环管理
// 独立模块，避免 bridge.service ↔ agent/processor 循环依赖

const typingLoops = new Map<string, { interval: ReturnType<typeof setInterval>; safetyTimer: ReturnType<typeof setTimeout> }>();
const TYPING_INTERVAL_MS = 4000;
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 分钟安全上限

type SendTypingFn = (chatRoomId: string) => Promise<void>;

let _sendTyping: SendTypingFn | null = null;

export function registerTypingLoopSender(fn: SendTypingFn) {
  _sendTyping = fn;
}

export async function startTypingLoop(chatRoomId: string) {
  if (typingLoops.has(chatRoomId) || !_sendTyping) return;

  await _sendTyping(chatRoomId).catch(() => {});

  const interval = setInterval(() => {
    _sendTyping?.(chatRoomId).catch(() => {});
  }, TYPING_INTERVAL_MS);
  interval.unref();

  // 安全超时：防止异常时循环泄漏
  const safetyTimer = setTimeout(() => stopTypingLoop(chatRoomId), MAX_DURATION_MS);
  safetyTimer.unref();

  typingLoops.set(chatRoomId, { interval, safetyTimer });
}

export function stopTypingLoop(chatRoomId: string) {
  const data = typingLoops.get(chatRoomId);
  if (data) {
    clearInterval(data.interval);
    clearTimeout(data.safetyTimer);
    typingLoops.delete(chatRoomId);
  }
}
