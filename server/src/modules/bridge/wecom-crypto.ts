import { createDecipheriv } from 'crypto';

/**
 * 解密企业微信消息体
 * encodingAESKey: 43位Base64字符串（企业微信后台生成）
 * encryptedMsg: 加密的消息内容（Base64）
 * returns: 解密后的 XML 字符串
 */
export function decryptWecomMessage(encodingAESKey: string, encryptedMsg: string, expectedCorpId?: string): string {
  // AESKey = Base64Decode(encodingAESKey + '=')
  const aesKey = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = aesKey.slice(0, 16);

  const encrypted = Buffer.from(encryptedMsg, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false); // 企微使用PKCS7，手动去除

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  // Remove PKCS7 padding
  const padLen = decrypted[decrypted.length - 1];
  if (padLen < 1 || padLen > 32) throw new Error('Invalid WeCom padding');
  const unpadded = decrypted.slice(0, decrypted.length - padLen);

  // Format: 16 bytes random + 4 bytes msg length (big-endian) + msg content + appid
  const msgLen = unpadded.readUInt32BE(16);
  const msgContent = unpadded.slice(20, 20 + msgLen).toString('utf8');

  if (expectedCorpId !== undefined) {
    const appId = unpadded.slice(20 + msgLen).toString('utf8');
    if (appId !== expectedCorpId) throw new Error('WeCom corpId mismatch');
  }

  return msgContent;
}
