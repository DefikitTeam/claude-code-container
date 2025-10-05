// GitHub API utility functions
import { getFixedGitHubAppConfig, validateFixedAppConfig } from './app-config';
import { UserConfig, GitHubAppConfig } from './types';

/**
 * Create JWT token for GitHub App authentication
 */
export async function createJWT(
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
    `JWT payload: iat=${payload.iat}, exp=${payload.exp}, iss=${payload.iss}`,
  );

  // Simple JWT creation
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/[=]/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/[=]/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const data = encodedHeader + '.' + encodedPayload;

  try {
    console.log(
      `Private key length: ${privateKey.length}, starts with: ${privateKey.substring(0, 50)}...`,
    );

    // Import private key (PEM format)
    const keyData = privateKey.replace(/\\n/g, '\n');
    console.log(`Normalized key preview: ${keyData.substring(0, 50)}...`);

    // Convert PEM to DER format for Web Crypto API
    const pemHeader = '-----BEGIN RSA PRIVATE KEY-----';
    const pemFooter = '-----END RSA PRIVATE KEY-----';

    if (!keyData.includes(pemHeader) || !keyData.includes(pemFooter)) {
      throw new Error('Invalid PEM format: missing header or footer');
    }

    const pemContents = keyData
      .replace(pemHeader, '')
      .replace(pemFooter, '')
      .replace(/\s/g, '');
    console.log(`PEM contents length: ${pemContents.length}`);

    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    console.log(`Binary DER length: ${binaryDer.length}`);

    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    console.log('Private key imported successfully');

    // Sign the data
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      importedKey,
      new TextEncoder().encode(data),
    );
    const encodedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signature)),
    )
      .replace(/[=]/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const jwt = data + '.' + encodedSignature;
    console.log(`JWT created successfully, length: ${jwt.length}`);
    return jwt;
  } catch (error) {
    console.error('JWT creation failed:', error);
    console.error(
      'Error details:',
      error instanceof Error ? error.stack : String(error),
    );
    throw new Error(
      `JWT creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Generate installation access token for a user
 */
export async function generateInstallationToken(
  userConfig: UserConfig,
  env?: any,
): Promise<string | null> {
  try {
    console.log(
      '🔧 Starting generateInstallationToken - attempting user config first',
    );

    // For this system, users provide their own GitHub App credentials
    // Try to get from user's configuration first, fall back to fixed only if needed
    let appConfig: any = null;
    let configSource = 'none';

    // If we have env, try to get user-provided config first
    if (env && env.GITHUB_APP_CONFIG) {
      try {
        console.log('📋 Attempting to get user-provided GitHub App config...');
        const configDO = env.GITHUB_APP_CONFIG.idFromName('github-app-config');
        const configInstance = env.GITHUB_APP_CONFIG.get(configDO);
        const response = await configInstance.fetch(
          new Request('http://localhost/retrieve'),
        );

        if (response.ok) {
          const userAppConfig = await response.json();
          if (
            userAppConfig &&
            userAppConfig.appId &&
            userAppConfig.privateKey
          ) {
            console.log('✅ Found user-provided GitHub App configuration');
            appConfig = userAppConfig;
            configSource = 'user';
          }
        }
      } catch (error) {
        console.log(
          '⚠️ Could not retrieve user config, will try fixed config:',
          error,
        );
      }
    }

    // If no user config found, try fixed config as fallback
    if (!appConfig) {
      console.log('📋 Trying fixed GitHub App config as fallback...');
      const fixedConfig = getFixedGitHubAppConfig();
      if (validateFixedAppConfig()) {
        appConfig = fixedConfig;
        configSource = 'fixed';
        console.log('✅ Using fixed GitHub App configuration');
      } else {
        console.error(
          '❌ No valid GitHub App configuration found (neither user-provided nor fixed)',
        );
        console.error(
          '💡 Please configure GitHub App credentials via the /config endpoint',
        );
        return null;
      }
    }

    console.log(
      `Creating JWT for App ID: ${appConfig.appId}, Installation: ${userConfig.installationId} (using ${configSource} config)`,
    );

    // Create JWT token for GitHub App authentication
    const jwt = await createJWT(appConfig.appId, appConfig.privateKey);
    console.log(`JWT created successfully, length: ${jwt.length}`);

    // Get installation access token
    const apiUrl = `https://api.github.com/app/installations/${userConfig.installationId}/access_tokens`;
    console.log(`Calling GitHub API: ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
      },
    });

    console.log(
      `GitHub API response: ${response.status} ${response.statusText}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GitHub API error: ${response.status} - ${errorText}`);
      return null;
    }

    const tokenData = (await response.json()) as any;
    console.log(`Access token obtained, expires at: ${tokenData.expires_at}`);

    return tokenData.token;
  } catch (error) {
    console.error('Failed to generate installation token:', error);
    console.error(
      'Error details:',
      error instanceof Error ? error.stack : String(error),
    );
    return null;
  }
}

/**
 * Get installation repositories for a user
 */
export async function getInstallationRepositories(
  userConfig: UserConfig,
  options: {
    perPage?: number;
    page?: number;
  } = {},
): Promise<any[]> {
  try {
    const installationToken = await generateInstallationToken(userConfig);
    if (!installationToken) {
      console.error('Failed to generate installation token');
      return [];
    }

    const params = new URLSearchParams();
    if (options.perPage !== undefined) {
      const constrained = Math.max(1, Math.min(100, Math.floor(options.perPage)));
      params.set('per_page', constrained.toString());
    }
    if (options.page !== undefined) {
      const page = Math.max(1, Math.floor(options.page));
      params.set('page', page.toString());
    }

    const apiUrl = `https://api.github.com/installation/repositories${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${installationToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to get installation repositories: ${response.status}`,
      );
      return [];
    }

    const data = (await response.json()) as any;
    return data.repositories || [];
  } catch (error) {
    console.error('Failed to get installation repositories:', error);
    return [];
  }
}

