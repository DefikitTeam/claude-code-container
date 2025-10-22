/**
 * Crypto Service Interface
 * Defines contract for encryption/decryption operations
 */

export interface ICryptoService {
  /**
   * Encrypt data with AES-256-GCM
   */
  encrypt(data: string): Promise<{
    encryptedData: Uint8Array;
    iv: Uint8Array;
  }>;

  /**
   * Decrypt data with AES-256-GCM
   */
  decrypt(encryptedData: Uint8Array, iv: Uint8Array): Promise<string>;

  /**
   * Generate a hash
   */
  hash(data: string): Promise<string>;
}
