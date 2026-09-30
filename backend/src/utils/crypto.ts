import crypto from 'crypto';
import { env } from '../config/env';

// Derives a 32-byte key from the environment variable
const getEncryptionKey = (): Buffer => {
  const key = env.SLACK_ENCRYPTION_KEY;
  if (key.length === 64) {
    // Hex string (32 bytes)
    return Buffer.from(key, 'hex');
  }
  // Otherwise hash to 32 bytes
  return crypto.createHash('sha256').update(key).digest();
};

export interface EncryptedData {
  encryptedToken: string;
  tokenIv: string;
  tokenTag: string;
}

export const encryptToken = (plainText: string): EncryptedData => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return {
    encryptedToken: encrypted,
    tokenIv: iv.toString('hex'),
    tokenTag: tag.toString('hex'),
  };
};

export const decryptToken = (
  encryptedToken: string,
  tokenIv: string,
  tokenTag: string
): string => {
  const key = getEncryptionKey();
  const iv = Buffer.from(tokenIv, 'hex');
  const tag = Buffer.from(tokenTag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};
