/**
 * Cryptographic utilities
 * Helper functions for encryption/decryption operations
 * Note: Actual implementation delegated to ICryptoService
 * These are utility functions for validation and formatting
 */

/**
 * Generate a random IV (Initialization Vector) for AES-GCM
 */
export function generateRandomIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
}

/**
 * Generate a random key for AES-256
 */
export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Convert ArrayBuffer to Hex string for storage
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Hex string back to ArrayBuffer
 */
export function hexToBuffer(hex: string): ArrayBuffer {
  const buffer = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    buffer[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return buffer.buffer;
}

/**
 * Convert Uint8Array to Base64 for storage/transmission
 */
export function uint8ArrayToBase64(array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < array.byteLength; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 to Uint8Array
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return array;
}

/**
 * Verify that a string looks like an encrypted payload
 */
export function isEncryptedPayload(value: any): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'encryptedData' in value &&
    'iv' in value &&
    value.encryptedData instanceof Uint8Array &&
    value.iv instanceof Uint8Array
  );
}

/**
 * Hash a string using SHA-256
 */
export async function hashSHA256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Validate API key format (basic check)
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  return (
    typeof apiKey === 'string' &&
    apiKey.length > 10 &&
    !apiKey.includes(' ') &&
    !apiKey.includes('\n')
  );
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitiveData(data: string, visibleChars: number = 4): string {
  if (data.length <= visibleChars) {
    return '*'.repeat(data.length);
  }
  return (
    data.substring(0, visibleChars) +
    '*'.repeat(Math.max(0, data.length - visibleChars - 4)) +
    data.substring(data.length - 4)
  );
}
