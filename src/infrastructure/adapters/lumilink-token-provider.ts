/**
 * LumiLink Token Provider
 * Calls LumiLink backend API to get GitHub installation tokens
 *
 * AUTHENTICATION: Uses user's JWT token (same as regular API calls)
 * This follows the principle of simplicity - worker acts on behalf of the user.
 *
 * USAGE:
 * 1. User logs into LumiLink and gets JWT token
 * 2. User provides JWT token to worker (env: LUMILINK_JWT_TOKEN)
 * 3. Worker calls LumiLink API with JWT in Authorization header
 * 4. LumiLink generates GitHub installation token using platform credentials
 */

import { ExternalTokenProvider } from '../services/token.service.impl';
import { ValidationError } from '../../shared/errors/validation.error';

export interface LumiLinkConfig {
  apiUrl: string; // LumiLink API base URL (e.g., https://api.lumilink.ai or http://localhost:8788)
  jwtToken: string; // User's JWT token from LumiLink authentication
}

/**
 * LumiLink Token Provider
 * Fetches GitHub installation tokens from LumiLink backend using user JWT
 */
export class LumiLinkTokenProvider implements ExternalTokenProvider {
  private readonly apiUrl: string;
  private readonly jwtToken: string;

  constructor(config: LumiLinkConfig) {
    if (!config.apiUrl || !config.jwtToken) {
      throw new ValidationError(
        'LumiLink configuration incomplete: apiUrl and jwtToken required',
      );
    }

    this.apiUrl = config.apiUrl.replace(/\/$/, ''); // Remove trailing slash
    this.jwtToken = config.jwtToken;
  }

  /**
   * Get GitHub installation token from LumiLink API
   *
   * @param installationId - GitHub installation ID
   * @returns Token and expiration timestamp
   * @throws Error if API call fails
   */
  async getToken(
    installationId: string,
  ): Promise<{ token: string; expiresAt: number }> {
    if (!installationId) {
      throw new ValidationError('installationId is required');
    }

    try {
      const url = `${this.apiUrl}/api/coding-mode/github-token/installation`;

      console.log(
        `[LumiLink] Requesting token for installation ${installationId} -> ${url}`,
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwtToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'claude-code-container/1.0.0',
        },
        body: JSON.stringify({
          installationId,
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();

        // Try to safely parse JSON body for structured error
        let parsed: any = null;
        try {
          parsed = JSON.parse(responseText);
        } catch {
          // leave parsed as null
        }

        // Prepare safe token metadata (do NOT log full JWT)
        const tokenMeta = {
          looksLikeJWT:
            typeof this.jwtToken === 'string' &&
            this.jwtToken.split('.').length === 3,
          jwtLength:
            typeof this.jwtToken === 'string' ? this.jwtToken.length : 0,
        };

        // Try to decode JWT header if present (safe, non-secret)
        let jwtHeader: any = null;
        try {
          if (tokenMeta.looksLikeJWT) {
            const headerPart = this.jwtToken.split('.')[0];
            // base64url -> base64
            const b64 = headerPart.replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4;
            const padded = pad === 0 ? b64 : b64 + '='.repeat(4 - pad);
            let decoded: string;
            if (
              typeof globalThis !== 'undefined' &&
              (globalThis as any).Buffer
            ) {
              decoded = (globalThis as any).Buffer.from(
                padded,
                'base64',
              ).toString('utf8');
            } else if (typeof atob === 'function') {
              const binary = atob(padded);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
              }
              decoded = new TextDecoder().decode(bytes);
            } else {
              // Last resort: use the raw padded string (best-effort)
              decoded = padded;
            }
            jwtHeader = JSON.parse(decoded);
          }
        } catch (e) {
          jwtHeader = { decodeError: String(e) };
        }

        console.error('[LumiLink] Token API returned non-OK response', {
          status: response.status,
          statusText: response.statusText,
          body: responseText,
          parsedBody: parsed,
          installationId,
          apiUrl: this.apiUrl,
          tokenMeta,
          jwtHeader,
        });

        // If backend indicates PKCS8 error, add a hint for backend team
        const errMsg =
          parsed?.error || responseText || `Status ${response.status}`;
        if (String(errMsg).toLowerCase().includes('pkcs8')) {
          console.error(
            '[LumiLink] Backend reports PKCS8/PEM error. Possible causes to check on backend:',
          );
          console.error(
            '- PEM header/footer missing or malformed (-----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY-----)',
          );
          console.error(
            '- Newline/whitespace munging when storing or transporting the key',
          );
          console.error(
            '- URL-encoding or escaping introduced extra characters',
          );
          console.error(
            '- Wrong key format (PEM vs DER) or wrong key type (not PKCS8)',
          );
          console.error(
            '- Backend attempted to parse PEM as DER/base64 without proper decoding/transform',
          );
        }

        throw new Error(
          `LumiLink API error: ${response.status} - ${responseText}`,
        );
      }

      const result = (await response.json()) as {
        success: boolean;
        data?: {
          token: string;
          expiresAt: string;
        };
        error?: string;
      };

      if (!result.success || !result.data?.token) {
        console.error('[LumiLink] Invalid response payload', {
          result,
          installationId,
          apiUrl: this.apiUrl,
        });
        throw new Error(
          `LumiLink API error: ${result.error || 'Invalid response'}`,
        );
      }

      // Convert expiresAt to timestamp
      const expiresAt = new Date(result.data.expiresAt).getTime();

      console.log(
        `[LumiLink] Token obtained, expires at: ${new Date(expiresAt).toISOString()}`,
      );

      return { token: result.data.token, expiresAt };
    } catch (error) {
      console.error('[LumiLink] Failed to fetch installation token:', error);
      throw error;
    }
  }
}
