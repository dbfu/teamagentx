import { decrypt } from './crypto.js';

type StoredBridgeCredentialRecord = {
  botToken?: string | null;
  config?: string | null;
};

export function parseStoredBridgeConfig(record: StoredBridgeCredentialRecord): Record<string, unknown> | null {
  if (!record.config) return null;
  try {
    const parsed = JSON.parse(decrypt(record.config)) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveStoredBridgeBotToken(record: StoredBridgeCredentialRecord): string | undefined {
  if (record.botToken) {
    return decrypt(record.botToken);
  }
  const parsedConfig = parseStoredBridgeConfig(record);
  return typeof parsedConfig?.botToken === 'string' ? parsedConfig.botToken : undefined;
}
