/**
 * GitHub JWT and Installation Token Utilities
 * Ported from src/github-utils.ts for Clean Architecture
 */

/**
 * Create JWT token for GitHub App authentication
 * @param appId - GitHub App ID
 * @param privateKey - RSA private key in PEM format
 * @returns JWT token valid for 10 minutes
 */
export async function createGitHubJWT(
  appId: string,
  privateKey: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Issued 60 seconds ago
    exp: now + 600, // Expires in 10 minutes
    iss: appId,
  };

  console.log(
    `[JWT] Creating JWT for App ID ${appId}: iat=${payload.iat}, exp=${payload.exp}`,
  );

  // Create JWT header and payload
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = encodedHeader + '.' + encodedPayload;

  try {
    // Normalize private key (handle escaped newlines)
    const keyData = privateKey.replace(/\\n/g, '\n');

    // Validate PEM format
    const pemHeader = '-----BEGIN RSA PRIVATE KEY-----';
    const pemFooter = '-----END RSA PRIVATE KEY-----';

    if (!keyData.includes(pemHeader) || !keyData.includes(pemFooter)) {
      throw new Error('Invalid PEM format: missing header or footer');
    }

    // Extract PEM contents (base64-encoded DER)
    const pemContents = keyData
      .replace(pemHeader, '')
      .replace(pemFooter, '')
      .replace(/\s/g, '');

    // Decode base64 to binary DER format
    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    // Import RSA private key using Web Crypto API
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    console.log('[JWT] Private key imported successfully');

    // Sign the JWT data
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      importedKey,
      new TextEncoder().encode(data),
    );

    const encodedSignature = base64UrlEncode(
      String.fromCharCode(...new Uint8Array(signature)),
    );

    const jwt = data + '.' + encodedSignature;
    console.log(`[JWT] JWT created successfully, length: ${jwt.length}`);
    return jwt;
  } catch (error) {
    console.error('[JWT] Creation failed:', error);
    throw new Error(
      `JWT creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Generate GitHub installation access token
 * @param installationId - GitHub installation ID
 * @param appId - GitHub App ID
 * @param privateKey - RSA private key in PEM format
 * @returns Installation access token (valid for 1 hour)
 */
export async function generateGitHubInstallationToken(
  installationId: string,
  appId: string,
  privateKey: string,
): Promise<string> {
  try {
    console.log(
      `[Token] Generating installation token for installation ${installationId}`,
    );

    // Create JWT for GitHub App authentication
    const jwt = await createGitHubJWT(appId, privateKey);

    // Request installation access token from GitHub API
    const apiUrl = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    console.log(`[Token] Calling GitHub API: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'ClaudeCode-Container/1.0.0',
      },
    });

    console.log(
      `[Token] GitHub API response: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Token] GitHub API error: ${response.status} - ${errorText}`);
      throw new Error(
        `Failed to generate installation token: ${response.status} - ${errorText}`,
      );
    }

    const tokenData = (await response.json()) as {
      token: string;
      expires_at: string;
    };
    console.log(
      `[Token] Access token obtained, expires at: ${tokenData.expires_at}`,
    );

    return tokenData.token;
  } catch (error) {
    console.error('[Token] Failed to generate installation token:', error);
    throw error;
  }
}

/**
 * Base64 URL-safe encoding (for JWT)
 */
function base64UrlEncode(str: string): string {
  return btoa(str)
    .replace(/[=]/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
