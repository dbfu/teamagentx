export class NoActivityTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoActivityTimeoutError';
  }
}

export interface NoActivityMonitor {
  start(): void;
  markActivity(): void;
  markInternalActivity(): void;
  stop(): void;
  didTimeout(): boolean;
  getError(): NoActivityTimeoutError;
}

export function createNoActivityMonitor(
  timeoutMs: number,
  onTimeout: (error: NoActivityTimeoutError) => void,
  label: string,
): NoActivityMonitor {
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let timedOut = false;
  let hasActivity = false;
  const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
  const error = new NoActivityTimeoutError(
    `${label} did not produce any activity within ${safeTimeoutMs}ms`,
  );

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const armTimer = () => {
    clearTimer();
    if (safeTimeoutMs <= 0 || hasActivity || timedOut) return;
    timer = setTimeout(() => {
      timer = null;
      timedOut = true;
      onTimeout(error);
    }, safeTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  return {
    start() {
      if (safeTimeoutMs <= 0 || timer || hasActivity || timedOut) return;
      started = true;
      armTimer();
    },
    markActivity() {
      if (hasActivity) return;
      hasActivity = true;
      clearTimer();
    },
    markInternalActivity() {
      if (!started || hasActivity || timedOut) return;
      armTimer();
    },
    stop() {
      started = false;
      clearTimer();
    },
    didTimeout() {
      return timedOut;
    },
    getError() {
      return error;
    },
  };
}

export async function sleepForNoActivityRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) throw signal.reason ?? new Error('No-activity retry aborted');

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('No-activity retry aborted'));
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(done, ms);
    if (typeof timer.unref === 'function') timer.unref();

    if (signal) signal.addEventListener('abort', abort, { once: true });
  });
}
