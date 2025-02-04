import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required');
}

// Ensure key is exactly 32 bytes
function normalizeKey(key: string): Buffer {
  // First try to decode as base64
  try {
    const decoded = Buffer.from(key, 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  } catch (e) {
    // If not base64, treat as regular string
  }
  
  // If not valid base64 or not 32 bytes, use SHA-256 to get 32 bytes
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(key).digest();
}

// Convert key to proper length
const keyBuffer = normalizeKey(ENCRYPTION_KEY);

/**
 * Encrypts sensitive data using AES-256-GCM
 * @param data - The data to encrypt
 * @returns The encrypted data as a base64 string
 */
export async function encrypt(data: string): Promise<string> {
  // Generate a random IV
  const iv = randomBytes(12);
  
  // Create cipher
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  
  // Encrypt the data
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  // Get the auth tag
  const authTag = cipher.getAuthTag();
  
  // Combine IV, encrypted data and auth tag
  const combined = Buffer.concat([
    iv,
    Buffer.from(encrypted, 'base64'),
    authTag
  ]);
  
  // Return as base64 string
  return combined.toString('base64');
}

/**
 * Decrypts data that was encrypted with the encrypt function
 * @param encryptedData - The encrypted data as a base64 string
 * @returns The decrypted data
 */
export async function decrypt(encryptedData: string): Promise<string> {
  // Convert from base64 and split into components
  const combined = Buffer.from(encryptedData, 'base64');
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(combined.length - 16);
  const encrypted = combined.subarray(12, combined.length - 16);
  
  // Create decipher
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt the data
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
} 