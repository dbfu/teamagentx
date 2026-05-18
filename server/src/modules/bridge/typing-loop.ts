// 外部平台持久输入状态循环管理
// 独立模块，避免 bridge.service ↔ agent/processor 循环依赖

type TypingLoopState = {
  interval: ReturnType<typeof setInterval>;
  safetyTimer: ReturnType<typeof setTimeout>;
};

const typingLoops = new Map<string, TypingLoopState>();
const TYPING_INTERVAL_MS = 4000;
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 分钟安全上限

type SendTypingFn = (chatRoomId: string) => Promise<void>;
type ClearTypingFn = (chatRoomId: string) => Promise<void>;

let _sendTyping: SendTypingFn | null = null;
let _clearTyping: ClearTypingFn | null = null;

export function registerTypingLoopSender(fn: SendTypingFn) {
  _sendTyping = fn;
}

export function registerTypingLoopClearer(fn: ClearTypingFn) {
  _clearTyping = fn;
}

export async function startTypingLoop(chatRoomId: string) {
  if (typingLoops.has(chatRoomId) || !_sendTyping) return;

  const sendTypingIfActive = async (state: TypingLoopState) => {
    if (typingLoops.get(chatRoomId) !== state) return;

    await _sendTyping?.(chatRoomId).catch(() => {});

    // stopTypingLoop may run while the async sender is in-flight. If the
    // platform indicator was added after stop, clear it again immediately.
    if (typingLoops.get(chatRoomId) !== state) {
      await _clearTyping?.(chatRoomId).catch(() => {});
    }
  };

  const interval = setInterval(() => {
    const state = typingLoops.get(chatRoomId);
    if (state) sendTypingIfActive(state).catch(() => {});
  }, TYPING_INTERVAL_MS);
  interval.unref();

  // 安全超时：防止异常时循环泄漏
  const safetyTimer = setTimeout(() => stopTypingLoop(chatRoomId), MAX_DURATION_MS);
  safetyTimer.unref();

  const state = { interval, safetyTimer };
  typingLoops.set(chatRoomId, state);
  await sendTypingIfActive(state);
}

export function stopTypingLoop(chatRoomId: string) {
  const data = typingLoops.get(chatRoomId);
  if (data) {
    clearInterval(data.interval);
    clearTimeout(data.safetyTimer);
    typingLoops.delete(chatRoomId);
  }
  _clearTyping?.(chatRoomId).catch(() => {});
}
