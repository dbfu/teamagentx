import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = process.env.BRIDGE_ENCRYPTION_KEY;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!KEY_ENV) {
  if (IS_PRODUCTION) {
    console.error('[Bridge] CRITICAL: BRIDGE_ENCRYPTION_KEY 未设置，生产环境必须配置 32 字节密钥。凭证无法加密。');
  } else {
    console.warn('[Bridge] BRIDGE_ENCRYPTION_KEY 未设置，凭证将以明文存储。生产环境请务必配置。');
  }
} else {
  const keyByteLen = Buffer.byteLength(KEY_ENV, 'utf8');
  if (keyByteLen !== 32) {
    if (IS_PRODUCTION) {
      throw new Error(
        `[Bridge] BRIDGE_ENCRYPTION_KEY 长度必须为 32 字节，当前为 ${keyByteLen} 字节。请修正后重启。`,
      );
    } else {
      console.warn(
        `[Bridge] BRIDGE_ENCRYPTION_KEY 长度应为 32 字节，当前为 ${keyByteLen} 字节。非生产环境将拒绝使用此密钥。`,
      );
    }
  }
}

// Key must be exactly 32 bytes for AES-256. Throws if key length is wrong.
function getKey(): Buffer | null {
  if (!KEY_ENV) return null;
  const keyBuf = Buffer.from(KEY_ENV, 'utf8');
  if (keyBuf.byteLength !== 32) {
    throw new Error(
      `[Bridge] BRIDGE_ENCRYPTION_KEY 长度必须为 32 字节，当前为 ${keyBuf.byteLength} 字节。`,
    );
  }
  return keyBuf;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // no key configured (dev only)

  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12):tag(16):ciphertext — all hex
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(value: string): string {
  if (!value.startsWith('enc:')) return value; // plaintext (dev or unencrypted legacy)
  const key = getKey();
  if (!key) return value; // no key, return as-is

  const parts = value.slice(4).split(':');
  if (parts.length !== 3) return value;
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
