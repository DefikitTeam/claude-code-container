// Encryption utilities for secure credential storage

export interface EncryptedData {
  encryptedData: Uint8Array;
  iv: Uint8Array;
}

export class CryptoUtils {
  /**
   * Generate a new AES-256-GCM key
   */
  static async generateKey(): Promise<CryptoKey> {
    const key = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256,
      },
      true, // extractable
      ['encrypt', 'decrypt'],
    );

    // For symmetric algorithms like AES-GCM, generateKey returns CryptoKey, not CryptoKeyPair
    return key as CryptoKey;
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  static async encrypt(key: CryptoKey, data: string): Promise<EncryptedData> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(data);

    const encryptedContent = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      encodedData,
    );

    return {
      iv,
      encryptedData: new Uint8Array(encryptedContent),
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  static async decrypt(
    key: CryptoKey,
    encryptedData: EncryptedData,
  ): Promise<string> {
    const decryptedContent = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encryptedData.iv,
      },
      key,
      encryptedData.encryptedData,
    );

    return new TextDecoder().decode(decryptedContent);
  }

  /**
   * Export a CryptoKey to raw format
   */
  static async exportKey(key: CryptoKey): Promise<ArrayBuffer> {
    const exported = await crypto.subtle.exportKey('raw', key);
    return exported as ArrayBuffer;
  }

  /**
   * Import a key from raw format
   */
  static async importKey(keyData: ArrayBuffer): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: 'AES-GCM',
        length: 256,
      },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Verify GitHub webhook signature using HMAC-SHA256
   */
  static async verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    try {
      // Remove 'sha256=' prefix if present
      const cleanSignature = signature.startsWith('sha256=')
        ? signature.slice(7)
        : signature;

      // Import the secret as a key
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      // Generate the expected signature
      const expectedSignature = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(payload),
      );

      // Convert to hex string
      const expectedHex = Array.from(new Uint8Array(expectedSignature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Use timing-safe comparison
      return this.timingSafeEqual(cleanSignature, expectedHex);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return false;
    }
  }

  /**
   * Timing-safe string comparison to prevent timing attacks
   */
  static timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}
