import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_ENV = process.env.BRIDGE_ENCRYPTION_KEY;

if (!KEY_ENV) {
  console.warn('[Bridge] BRIDGE_ENCRYPTION_KEY 未设置，凭证将以明文存储。生产环境请务必配置。');
} else {
  const keyByteLen = Buffer.byteLength(KEY_ENV, 'utf8');
  if (keyByteLen !== 32) {
    console.warn(
      `[Bridge] BRIDGE_ENCRYPTION_KEY 长度应为 32 字节，当前为 ${keyByteLen} 字节。密钥将被截断或零填充，安全性降低。`,
    );
  }
}

// Key must be 32 bytes for AES-256. Derive from env var with padding/truncation.
function getKey(): Buffer | null {
  if (!KEY_ENV) return null;
  const buf = Buffer.alloc(32, 0);
  Buffer.from(KEY_ENV, 'utf8').copy(buf);
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // dev: no encryption

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
