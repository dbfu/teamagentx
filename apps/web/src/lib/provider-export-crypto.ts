// 模型配置导出/导入的加密工具：基于 Web Crypto (AES-GCM + PBKDF2)，对 API Key 进行密码加密。
// 加密后的值形如 `enc:v1:<base64(iv + ciphertext)>`，密钥派生参数记录在文件的 encryption 字段中。

const PBKDF2_ITERATIONS = 150_000
const ENC_PREFIX = 'enc:v1:'
const IV_LENGTH = 12
const SALT_LENGTH = 16

export interface ExportEncryptionMeta {
  algorithm: 'AES-GCM'
  kdf: 'PBKDF2'
  iterations: number
  hash: 'SHA-256'
  salt: string // base64
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// 导出：根据密码生成加密元信息和派生密钥
export async function createEncryptionContext(password: string): Promise<{ meta: ExportEncryptionMeta; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  return {
    key,
    meta: {
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2',
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
      salt: bytesToBase64(salt),
    },
  }
}

// 导入：根据密码和文件中的元信息还原密钥
export async function deriveKeyFromMeta(password: string, meta: ExportEncryptionMeta): Promise<CryptoKey> {
  const salt = base64ToBytes(meta.salt)
  return deriveKey(password, salt, meta.iterations || PBKDF2_ITERATIONS)
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

export async function encryptValue(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  )
  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)
  return ENC_PREFIX + bytesToBase64(combined)
}

// 解密失败（密码错误）时会抛出异常
export async function decryptValue(value: string, key: CryptoKey): Promise<string> {
  const data = base64ToBytes(value.slice(ENC_PREFIX.length))
  const iv = data.slice(0, IV_LENGTH)
  const cipher = data.slice(IV_LENGTH)
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher)
  return new TextDecoder().decode(plainBuf)
}

export function looksLikeEncryptionMeta(value: unknown): value is ExportEncryptionMeta {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as ExportEncryptionMeta).salt === 'string',
  )
}
