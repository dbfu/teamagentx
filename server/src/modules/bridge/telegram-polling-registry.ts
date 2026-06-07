// Late-binding registry to break the circular dependency:
// bridge-runtime-sync → bridge.gateway (dynamic import)
// bridge.gateway calls registerTelegramPolling() at init time;
// bridge-runtime-sync calls getTelegramPolling() at runtime.

type PollingLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type TelegramPollingFns = {
  start: (botId: string, token: string, log: PollingLogger) => void;
  stop: (botId?: string) => void;
};

let _fns: TelegramPollingFns | null = null;

export function registerTelegramPolling(fns: TelegramPollingFns): void {
  _fns = fns;
}

export function getTelegramPolling(): TelegramPollingFns | null {
  return _fns;
}
