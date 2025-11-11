/**
 * Crypto Service Implementation
 * Handles encryption/decryption using AES-256-GCM
 *
 * Implements: ICryptoService
 */

import { ICryptoService } from '../../core/interfaces/services/crypto.service';
import { ValidationError } from '../../shared/errors/validation.error';

export class CryptoServiceImpl implements ICryptoService {
  private key: CryptoKey | null = null;

  constructor(encryptionKey?: CryptoKey) {
    this.key = encryptionKey || null;
  }

  /**
   * Initialize the service with an encryption key
   * Must be called before encrypt/decrypt operations
   */
  async initialize(keyMaterial: string | undefined | null): Promise<void> {
    if (!keyMaterial || typeof keyMaterial !== 'string') {
      throw new ValidationError('ENCRYPTION_KEY is not configured. Provide a 64-character hex string.');
    }

    const normalizedKey = keyMaterial.trim();

    if (normalizedKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(normalizedKey)) {
      throw new ValidationError('ENCRYPTION_KEY must be a 32-byte key represented as a 64-character hex string.');
    }

    try {
      const keyBuffer = this.hexToBuffer(normalizedKey);
      this.key = await crypto.subtle.importKey(
        'raw',
        keyBuffer as BufferSource,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
    } catch (error) {
      throw new ValidationError(
        `Failed to initialize crypto service: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Encrypt data with AES-256-GCM
   * @param data - Plain text data to encrypt
   * @returns Encrypted data and IV as Uint8Array
   */
  async encrypt(data: string): Promise<{
    encryptedData: Uint8Array;
    iv: Uint8Array;
  }> {
    if (!this.key) {
      throw new ValidationError('Crypto service not initialized - call initialize() first');
    }

    if (!data || typeof data !== 'string') {
      throw new ValidationError('Data must be a non-empty string');
    }

    try {
      // Generate a random 12-byte IV
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Encode the data
      const encodedData = new TextEncoder().encode(data);

      // Encrypt using AES-GCM
      const encryptedContent = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
        },
        this.key,
        encodedData,
      );

      return {
        iv,
        encryptedData: new Uint8Array(encryptedContent),
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt data with AES-256-GCM
   * @param encryptedData - Encrypted data bytes
   * @param iv - Initialization vector used during encryption
   * @returns Decrypted plain text
   */
  async decrypt(encryptedData: Uint8Array, iv: Uint8Array): Promise<string> {
    if (!this.key) {
      throw new ValidationError('Crypto service not initialized - call initialize() first');
    }

    if (!(encryptedData instanceof Uint8Array) || encryptedData.length === 0) {
      throw new ValidationError('encryptedData must be a non-empty Uint8Array');
    }

    if (!(iv instanceof Uint8Array) || iv.length !== 12) {
      throw new ValidationError('IV must be a 12-byte Uint8Array');
    }

    try {
      // Decrypt using AES-GCM
      const decryptedContent = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
        },
        this.key,
        encryptedData as BufferSource,
      );

      return new TextDecoder().decode(decryptedContent);
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a cryptographic hash using SHA-256
   * @param data - Data to hash
   * @returns Hex-encoded hash
   */
  async hash(data: string): Promise<string> {
    if (!data || typeof data !== 'string') {
      throw new ValidationError('Data must be a non-empty string');
    }

    try {
      const encodedData = new TextEncoder().encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encodedData);
      return this.bufferToHex(new Uint8Array(hashBuffer));
    } catch (error) {
      throw new Error(`Hash generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify GitHub webhook signature using HMAC-SHA256
   * @param payload - Raw webhook payload
   * @param signature - Signature from X-Hub-Signature-256 header (with sha256= prefix)
   * @param secret - Webhook secret
   * @returns True if signature is valid
   */
  async verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    try {
      // Remove 'sha256=' prefix if present
      const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;

      // Import the secret as HMAC key
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      // Generate expected signature
      const expectedSignature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));

      // Convert to hex
      const expectedHex = this.bufferToHex(new Uint8Array(expectedSignature));

      // Timing-safe comparison
      return this.timingSafeEqual(cleanSignature, expectedHex);
    } catch (error) {
      console.error('Webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Convert hex string to Uint8Array
   */
  private hexToBuffer(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      if (Number.isNaN(byte)) {
        throw new ValidationError('ENCRYPTION_KEY contains non-hexadecimal characters.');
      }
      bytes[i / 2] = byte;
    }
    return bytes;
  }

  /**
   * Convert Uint8Array to hex string
   */
  private bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