/**
 * Get branches for a repository
 */
export async function getRepositoryBranches(
  userConfig: UserConfig,
  owner: string,
  repo: string,
  options: {
    perPage?: number;
    page?: number;
    protectedOnly?: boolean;
  } = {},
): Promise<any[]> {
  try {
    const installationToken = await generateInstallationToken(userConfig);
    if (!installationToken) {
      console.error('Failed to generate installation token');
      return [];
    }

    const params = new URLSearchParams();
    if (options.perPage !== undefined) {
      const constrained = Math.max(1, Math.min(100, Math.floor(options.perPage)));
      params.set('per_page', constrained.toString());
    }
    if (options.page !== undefined) {
      const page = Math.max(1, Math.floor(options.page));
      params.set('page', page.toString());
    }
    if (typeof options.protectedOnly === 'boolean') {
      params.set('protected', options.protectedOnly ? 'true' : 'false');
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/branches${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${installationToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
      },
    });

    if (!response.ok) {
      console.error(
        `Failed to get repository branches: ${response.status} ${response.statusText}`,
      );
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get repository branches:', error);
    return [];
  }
}

/**
 * Get repository information
 */
export async function getRepositoryInfo(
  userConfig: UserConfig,
  owner: string,
  repo: string,
): Promise<any | null> {
  try {
    const installationToken = await generateInstallationToken(userConfig);
    if (!installationToken) {
      console.error('Failed to generate installation token');
      return null;
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${installationToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
      },
    });

    if (!response.ok) {
      console.error(`Failed to get repository info: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get repository info:', error);
    return null;
  }
}

/**
 * Create GitHub issue
 */
export async function createGitHubIssue(
  userConfig: UserConfig,
  owner: string,
  repo: string,
  title: string,
  body: string,
): Promise<any | null> {
  try {
    const installationToken = await generateInstallationToken(userConfig);
    if (!installationToken) {
      console.error('Failed to generate installation token');
      return null;
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${installationToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: `**Auto-generated from prompt:**\n\n${body}`,
        labels: ['automated', 'claude-prompt'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Failed to create GitHub issue: ${response.status} - ${errorText}`,
      );
      return null;
    }

    const issue = (await response.json()) as any;
    console.log(`GitHub issue created successfully: #${issue.number}`);
    return issue;
  } catch (error) {
    console.error('Failed to create GitHub issue:', error);
    return null;
  }
}

/**
 * Validate webhook signature using fixed app config
 */
export async function validateWebhookSignature(
  body: string,
  signature: string,
): Promise<boolean> {
  try {
    const appConfig = getFixedGitHubAppConfig();

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(appConfig.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const expectedSignature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(body),
    );
    const expectedHex = Array.from(new Uint8Array(expectedSignature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const cleanSignature = signature.startsWith('sha256=')
      ? signature.slice(7)
      : signature;

    return cleanSignature === expectedHex;
  } catch (error) {
    console.error('Webhook signature validation error:', error);
    return false;
  }
}

/**
 * Create legacy GitHubAppConfig from user config and fixed app config
 * This maintains compatibility with existing code
 */
export function createLegacyGitHubAppConfig(
  userConfig: UserConfig,
  installationToken: string,
): GitHubAppConfig {
  const appConfig = getFixedGitHubAppConfig();

  return {
    appId: appConfig.appId,
    privateKey: appConfig.privateKey,
    webhookSecret: appConfig.webhookSecret,
    installationId: userConfig.installationId,
    installationToken,
    tokenExpiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
  };
}
