import * as crypto from 'crypto';
import { EncryptionKeyRequiredError } from './errors';

const ALGORITHM = 'aes-256-gcm';

export function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'salt', 32);
}

export function encryptConfig(configStr: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(configStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `enc:v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

export function decryptConfig(encryptedStr: string | null, key: Buffer | null): string | null {
  if (!encryptedStr) return encryptedStr;
  if (!encryptedStr.startsWith('enc:v1:')) return encryptedStr;
  if (!key) {
    throw new EncryptionKeyRequiredError(
      'Persisted task config is encrypted (enc:v1). Pass encryptionKey (or BLAZERJOB_ENCRYPTION_KEY). Data encrypted with BlazerJob <=2.0.8 default key can be read by passing encryptionKey: "default_blazerjob_secret_do_not_use_in_prod".'
    );
  }
  const parts = encryptedStr.split(':');
  if (parts.length !== 5) {
    throw new EncryptionKeyRequiredError('Encrypted config is malformed; refusing to treat it as plaintext.');
  }
  try {
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encryptedText = parts[4];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    throw new EncryptionKeyRequiredError(
      'Failed to decrypt task config with the provided encryption key. The key does not match the data.'
    );
  }
}
